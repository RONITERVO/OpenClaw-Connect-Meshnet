import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  auditPath,
  defaultGatewayHttp,
  defaultSettings,
  settingsPath,
  stateDir,
  workflowsDir,
} from "./config.mjs";
import { parseJson } from "./utils.mjs";

async function ensureStateDir() {
  await mkdir(stateDir, { recursive: true });
  await mkdir(workflowsDir, { recursive: true });
}

async function readSettings() {
  await ensureStateDir();
  try {
    const data = parseJson(await readFile(settingsPath, "utf8"), {});
    return { ...defaultSettings, ...(data || {}) };
  } catch {
    return { ...defaultSettings };
  }
}

async function writeTextFileAtomic(file, text) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, text, "utf8");
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

async function writeJsonFileAtomic(file, value) {
  await writeTextFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeSettings(next = {}) {
  const parsedTimeout = parseInt(next.defaultTimeoutSeconds, 10);
  const defaultTimeoutSeconds = Number.isInteger(parsedTimeout) && parsedTimeout > 0
    ? parsedTimeout
    : defaultSettings.defaultTimeoutSeconds;
  const clean = {
    ...defaultSettings,
    ...next,
    gatewayHttp: String(next.gatewayHttp || defaultGatewayHttp),
    defaultThinking: String(next.defaultThinking || defaultSettings.defaultThinking),
    defaultTimeoutSeconds,
    defaultTimezone: String(next.defaultTimezone || defaultSettings.defaultTimezone),
    announceReplies: Boolean(next.announceReplies ?? defaultSettings.announceReplies),
    replyChannel: String(next.replyChannel || "telegram"),
    preferTelegramDirect: Boolean(next.preferTelegramDirect ?? defaultSettings.preferTelegramDirect),
  };
  await ensureStateDir();
  await writeJsonFileAtomic(settingsPath, clean);
  return clean;
}

async function appendAudit(event) {
  await ensureStateDir();
  const line = JSON.stringify({
    at: new Date().toISOString(),
    ...event,
  });
  await appendFile(auditPath, `${line}\n`, "utf8");
}

export {
  appendAudit,
  ensureStateDir,
  readSettings,
  writeJsonFileAtomic,
  writeSettings,
  writeTextFileAtomic,
};

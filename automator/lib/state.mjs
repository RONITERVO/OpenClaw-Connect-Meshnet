import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";

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

async function writeSettings(next) {
  const clean = {
    ...defaultSettings,
    ...next,
    gatewayHttp: String(next.gatewayHttp || defaultGatewayHttp),
    defaultThinking: String(next.defaultThinking || defaultSettings.defaultThinking),
    defaultTimeoutSeconds: Number(next.defaultTimeoutSeconds || defaultSettings.defaultTimeoutSeconds),
    defaultTimezone: String(next.defaultTimezone || defaultSettings.defaultTimezone),
    announceReplies: Boolean(next.announceReplies ?? defaultSettings.announceReplies),
    replyChannel: String(next.replyChannel || "telegram"),
    preferTelegramDirect: Boolean(next.preferTelegramDirect ?? defaultSettings.preferTelegramDirect),
  };
  await ensureStateDir();
  await writeFile(settingsPath, `${JSON.stringify(clean, null, 2)}\n`, "utf8");
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
  writeSettings,
};

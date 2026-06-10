import { execFile } from "node:child_process";
import { existsSync } from "node:fs";

import { appRoot, openclawCommand, openclawMjs } from "./config.mjs";
import { normalizeChannelId } from "./channels.mjs";
import { appendAudit, readSettings } from "./state.mjs";
import { compactText, parseJson } from "./utils.mjs";

function openclawInvocation(args) {
  const configured = process.env.OPENCLAW_BIN;
  if (configured && configured.endsWith(".mjs")) {
    return { command: process.execPath, args: [configured, ...args] };
  }
  if (process.platform === "win32" && existsSync(openclawMjs)) {
    return { command: process.execPath, args: [openclawMjs, ...args] };
  }
  return { command: openclawCommand, args };
}

function execEnv() {
  const env = { ...process.env };
  if (process.platform === "win32") {
    env.PATH = [
      process.env.APPDATA ? `${process.env.APPDATA}\\npm` : "",
      "C:\\Program Files\\nodejs",
      process.env.PATH || "",
    ].filter(Boolean).join(";");
  }
  return env;
}

function positiveIntegerOption(value, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return Math.max(1, Math.round(parsed));
  return fallback;
}

function execOpenClaw(args, options = {}) {
  const timeout = positiveIntegerOption(options.timeoutMs, 30000);
  return new Promise((resolve) => {
    const invocation = openclawInvocation(args);
    execFile(invocation.command, invocation.args, {
      cwd: appRoot,
      windowsHide: true,
      timeout,
      maxBuffer: 20 * 1024 * 1024,
      env: execEnv(),
    }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error?.code ?? 0,
        signal: error?.signal || null,
        args,
        stdout: compactText(stdout || "", positiveIntegerOption(options.stdoutMax, 6000)),
        stderr: compactText(stderr || "", positiveIntegerOption(options.stderrMax, 6000)),
        error: error ? compactText(error.message || String(error)) : "",
      });
    });
  });
}

async function readConfiguredChannels() {
  const result = await execOpenClaw(["channels", "list", "--json"], { timeoutMs: 10000, stdoutMax: 100000, stderrMax: 1200 });
  const parsed = parseJson(result.stdout, null);
  if (!result.ok || !parsed?.chat || typeof parsed.chat !== "object") return [];
  return Object.keys(parsed.chat).map(normalizeChannelId).filter(Boolean);
}

async function readRuntimeSettings() {
  const settings = await readSettings();
  return {
    ...settings,
    configuredChannels: await readConfiguredChannels(),
  };
}

function quoteArg(arg) {
  const text = String(arg);
  if (/^[A-Za-z0-9_./:@=-]+$/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function displayCommand(args) {
  return `openclaw ${args.map(quoteArg).join(" ")}`;
}

async function runCommand(kind, args, timeoutMs) {
  const startedAt = Date.now();
  const result = await execOpenClaw(args, { timeoutMs });
  const payload = {
    ok: result.ok,
    kind,
    command: displayCommand(args),
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
    code: result.code,
    durationMs: Date.now() - startedAt,
    json: parseJson(result.stdout, null),
  };
  try {
    await appendAudit({
      kind,
      ok: result.ok,
      command: displayCommand(args),
      code: result.code,
      durationMs: payload.durationMs,
    });
  } catch (error) {
    console.warn("OpenClaw Automator audit logging failed.", error?.message || error);
  }
  return payload;
}


export {
  displayCommand,
  execOpenClaw,
  openclawInvocation,
  quoteArg,
  readConfiguredChannels,
  readRuntimeSettings,
  runCommand,
};

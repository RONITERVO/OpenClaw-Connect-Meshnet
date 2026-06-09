import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const appRoot = resolve(__dirname, "..");
const publicDir = join(__dirname, "public");
const port = Number(process.env.OPENCLAW_AUTOMATOR_PORT || 18890);
const stateDir = join(homedir(), ".openclaw", "automator");
const settingsPath = join(stateDir, "settings.json");
const auditPath = join(stateDir, "automation-log.jsonl");
const defaultGatewayHttp = process.env.OPENCLAW_AUTOMATOR_GATEWAY_HTTP || "http://127.0.0.1:18789";
const openclawCommand = process.env.OPENCLAW_BIN || (process.platform === "win32" ? "openclaw.cmd" : "openclaw");
const openclawMjs = process.env.APPDATA ? join(process.env.APPDATA, "npm", "node_modules", "openclaw", "openclaw.mjs") : "";
const appVersion = "0.2.0";

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
]);

const defaultSettings = {
  gatewayHttp: defaultGatewayHttp,
  defaultThinking: "xhigh",
  defaultTimeoutSeconds: 600,
  defaultTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  announceReplies: true,
  replyChannel: "telegram",
  preferTelegramDirect: true,
};

function compactText(value, max = 6000) {
  const text = String(value ?? "").replace(/\s+$/g, "");
  if (text.length <= max) return text;
  return `${text.slice(0, max - 18)}... [truncated]`;
}

function jsonResponse(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function errorResponse(res, status, message, detail = null) {
  jsonResponse(res, status, { ok: false, error: message, detail });
}

function parseJson(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  const parsed = parseJson(text, null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const error = new Error("Request body must be a JSON object.");
    error.status = 400;
    throw error;
  }
  return parsed;
}

async function ensureStateDir() {
  await mkdir(stateDir, { recursive: true });
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

function execOpenClaw(args, options = {}) {
  const timeout = Number(options.timeoutMs || 30000);
  return new Promise((resolve) => {
    const invocation = openclawInvocation(args);
    execFile(invocation.command, invocation.args, {
      cwd: appRoot,
      windowsHide: true,
      timeout,
      maxBuffer: 20 * 1024 * 1024,
      env: {
        ...process.env,
        PATH: `${process.env.APPDATA || ""}\\npm;C:\\Program Files\\nodejs;${process.env.PATH || ""}`,
      },
    }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error?.code ?? 0,
        signal: error?.signal || null,
        args,
        stdout: compactText(stdout || ""),
        stderr: compactText(stderr || ""),
        error: error ? compactText(error.message || String(error)) : "",
      });
    });
  });
}

function quoteArg(arg) {
  const text = String(arg);
  if (/^[A-Za-z0-9_./:@=-]+$/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function displayCommand(args) {
  return `openclaw ${args.map(quoteArg).join(" ")}`;
}

function requireText(value, label, max = 12000) {
  const text = String(value ?? "").trim();
  if (!text) {
    const error = new Error(`${label} is required.`);
    error.status = 400;
    throw error;
  }
  if (text.length > max) {
    const error = new Error(`${label} is too long.`);
    error.status = 400;
    throw error;
  }
  return text;
}

function optionalText(value, max = 4000) {
  if (value == null) return "";
  return String(value).trim().slice(0, max);
}

function normalizeThinking(value, fallback = "xhigh") {
  const allowed = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);
  const text = String(value || fallback).toLowerCase();
  return allowed.has(text) ? text : fallback;
}

function sessionParts(key = "") {
  const parts = String(key).split(":");
  return {
    raw: key,
    agentId: parts[1] || "main",
    surface: parts[2] || "main",
    scope: parts[3] || "",
    target: parts.slice(4).join(":"),
  };
}

function labelSession(session) {
  const key = session.key || "";
  const parts = sessionParts(key);
  if (parts.surface === "telegram" && parts.scope === "direct") return `Telegram ${parts.target}`;
  if (parts.surface === "telegram" && parts.scope === "group") return `Telegram group ${parts.target}`;
  if (parts.surface === "main" && parts.scope === "heartbeat") return "Heartbeat";
  if (parts.surface === "main") return "OpenClaw web chat";
  if (parts.surface === "subagent") return `Subagent ${parts.scope || session.sessionId || ""}`.trim();
  return key || session.sessionId || "Session";
}

function deliveryForSession(session) {
  const parts = sessionParts(session.key || "");
  const routeTarget = session.route?.target?.to || session.deliveryContext?.to || session.lastTo || "";
  if (parts.surface === "telegram") {
    const to = routeTarget.replace(/^telegram:/, "") || parts.target;
    return {
      available: Boolean(to),
      channel: "telegram",
      to,
      account: session.lastAccountId || session.deliveryContext?.accountId || session.route?.accountId || "",
      reason: "Telegram session",
    };
  }
  return {
    available: false,
    channel: "telegram",
    to: "",
    account: "",
    reason: "No channel delivery target detected",
  };
}

function ageLabel(updatedAt) {
  const value = Number(updatedAt);
  if (!Number.isFinite(value)) return "unknown";
  const delta = Math.max(0, Date.now() - value);
  const minutes = Math.round(delta / 60000);
  if (minutes < 2) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function normalizeSession(session) {
  const delivery = deliveryForSession(session);
  const parts = sessionParts(session.key || "");
  return {
    key: session.key,
    sessionId: session.sessionId || "",
    label: labelSession(session),
    subtitle: `${parts.agentId} / ${session.kind || parts.surface || "session"} / ${ageLabel(session.updatedAt)}`,
    agentId: session.agentId || parts.agentId,
    channel: parts.surface,
    scope: parts.scope,
    target: parts.target,
    kind: session.kind || "",
    updatedAt: session.updatedAt || null,
    model: [session.modelProvider, session.model].filter(Boolean).join("/") || "",
    thinkingLevel: session.thinkingLevel || "",
    tokens: session.totalTokens || 0,
    delivery,
    chatUrl: `${defaultGatewayHttp}/chat?session=${encodeURIComponent(session.key || "")}`,
  };
}

function sortSessions(sessions) {
  return [...sessions].sort((a, b) => {
    const telegramBias = (b.channel === "telegram" ? 1 : 0) - (a.channel === "telegram" ? 1 : 0);
    if (telegramBias) return telegramBias;
    const directBias = (b.scope === "direct" ? 1 : 0) - (a.scope === "direct" ? 1 : 0);
    if (directBias) return directBias;
    return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
  });
}

function buildPresets(settings) {
  return [
    {
      id: "now-check",
      title: "Ask now",
      message: "Check the current OpenClaw state and tell me what needs my attention.",
      schedule: { mode: "now" },
    },
    {
      id: "morning",
      title: "Morning check-in",
      message: "Good morning. Review current state, overnight events, and the next useful action. Keep it concise.",
      schedule: { mode: "cron", cron: "0 9 * * *", timezone: settings.defaultTimezone },
    },
    {
      id: "attention",
      title: "Attention sweep",
      message: "Scan sessions, tasks, cron jobs, and recent tool activity. Only message me if there is something actionable.",
      schedule: { mode: "every", every: "2h" },
    },
    {
      id: "later",
      title: "Remind later",
      message: "Follow up on this and tell me the smallest next step.",
      schedule: { mode: "at", at: "+30m" },
    },
  ];
}

async function collectBootstrap() {
  const settings = await readSettings();
  const [sessionsResult, cronResult, gatewayResult] = await Promise.all([
    execOpenClaw(["sessions", "--all-agents", "--json", "--limit", "all"], { timeoutMs: 20000 }),
    execOpenClaw(["cron", "list", "--json"], { timeoutMs: 15000 }),
    execOpenClaw(["gateway", "status"], { timeoutMs: 15000 }),
  ]);
  const sessionsJson = parseJson(sessionsResult.stdout, { sessions: [] });
  const cronJson = parseJson(cronResult.stdout, { jobs: [] });
  const sessions = sortSessions((sessionsJson.sessions || []).map(normalizeSession));
  const selected = settings.preferTelegramDirect
    ? sessions.find((session) => session.channel === "telegram" && session.scope === "direct") || sessions[0] || null
    : sessions[0] || null;
  return {
    ok: sessionsResult.ok,
    app: {
      name: "OpenClaw Automator",
      version: appVersion,
      port,
      stateDir,
      gatewayHttp: settings.gatewayHttp,
    },
    checks: {
      sessions: { ok: sessionsResult.ok, error: sessionsResult.stderr || sessionsResult.error },
      cron: { ok: cronResult.ok, error: cronResult.stderr || cronResult.error },
      gateway: { ok: gatewayResult.ok && /Connectivity probe:\s*ok|Gateway version:/i.test(gatewayResult.stdout), text: gatewayResult.stdout || gatewayResult.stderr },
    },
    settings,
    sessions,
    selectedSessionKey: selected?.key || "",
    jobs: cronJson.jobs || [],
    presets: buildPresets(settings),
    commands: {
      run: "openclaw agent --session-key <key> --message <text>",
      schedule: "openclaw cron add --session-key <key> --message <text>",
      event: "openclaw system event --session-key <key> --text <text>",
    },
  };
}

function agentArgs(body, settings) {
  const sessionKey = requireText(body.sessionKey, "Session key", 300);
  const message = requireText(body.message, "Message");
  const args = ["agent", "--session-key", sessionKey, "--message", message, "--json"];
  const thinking = normalizeThinking(body.thinking, settings.defaultThinking);
  if (thinking) args.push("--thinking", thinking);
  const timeout = Number(body.timeoutSeconds || settings.defaultTimeoutSeconds);
  if (Number.isFinite(timeout) && timeout > 0) args.push("--timeout", String(Math.round(timeout)));
  if (body.deliver) {
    args.push("--deliver");
    const replyChannel = optionalText(body.replyChannel || settings.replyChannel, 80);
    const replyTo = optionalText(body.replyTo, 300);
    if (replyChannel) args.push("--reply-channel", replyChannel);
    if (replyTo) args.push("--reply-to", replyTo);
    const replyAccount = optionalText(body.replyAccount, 120);
    if (replyAccount) args.push("--reply-account", replyAccount);
  }
  return args;
}

function cronArgs(body, settings) {
  const name = requireText(body.name || "OpenClaw automation", "Name", 120);
  const sessionKey = requireText(body.sessionKey, "Session key", 300);
  const mode = String(body.scheduleMode || "every");
  const args = ["cron", "add", "--name", name, "--session-key", sessionKey, "--json"];

  if (mode === "cron") {
    args.push("--cron", requireText(body.cron, "Cron expression", 80));
    const tz = optionalText(body.timezone || settings.defaultTimezone, 120);
    if (tz) args.push("--tz", tz);
  } else if (mode === "at") {
    args.push("--at", requireText(body.at, "Run time", 120));
    const tz = optionalText(body.timezone || settings.defaultTimezone, 120);
    if (tz) args.push("--tz", tz);
    if (body.deleteAfterRun !== false) args.push("--delete-after-run");
  } else {
    args.push("--every", requireText(body.every || "1h", "Interval", 40));
  }

  const jobMode = String(body.jobMode || "agent");
  if (jobMode === "system-event") {
    args.push("--system-event", requireText(body.message, "System event"));
  } else {
    args.push("--message", requireText(body.message, "Message"));
    const thinking = normalizeThinking(body.thinking, settings.defaultThinking);
    if (thinking) args.push("--thinking", thinking);
  }

  if (body.expectFinal !== false) args.push("--expect-final");
  if (body.announce || body.deliver) args.push("--announce");
  if (body.lightContext) args.push("--light-context");
  const timeoutSeconds = Number(body.timeoutSeconds || settings.defaultTimeoutSeconds);
  if (Number.isFinite(timeoutSeconds) && timeoutSeconds > 0) args.push("--timeout-seconds", String(Math.round(timeoutSeconds)));
  const channel = optionalText(body.channel || settings.replyChannel, 80);
  const to = optionalText(body.to || body.replyTo, 300);
  const wantsDelivery = Boolean(body.announce || body.deliver || to);
  if (wantsDelivery && channel) args.push("--channel", channel);
  if (wantsDelivery && to) args.push("--to", to);
  const account = optionalText(body.account || body.replyAccount, 120);
  if (wantsDelivery && account) args.push("--account", account);
  const tools = Array.isArray(body.tools) ? body.tools.join(",") : optionalText(body.tools, 500);
  if (tools) args.push("--tools", tools);
  const wake = optionalText(body.wake, 40);
  if (wake) args.push("--wake", wake);
  if (body.disabled) args.push("--disabled");
  return args;
}

function eventArgs(body) {
  const sessionKey = requireText(body.sessionKey, "Session key", 300);
  const text = requireText(body.text || body.message, "Event text");
  const mode = String(body.mode || "next-heartbeat");
  const args = ["system", "event", "--session-key", sessionKey, "--text", text, "--mode", mode, "--json"];
  if (body.expectFinal) args.push("--expect-final");
  const timeout = Number(body.timeoutMs || 30000);
  if (Number.isFinite(timeout) && timeout > 0) args.push("--timeout", String(Math.round(timeout)));
  return args;
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
  await appendAudit({
    kind,
    ok: result.ok,
    command: displayCommand(args),
    code: result.code,
    durationMs: payload.durationMs,
  });
  return payload;
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/health") {
    jsonResponse(res, 200, { ok: true, app: "OpenClaw Automator", version: appVersion, port });
    return;
  }
  if (req.method === "GET" && pathname === "/api/bootstrap") {
    jsonResponse(res, 200, await collectBootstrap());
    return;
  }
  if (req.method === "GET" && pathname === "/api/settings") {
    jsonResponse(res, 200, { ok: true, settings: await readSettings() });
    return;
  }
  if (req.method === "POST" && pathname === "/api/settings") {
    const body = await readJsonBody(req);
    jsonResponse(res, 200, { ok: true, settings: await writeSettings(body) });
    return;
  }
  if (req.method === "POST" && pathname === "/api/preview") {
    const settings = await readSettings();
    const body = await readJsonBody(req);
    const kind = String(body.kind || "agent");
    const args = kind === "cron" ? cronArgs(body, settings) : kind === "event" ? eventArgs(body) : agentArgs(body, settings);
    jsonResponse(res, 200, { ok: true, kind, command: displayCommand(args), args });
    return;
  }
  if (req.method === "POST" && pathname === "/api/agent/run") {
    const settings = await readSettings();
    const body = await readJsonBody(req);
    const args = agentArgs(body, settings);
    jsonResponse(res, 200, await runCommand("agent", args, (Number(body.timeoutSeconds || settings.defaultTimeoutSeconds) + 20) * 1000));
    return;
  }
  if (req.method === "POST" && pathname === "/api/cron/create") {
    const settings = await readSettings();
    const body = await readJsonBody(req);
    const args = cronArgs(body, settings);
    jsonResponse(res, 200, await runCommand("cron", args, 30000));
    return;
  }
  if (req.method === "POST" && pathname === "/api/system/event") {
    const body = await readJsonBody(req);
    const args = eventArgs(body);
    jsonResponse(res, 200, await runCommand("system-event", args, Number(body.timeoutMs || 30000) + 10000));
    return;
  }
  errorResponse(res, 404, "API route not found.");
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const safePath = resolve(publicDir, `.${decodeURIComponent(requested)}`);
  if (!safePath.startsWith(publicDir)) {
    errorResponse(res, 403, "Forbidden");
    return;
  }
  try {
    const info = await stat(safePath);
    if (!info.isFile()) throw new Error("not file");
    const type = contentTypes.get(extname(safePath)) || "application/octet-stream";
    res.writeHead(200, {
      "content-type": type,
      "cache-control": "no-store",
    });
    res.end(await readFile(safePath));
  } catch {
    errorResponse(res, 404, "File not found.");
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || `127.0.0.1:${port}`}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
      return;
    }
    await serveStatic(req, res, url.pathname);
  } catch (error) {
    errorResponse(res, error.status || 500, error.message || "Unexpected server error.");
  }
});

await ensureStateDir();
if (!existsSync(settingsPath)) {
  await writeSettings(defaultSettings);
}

server.listen(port, "127.0.0.1", () => {
  console.log(`OpenClaw Automator listening at http://127.0.0.1:${port}/`);
});

import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const appRoot = resolve(__dirname, "..");
const publicDir = join(__dirname, "public");
const port = Number(process.env.OPENCLAW_AUTOMATOR_PORT || 18890);
const stateDir = join(homedir(), ".openclaw", "automator");
const workflowsDir = join(stateDir, "workflows");
const settingsPath = join(stateDir, "settings.json");
const auditPath = join(stateDir, "automation-log.jsonl");
const defaultGatewayHttp = process.env.OPENCLAW_AUTOMATOR_GATEWAY_HTTP || "http://127.0.0.1:18789";
const openclawCommand = process.env.OPENCLAW_BIN || (process.platform === "win32" ? "openclaw.cmd" : "openclaw");
const openclawMjs = process.env.APPDATA ? join(process.env.APPDATA, "npm", "node_modules", "openclaw", "openclaw.mjs") : "";
const appVersion = "0.4.7";

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

function workflowPath(id) {
  const safe = String(id || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) {
    const error = new Error("Workflow id is required.");
    error.status = 400;
    throw error;
  }
  return join(workflowsDir, `${safe}.json`);
}

async function readWorkflow(id) {
  return parseJson(await readFile(workflowPath(id), "utf8"), null);
}

async function writeWorkflow(workflow) {
  await ensureStateDir();
  workflow.updatedAt = new Date().toISOString();
  await writeFile(workflowPath(workflow.id), `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
  return workflow;
}

function parseWorkflowSteps(value = []) {
  if (!Array.isArray(value)) return [];
  return value
    .map((step, index) => ({
      index,
      name: optionalText(step?.name, 400),
      action: optionalText(step?.action, 1000),
      done: optionalText(step?.done, 1000),
      note: optionalText(step?.note, 1000),
    }))
    .filter((step) => step.name || step.action || step.done || step.note)
    .map((step, index) => ({
      ...step,
      index,
      name: step.name || step.action || step.done || step.note,
      action: step.action || step.name || step.done || step.note,
    }));
}

function workflowControllerRequested(body) {
  const workflow = body.workflow || {};
  const mode = String(body.scheduleMode || "now");
  if (!workflow.stepPlanEnabled) return false;
  if (String(body.jobMode || "agent") === "system-event") return false;
  if (mode !== "every" && mode !== "cron") return false;
  return parseWorkflowSteps(workflow.steps).length > 0;
}

function psSingle(value) {
  return String(value ?? "").replace(/'/g, "''");
}

function workflowAdvanceCommand(workflow, step, status) {
  const body = `@{ jobId = '${psSingle(workflow.jobId)}'; stepIndex = ${step.index}; status = '${status}'; summary = 'replace with short result' } | ConvertTo-Json -Compress`;
  return `powershell -NoProfile -ExecutionPolicy Bypass -Command "$body = ${body}; Invoke-RestMethod -Method POST -Uri 'http://127.0.0.1:${port}/api/workflows/${workflow.id}/advance' -ContentType 'application/json' -Body $body"`;
}

function workflowStepMessage(workflow) {
  const step = workflow.steps[workflow.currentIndex] || workflow.steps[workflow.steps.length - 1];
  const lines = [
    workflow.baseMessage,
    "",
    "Important research and development, and final output to be realized on this session. Final output. Consequence: will auto apply and persist. After complete changes blocked for good. Starter info:",
    `- Workflow ID: ${workflow.id}`,
    `- Cron job ID: ${workflow.jobId || "pending"}`,
    `- Workflow: ${workflow.name || "Unnamed workflow"}`,
    //`- Active step: ${step.index + 1} of ${workflow.steps.length}`,
    `- Research and development name: ${step.name}`,
    `- Deep thinking, safetywork, background work an concrete problem solving on: ${step.action}. Then minimal most efficient output that resolves this longterm and does not need to be patched in the future by claude. If the job is impossible for you; stop, then research online or ask. But if you are capable getting this done then go ahead.`,
  ];
  if (step.done) lines.push(`- Done when: ${step.done}`);
  if (step.note) lines.push(`- State note: ${step.note}`);
  lines.push(
    `If COMPLETE, call: ${workflowAdvanceCommand(workflow, step, "complete")}`,
    `If BLOCKED, call: ${workflowAdvanceCommand(workflow, step, "blocked")}`,
    `If FAILED, call: ${workflowAdvanceCommand(workflow, step, "failed")}`,
  );
  return lines.join("\n");
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
    execOpenClaw(["cron", "list", "--all", "--json"], { timeoutMs: 15000 }),
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
  const agent = optionalText(body.agent, 120);
  if (agent) args.push("--agent", agent);
  const model = optionalText(body.model, 200);
  if (model) args.push("--model", model);
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
  const jobMode = String(body.jobMode || "agent");
  const requestedSessionTarget = optionalText(body.sessionTarget, 80);
  const sessionTarget = requestedSessionTarget || (jobMode === "system-event" ? "main" : "isolated");
  const args = ["cron", "add", "--name", name, "--session-key", sessionKey, "--session", sessionTarget, "--json"];
  const description = optionalText(body.description, 1000);
  if (description) args.push("--description", description);
  const agent = optionalText(body.agent, 120);
  if (agent) args.push("--agent", agent);
  if (body.enabled === false || body.disabled) args.push("--disabled");

  if (mode === "cron") {
    args.push("--cron", requireText(body.cron, "Cron expression", 80));
    const tz = optionalText(body.timezone || settings.defaultTimezone, 120);
    if (tz) args.push("--tz", tz);
    if (body.exactTiming) args.push("--exact");
    const stagger = optionalText(body.stagger, 40);
    if (stagger) args.push("--stagger", stagger);
  } else if (mode === "at") {
    args.push("--at", requireText(body.at, "Run time", 120));
    const tz = optionalText(body.timezone || settings.defaultTimezone, 120);
    if (tz) args.push("--tz", tz);
    args.push(body.deleteAfterRun === false ? "--keep-after-run" : "--delete-after-run");
  } else {
    args.push("--every", requireText(body.every || "1h", "Interval", 40));
  }

  if (jobMode === "system-event") {
    args.push("--system-event", requireText(body.message, "System event"));
  } else {
    args.push("--message", requireText(body.message, "Message"));
    const model = optionalText(body.model, 200);
    if (model) args.push("--model", model);
    const thinking = normalizeThinking(body.thinking, settings.defaultThinking);
    if (thinking) args.push("--thinking", thinking);
  }

  const deliveryMode = optionalText(body.deliveryMode, 40) || (body.announce || body.deliver ? "notify" : "quiet");
  if (jobMode !== "system-event" && body.expectFinal !== false) args.push("--expect-final");
  if (jobMode !== "system-event") {
    if (deliveryMode === "notify") args.push("--announce");
    else if (deliveryMode === "webhook") args.push("--webhook", requireText(body.webhook, "Webhook URL", 1000));
    else args.push("--no-deliver");
  }
  if (jobMode !== "system-event" && body.lightContext) args.push("--light-context");
  const timeoutSeconds = Number(body.timeoutSeconds || settings.defaultTimeoutSeconds);
  if (jobMode !== "system-event" && Number.isFinite(timeoutSeconds) && timeoutSeconds > 0) args.push("--timeout-seconds", String(Math.round(timeoutSeconds)));
  const channel = optionalText(body.channel || settings.replyChannel, 80);
  const to = optionalText(body.to || body.replyTo, 300);
  const wantsDelivery = jobMode !== "system-event" && deliveryMode === "notify";
  if (wantsDelivery && channel) args.push("--channel", channel);
  if (wantsDelivery && to) args.push("--to", to);
  const account = optionalText(body.account || body.replyAccount, 120);
  if (wantsDelivery && account) args.push("--account", account);
  if (jobMode !== "system-event" && (deliveryMode === "notify" || deliveryMode === "webhook") && body.bestEffortDelivery) {
    args.push("--best-effort-deliver");
  }
  const tools = Array.isArray(body.tools) ? body.tools.join(",") : optionalText(body.tools, 500);
  if (tools) args.push("--tools", tools);
  const wake = optionalText(body.wake, 40);
  if (wake) args.push("--wake", wake);
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

async function createCronWorkflow(body, settings) {
  const workflowBody = body.workflow || {};
  const steps = parseWorkflowSteps(workflowBody.steps);
  const workflow = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    jobId: "",
    status: "creating",
    currentIndex: 0,
    name: optionalText(workflowBody.name || body.name || "OpenClaw workflow", 200),
    baseMessage: requireText(body.baseMessage || body.message, "Message"),
    steps,
    history: [],
  };
  await writeWorkflow(workflow);

  const requestedEnabled = body.enabled !== false && !body.disabled;
  const firstBody = {
    ...body,
    enabled: false,
    disabled: true,
    message: workflowStepMessage(workflow),
  };
  const addArgs = cronArgs(firstBody, settings);
  const addResult = await runCommand("cron", addArgs, 30000);
  const jobId = addResult.json?.id || "";
  if (!addResult.ok || !jobId) {
    workflow.status = "create_failed";
    workflow.history.push({ at: new Date().toISOString(), status: "create_failed", summary: addResult.stderr || addResult.error || "cron add failed" });
    await writeWorkflow(workflow);
    return { ...addResult, workflow };
  }

  workflow.jobId = jobId;
  workflow.status = requestedEnabled ? "active" : "disabled";
  await writeWorkflow(workflow);

  const editMessageArgs = ["cron", "edit", jobId, "--message", workflowStepMessage(workflow)];
  const editMessageResult = await execOpenClaw(editMessageArgs, { timeoutMs: 30000 });
  const enableArgs = requestedEnabled ? ["cron", "edit", jobId, "--enable"] : null;
  const enableResult = enableArgs ? await execOpenClaw(enableArgs, { timeoutMs: 30000 }) : null;
  const ok = addResult.ok && editMessageResult.ok && (!enableResult || enableResult.ok);
  await appendAudit({
    kind: "workflow-cron",
    ok,
    command: displayCommand(addArgs),
    code: ok ? 0 : editMessageResult.code || enableResult?.code || addResult.code,
    durationMs: addResult.durationMs,
  });
  return {
    ...addResult,
    ok,
    workflow,
    controller: {
      enabled: true,
      workflowId: workflow.id,
      jobId,
      addCommand: displayCommand(addArgs),
      editMessageCommand: displayCommand(editMessageArgs),
      enableCommand: enableArgs ? displayCommand(enableArgs) : "",
      editMessage: {
        ok: editMessageResult.ok,
        stdout: editMessageResult.stdout,
        stderr: editMessageResult.stderr,
        error: editMessageResult.error,
      },
      enable: enableResult ? {
        ok: enableResult.ok,
        stdout: enableResult.stdout,
        stderr: enableResult.stderr,
        error: enableResult.error,
      } : null,
    },
  };
}

async function advanceWorkflow(id, body) {
  const workflow = await readWorkflow(id);
  if (!workflow) {
    const error = new Error("Workflow not found.");
    error.status = 404;
    throw error;
  }
  const jobId = optionalText(body.jobId, 120);
  if (jobId !== workflow.jobId) {
    const error = new Error("Workflow job id mismatch.");
    error.status = 400;
    throw error;
  }
  const stepIndex = Number(body.stepIndex);
  if (!Number.isInteger(stepIndex) || stepIndex !== workflow.currentIndex) {
    return { ok: true, advanced: false, workflow, reason: "stale step report ignored" };
  }
  const status = String(body.status || "").toLowerCase();
  const summary = optionalText(body.summary, 1000);
  workflow.history.push({
    at: new Date().toISOString(),
    stepIndex,
    status,
    summary,
  });

  if (["complete", "completed", "done", "success"].includes(status)) {
    workflow.steps[stepIndex].status = "complete";
    workflow.steps[stepIndex].completedAt = new Date().toISOString();
    workflow.currentIndex += 1;
    if (workflow.currentIndex >= workflow.steps.length) {
      workflow.status = "complete";
      const disableArgs = ["cron", "edit", workflow.jobId, "--disable", "--description", `${workflow.name} completed by workflow controller.`];
      const disableResult = await execOpenClaw(disableArgs, { timeoutMs: 30000 });
      await writeWorkflow(workflow);
      return { ok: disableResult.ok, advanced: true, complete: true, workflow, command: displayCommand(disableArgs), result: disableResult };
    }
    workflow.status = "active";
    const editArgs = ["cron", "edit", workflow.jobId, "--message", workflowStepMessage(workflow)];
    const editResult = await execOpenClaw(editArgs, { timeoutMs: 30000 });
    await writeWorkflow(workflow);
    return { ok: editResult.ok, advanced: true, complete: false, workflow, command: displayCommand(editArgs), result: editResult };
  }

  if (["blocked", "failed", "fail", "error"].includes(status)) {
    workflow.status = status === "blocked" ? "blocked" : "failed";
    workflow.steps[stepIndex].status = workflow.status;
    workflow.steps[stepIndex].lastSummary = summary;
    await writeWorkflow(workflow);
    return { ok: true, advanced: false, workflow, reason: `step marked ${workflow.status}; active step unchanged` };
  }

  await writeWorkflow(workflow);
  return { ok: true, advanced: false, workflow, reason: "unknown status; active step unchanged" };
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
    if (workflowControllerRequested(body)) {
      jsonResponse(res, 200, await createCronWorkflow(body, settings));
      return;
    }
    const args = cronArgs(body, settings);
    jsonResponse(res, 200, await runCommand("cron", args, 30000));
    return;
  }
  if (req.method === "POST" && pathname.startsWith("/api/workflows/") && pathname.endsWith("/advance")) {
    const id = decodeURIComponent(pathname.split("/")[3] || "");
    const body = await readJsonBody(req);
    jsonResponse(res, 200, await advanceWorkflow(id, body));
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

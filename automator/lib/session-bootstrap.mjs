import {
  appVersion,
  defaultGatewayHttp,
  port,
  stateDir,
} from "./config.mjs";
import { readRuntimeSettings, execOpenClaw } from "./openclaw.mjs";
import { sessionParts } from "./session-utils.mjs";
import { parseJson } from "./utils.mjs";
import { workflowLogUrl, workflowMapByJobId } from "./workflows.mjs";

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
  const settings = await readRuntimeSettings();
  const [sessionsResult, cronResult, gatewayResult] = await Promise.all([
    execOpenClaw(["sessions", "--all-agents", "--json", "--limit", "all"], { timeoutMs: 20000, stdoutMax: 2 * 1024 * 1024 }),
    execOpenClaw(["cron", "list", "--all", "--json"], { timeoutMs: 15000, stdoutMax: 5 * 1024 * 1024 }),
    execOpenClaw(["gateway", "status"], { timeoutMs: 15000 }),
  ]);
  const sessionsJson = parseJson(sessionsResult.stdout, { sessions: [] });
  const cronJson = parseJson(cronResult.stdout, { jobs: [] });
  const workflowsByJobId = await workflowMapByJobId();
  const jobs = (cronJson.jobs || []).map((job) => {
    const workflow = workflowsByJobId.get(job.id);
    if (!workflow) return job;
    return {
      ...job,
      workflow: {
        id: workflow.id,
        name: workflow.name || "",
        status: workflow.status || "",
        currentIndex: workflow.currentIndex ?? 0,
        eventCount: Array.isArray(workflow.events) ? workflow.events.length : 0,
        logUrl: workflowLogUrl(workflow),
      },
    };
  });
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
    jobs,
    presets: buildPresets(settings),
    commands: {
      run: "openclaw agent --session-key <key> --message <text>",
      schedule: "openclaw cron add --session-key <key> --message <text>",
      event: "openclaw system event --session-key <key> --text <text>",
    },
  };
}

export {
  ageLabel,
  buildPresets,
  collectBootstrap,
  deliveryForSession,
  labelSession,
  normalizeSession,
  sortSessions,
};

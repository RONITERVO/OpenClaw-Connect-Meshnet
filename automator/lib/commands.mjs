import { cronNotifySupport } from "./channels.mjs";
import { optionalText, requireText } from "./utils.mjs";

const subagentCoordinationTools = ["agents_list", "sessions_spawn", "sessions_yield", "subagents"];

function normalizeThinking(value, fallback = "xhigh") {
  const allowed = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);
  const text = String(value || fallback).toLowerCase();
  return allowed.has(text) ? text : fallback;
}

function normalizePositiveInteger(value, fallback = null) {
  const selected = value == null || value === "" ? fallback : value;
  const parsed = Number(selected);
  if (Number.isFinite(parsed) && parsed > 0) return Math.max(1, Math.round(parsed));
  const fallbackParsed = Number(fallback);
  return Number.isFinite(fallbackParsed) && fallbackParsed > 0 ? Math.max(1, Math.round(fallbackParsed)) : null;
}

function normalizeToolList(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[,\s]+/);
  const seen = new Set();
  const tools = [];
  for (const item of raw) {
    const tool = optionalText(item, 80);
    if (!tool || seen.has(tool)) continue;
    seen.add(tool);
    tools.push(tool);
  }
  return tools;
}

function mergeToolList(value, extras = []) {
  return normalizeToolList([...normalizeToolList(value), ...extras]);
}

function wantsSubagents(body = {}) {
  return body.useSubagents === true || body.subagents === true || body.allowSubagents === true;
}

function normalizeSubagentTargets(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[,\n]+/);
  return raw
    .map((item) => optionalText(item, 80))
    .filter(Boolean)
    .slice(0, 20);
}

function applyCronMessageGuidance(message, body = {}) {
  const text = requireText(message, "Message");
  if (!wantsSubagents(body) || /Subagent coordination requested:/i.test(text)) return text;
  const targets = normalizeSubagentTargets(body.subagentAgents || body.subagentTargets);
  const targetLine = targets.length
    ? `- Preferred target agents, if they are configured and allowed: ${targets.join(", ")}.`
    : "- Use the requester/default agent unless agents_list is available and shows another configured and allowed target that better fits the task.";
  return [
    text,
    "",
    "Subagent coordination requested:",
    "- Use sessions_spawn for side-effect-free advisory work: research, critique, fact-checking, brainstorming, comparison, context inspection, or review of draft output.",
    "- Subagents expand perspective, not authority. They report findings only and must not mutate files, configs, schedulers, repositories, workflow state, messages, or external systems.",
    "- The parent agent owns the final answer and all side effects. Review subagent findings, decide which critiques are valid, fix valid issues yourself, and only then report PROGRESS or COMPLETE.",
    "- COMPLETE only when no valid blocking critique remains and the requested done condition is proven. Use PROGRESS when useful work advanced but valid critique or uncertainty remains. Use BLOCKED only when valid critique cannot be resolved without user input or external state.",
    "- After spawning required child work, use sessions_yield when available and synthesize the returned child results into one final answer.",
    "- Do not poll subagent status in a loop; inspect status only for debugging when status tools are available.",
    targetLine,
    "- If subagent tools are unavailable, explain the needed OpenClaw tool policy: expose sessions_spawn, sessions_yield, subagents, and agents_list through the requester profile or tools.alsoAllow.",
    "- For safer deployments, restrict spawned helper agents with tools.subagents.tools so advisory subagents stay research/review scoped; avoid child exec access unless shell access is intentionally needed.",
    "- If a requested target agent is not available, explain the needed OpenClaw config: agents.defaults.subagents.allowAgents or the requester's agents.list[].subagents.allowAgents.",
    "- Avoid nested subagents for normal Automator jobs. Nested advisory delegation requires OpenClaw config agents.defaults.subagents.maxSpawnDepth >= 2; Automator cannot set that config from a cron command.",
  ].join("\n");
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
  const timeout = normalizePositiveInteger(body.timeoutSeconds, settings.defaultTimeoutSeconds);
  if (timeout) args.push("--timeout", String(timeout));
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
    args.push("--message", applyCronMessageGuidance(body.message, body));
    const model = optionalText(body.model, 200);
    if (model) args.push("--model", model);
    const thinking = normalizeThinking(body.thinking, settings.defaultThinking);
    if (thinking) args.push("--thinking", thinking);
  }

  const requestedDeliveryMode = optionalText(body.deliveryMode, 40) || (body.announce || body.deliver ? "notify" : "quiet");
  const requestedChannel = optionalText(body.channel || settings.replyChannel, 80);
  const deliveryMode = requestedDeliveryMode === "notify" && !cronNotifySupport(requestedChannel, settings).ok
    ? "quiet"
    : requestedDeliveryMode;
  if (jobMode !== "system-event" && body.expectFinal !== false) args.push("--expect-final");
  if (jobMode !== "system-event") {
    if (deliveryMode === "notify") args.push("--announce");
    else if (deliveryMode === "webhook") args.push("--webhook", requireText(body.webhook, "Webhook URL", 1000));
    else args.push("--no-deliver");
  }
  if (jobMode !== "system-event" && body.lightContext) args.push("--light-context");
  const timeoutSeconds = normalizePositiveInteger(body.timeoutSeconds, settings.defaultTimeoutSeconds);
  if (jobMode !== "system-event" && timeoutSeconds) args.push("--timeout-seconds", String(timeoutSeconds));
  const channel = requestedChannel;
  const to = optionalText(body.to || body.replyTo, 300);
  const wantsDelivery = jobMode !== "system-event" && deliveryMode === "notify";
  if (wantsDelivery && channel) args.push("--channel", channel);
  if (wantsDelivery && to) args.push("--to", to);
  const account = optionalText(body.account || body.replyAccount, 120);
  if (wantsDelivery && account) args.push("--account", account);
  if (jobMode !== "system-event" && (deliveryMode === "notify" || deliveryMode === "webhook") && body.bestEffortDelivery) {
    args.push("--best-effort-deliver");
  }
  const requestedTools = normalizeToolList(body.tools);
  const tools = jobMode !== "system-event" && wantsSubagents(body) && requestedTools.length
    ? mergeToolList(requestedTools, subagentCoordinationTools)
    : requestedTools;
  if (tools.length) args.push("--tools", tools.join(","));
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
  const timeout = normalizePositiveInteger(body.timeoutMs, 30000);
  if (timeout) args.push("--timeout", String(timeout));
  return args;
}

export {
  agentArgs,
  applyCronMessageGuidance,
  cronArgs,
  eventArgs,
  mergeToolList,
  normalizePositiveInteger,
  normalizeThinking,
  normalizeToolList,
  subagentCoordinationTools,
};

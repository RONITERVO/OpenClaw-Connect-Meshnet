import { cronNotifySupport } from "./channels.mjs";
import { optionalText, requireText } from "./utils.mjs";

const subagentCoordinationTools = ["agents_list", "sessions_spawn", "sessions_yield", "subagents"];
const autoContinueTimeoutSeconds = 24 * 24 * 60 * 60;
const monthNames = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const dayNames = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};
const durationUnitsSeconds = {
  ms: 0.001,
  millisecond: 0.001,
  milliseconds: 0.001,
  s: 1,
  sec: 1,
  secs: 1,
  second: 1,
  seconds: 1,
  m: 60,
  min: 60,
  mins: 60,
  minute: 60,
  minutes: 60,
  h: 60 * 60,
  hr: 60 * 60,
  hrs: 60 * 60,
  hour: 60 * 60,
  hours: 60 * 60,
  d: 24 * 60 * 60,
  day: 24 * 60 * 60,
  days: 24 * 60 * 60,
  w: 7 * 24 * 60 * 60,
  week: 7 * 24 * 60 * 60,
  weeks: 7 * 24 * 60 * 60,
};

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

function parseDurationSeconds(value) {
  const text = optionalText(value, 80).toLowerCase();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Math.max(1, Math.round(Number(text)));
  const tokenPattern = /(\d+(?:\.\d+)?)\s*([a-z]+)/g;
  let total = 0;
  let consumed = "";
  for (const match of text.matchAll(tokenPattern)) {
    const unitSeconds = durationUnitsSeconds[match[2]];
    const amount = Number(match[1]);
    if (!unitSeconds || !Number.isFinite(amount) || amount <= 0) return null;
    total += amount * unitSeconds;
    consumed += match[0];
  }
  const stripped = text.replace(/[\s,_-]+/g, "");
  if (!total || consumed.replace(/[\s,_-]+/g, "") !== stripped) return null;
  return Math.max(1, Math.round(total));
}

function cronFieldTokenValue(token, names = null, { dayOfWeek = false } = {}) {
  const clean = String(token || "").trim().toLowerCase().replace(/^\+/, "");
  const named = names?.[clean];
  if (named != null) return named;
  if (!/^\d+$/.test(clean)) return null;
  const parsed = Number(clean);
  if (!Number.isSafeInteger(parsed)) return null;
  if (dayOfWeek && parsed === 7) return 0;
  return parsed;
}

function parseCronField(field, min, max, options = {}) {
  const text = optionalText(field, 80).toLowerCase();
  const wildcard = text === "*" || text === "?";
  const values = new Set();
  if (!text) return null;
  for (const rawPart of text.split(",")) {
    const part = rawPart.trim();
    if (!part) return null;
    const pieces = part.split("/");
    if (pieces.length > 2) return null;
    const rangeText = pieces[0] || "*";
    const step = pieces[1] == null ? 1 : Number(pieces[1]);
    if (!Number.isSafeInteger(step) || step <= 0) return null;
    let start = min;
    let end = max;
    if (rangeText !== "*" && rangeText !== "?") {
      if (/[lw#]/i.test(rangeText)) return null;
      const rangeParts = rangeText.split("-");
      if (rangeParts.length > 2) return null;
      start = cronFieldTokenValue(rangeParts[0], options.names, { dayOfWeek: options.dayOfWeek });
      end = rangeParts.length === 2 ? cronFieldTokenValue(rangeParts[1], options.names, { dayOfWeek: options.dayOfWeek }) : start;
      if (options.dayOfWeek && rangeParts.length === 2 && String(rangeParts[0]).trim() === "0" && String(rangeParts[1]).trim() === "7") end = 6;
      if (start == null || end == null) return null;
    }
    if (start < min || start > max || end < min || end > max) return null;
    if (start <= end) {
      for (let value = start; value <= end; value += step) values.add(value);
    } else if (options.dayOfWeek) {
      for (let value = start; value <= max; value += step) values.add(value);
      for (let value = min; value <= end; value += step) values.add(value);
    } else {
      return null;
    }
  }
  if (!values.size) return null;
  return {
    values: [...values].sort((a, b) => a - b),
    wildcard,
  };
}

function cronDayMatches(date, fields) {
  const month = date.getUTCMonth() + 1;
  if (!fields.month.values.includes(month)) return false;
  const dom = date.getUTCDate();
  const dow = date.getUTCDay();
  const domMatches = fields.dom.values.includes(dom);
  const dowMatches = fields.dow.values.includes(dow);
  if (fields.dom.wildcard && fields.dow.wildcard) return true;
  if (fields.dom.wildcard) return dowMatches;
  if (fields.dow.wildcard) return domMatches;
  return domMatches || dowMatches;
}

function parseCronExpression(expr) {
  const parts = optionalText(expr, 120).split(/\s+/).filter(Boolean);
  if (parts.length !== 5 && parts.length !== 6) return null;
  const [secondText, minuteText, hourText, domText, monthText, dowText] = parts.length === 6
    ? parts
    : ["0", ...parts];
  const fields = {
    second: parseCronField(secondText, 0, 59),
    minute: parseCronField(minuteText, 0, 59),
    hour: parseCronField(hourText, 0, 23),
    dom: parseCronField(domText, 1, 31),
    month: parseCronField(monthText, 1, 12, { names: monthNames }),
    dow: parseCronField(dowText, 0, 6, { names: dayNames, dayOfWeek: true }),
  };
  return Object.values(fields).every(Boolean) ? fields : null;
}

function minCronExpressionIntervalSeconds(expr) {
  const fields = parseCronExpression(expr);
  if (!fields) return null;
  const times = [];
  for (const hour of fields.hour.values) {
    for (const minute of fields.minute.values) {
      for (const second of fields.second.values) {
        times.push(hour * 3600 + minute * 60 + second);
      }
    }
  }
  times.sort((a, b) => a - b);
  if (!times.length) return null;
  let intraDayGap = Infinity;
  for (let index = 1; index < times.length; index += 1) {
    intraDayGap = Math.min(intraDayGap, times[index] - times[index - 1]);
  }

  let minGap = Infinity;
  let matchedDay = false;
  let previousOccurrence = null;
  const start = Date.UTC(2026, 0, 1);
  const horizonDays = 366 * 12;
  for (let day = 0; day < horizonDays; day += 1) {
    const dayStartMs = start + day * 24 * 60 * 60 * 1000;
    const date = new Date(dayStartMs);
    if (!cronDayMatches(date, fields)) continue;
    matchedDay = true;
    minGap = Math.min(minGap, intraDayGap);
    const firstOccurrence = dayStartMs / 1000 + times[0];
    if (previousOccurrence != null) minGap = Math.min(minGap, firstOccurrence - previousOccurrence);
    if (minGap <= 1) return 1;
    previousOccurrence = dayStartMs / 1000 + times[times.length - 1];
  }
  return matchedDay && Number.isFinite(minGap) ? Math.max(1, Math.round(minGap)) : null;
}

function cronTimeoutSeconds(body, settings) {
  const fallback = normalizePositiveInteger(settings.defaultTimeoutSeconds, 600) || 600;
  if (workflowAutoContinueEnabled(body)) return autoContinueTimeoutSeconds;
  const mode = String(body.scheduleMode || "every");
  if (mode === "every") return parseDurationSeconds(body.every || "1h") || fallback;
  if (mode === "cron") return minCronExpressionIntervalSeconds(body.cron) || fallback;
  return fallback;
}

function workflowAutoContinueEnabled(body = {}) {
  const workflow = body.workflow || {};
  if (body.autoContinue === false || workflow.autoContinue === false) return false;
  if (body.autoContinue === true || workflow.autoContinue === true) return true;
  return workflow.stepPlanEnabled === true;
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
    "- Advisory subagent review is required for this run when sessions_spawn is available; do not treat it as optional.",
    "- After understanding the task and before finalizing work, use sessions_spawn to create multiple side-effect-free reviewer subagents.",
    "- Spawn at least three distinct advisory reviewers when practical: correctness/safety, completeness/user-intent, and quality/edge-case.",
    "- For creative or non-coding work, adapt reviewer roles to the task, such as continuity, style, audience, structure, factuality, rhythm, or originality.",
    "- Each subagent may only research, critique, fact-check, brainstorm, compare, inspect context, or review draft output. Subagents must not edit files, mutate workflow state, change configs, touch schedulers, send messages, commit code, or affect external systems.",
    "- If sessions_spawn fails or is unavailable, including missing scope: operator.write or another authorization/tool error, immediately use the current agent runtime's native read-only advisory reviewers if available. If no native reviewer mechanism exists, run three explicit self-review passes using the same reviewer lanes.",
    "- Use sessions_yield only after OpenClaw sessions_spawn actually created reviewer sessions. Do not call sessions_yield after failed or unavailable spawns, and never end the run after yielding without reporting PROGRESS, COMPLETE, BLOCKED, or FAILED.",
    "- After successful reviewer creation, use the matching wait/yield mechanism when available and wait for findings. Treat their feedback seriously.",
    "- The parent agent must review every returned critique, decide whether it is valid, invalid, or intentionally deferred, and fix every valid critique that affects correctness, safety, user intent, continuity, completeness, or quality before reporting PROGRESS or COMPLETE.",
    "- The parent agent owns all side effects and final output. Report COMPLETE only when the requested done condition is proven and no valid blocking subagent critique remains unresolved. Report PROGRESS if useful work advanced but valid critique, uncertainty, or follow-up remains.",
    "- Do not poll subagent status in a loop; inspect status only for debugging when status tools are available.",
    targetLine,
    "- If OpenClaw subagent tools are unavailable, continue through the fallback review path and include the needed OpenClaw tool policy in the final report: expose sessions_spawn, sessions_yield, subagents, and agents_list through the requester profile or tools.alsoAllow.",
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
  const timeoutSeconds = cronTimeoutSeconds(body, settings);
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
  autoContinueTimeoutSeconds,
  cronTimeoutSeconds,
  cronArgs,
  eventArgs,
  mergeToolList,
  minCronExpressionIntervalSeconds,
  normalizePositiveInteger,
  normalizeThinking,
  normalizeToolList,
  parseDurationSeconds,
  subagentCoordinationTools,
};

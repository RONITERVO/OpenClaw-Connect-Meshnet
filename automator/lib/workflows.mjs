import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { port, workflowsDir } from "./config.mjs";
import { appendAudit, ensureStateDir, writeJsonFileAtomic } from "./state.mjs";
import { cronArgs } from "./commands.mjs";
import { displayCommand, execOpenClaw, runCommand } from "./openclaw.mjs";
import { sessionParts } from "./session-utils.mjs";
import { compactText, optionalText, parseJson, pathIsInside, readTextTail, requireText } from "./utils.mjs";

function workflowPath(id) {
  const safe = String(id || "");
  if (!/^[a-zA-Z0-9_-]+$/.test(safe)) {
    const error = new Error(safe ? "Workflow id is invalid." : "Workflow id is required.");
    error.status = 400;
    throw error;
  }
  return join(workflowsDir, `${safe}.json`);
}

const workflowLocks = new Map();

async function withWorkflowLock(id, task) {
  const key = String(id || "");
  const previous = workflowLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  const next = previous.catch(() => {}).then(() => current);
  workflowLocks.set(key, next);
  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    release();
    if (workflowLocks.get(key) === next) workflowLocks.delete(key);
  }
}

async function readWorkflow(id) {
  try {
    return parseJson(await readFile(workflowPath(id), "utf8"), null);
  } catch {
    return null;
  }
}

async function writeWorkflow(workflow) {
  await ensureStateDir();
  workflow.updatedAt = new Date().toISOString();
  await writeJsonFileAtomic(workflowPath(workflow.id), workflow);
  return workflow;
}

function workflowLogUrl(workflow) {
  return `http://127.0.0.1:${port}/workflows/${workflow.id}/events.txt`;
}

function ensureWorkflowSteps(workflow) {
  workflow.steps = Array.isArray(workflow.steps) ? workflow.steps : [];
  workflow.history = Array.isArray(workflow.history) ? workflow.history : [];
  workflow.events = Array.isArray(workflow.events) ? workflow.events : [];
  if (!workflow.steps.length) {
    const error = new Error("Workflow has no step rows.");
    error.status = 400;
    throw error;
  }
  if (!Number.isInteger(workflow.currentIndex) || workflow.currentIndex < 0) workflow.currentIndex = 0;
  return workflow.steps;
}

function activeWorkflowStep(workflow) {
  const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
  return steps[workflow.currentIndex] || steps[steps.length - 1] || null;
}

function workflowStepLabel(step) {
  if (!step) return "";
  return `step ${Number(step.index || 0) + 1}: ${step.name || step.action || "unnamed step"}`;
}

function normalizeTokenCount(value, fallback = null) {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.floor(number);
}

function normalizeTokenBudget(value) {
  if (value == null || value === "" || value === false) return null;
  const number = normalizeTokenCount(value, null);
  return number && number > 0 ? number : null;
}

function formatTokenCount(value) {
  const number = normalizeTokenCount(value, 0);
  return String(number);
}

function formatTokenBudget(value) {
  const budget = normalizeTokenBudget(value);
  return budget == null ? "none" : String(budget);
}

function formatTokensRemaining(tokensUsed, tokenBudget) {
  const budget = normalizeTokenBudget(tokenBudget);
  if (budget == null) return "unbounded";
  return String(Math.max(0, budget - normalizeTokenCount(tokensUsed, 0)));
}

function workflowTokenBudgetFromBody(body = {}) {
  return normalizeTokenBudget(body.tokenBudget ?? body.budget?.tokenBudget ?? body.workflow?.tokenBudget);
}

function workflowTokensUsedFromBody(body = {}) {
  return normalizeTokenCount(body.tokensUsed ?? body.budget?.tokensUsed ?? body.workflow?.tokensUsed, 0);
}

async function readOpenClawSessionEntry(sessionKey, agentId) {
  const agentsDir = join(homedir(), ".openclaw", "agents");
  const sessionsDir = resolve(agentsDir, agentId || "main", "sessions");
  if (!pathIsInside(agentsDir, sessionsDir)) return null;
  const sessionsPath = join(sessionsDir, "sessions.json");
  try {
    const sessions = parseJson(await readFile(sessionsPath, "utf8"), {});
    return sessions?.[sessionKey] || null;
  } catch {
    return null;
  }
}

async function refreshWorkflowTokenUsage(workflow, body = {}) {
  const tracking = workflow.tokenTracking && typeof workflow.tokenTracking === "object" ? workflow.tokenTracking : {};
  const previousUsed = normalizeTokenCount(workflow.tokensUsed, 0);
  let tokensUsed = previousUsed;
  let source = "";
  let delta = 0;

  const reportedBudget = workflowTokenBudgetFromBody(body);
  if (reportedBudget != null) workflow.tokenBudget = reportedBudget;

  const reportedTotal = normalizeTokenCount(body.tokensUsed ?? body.tokenUsage?.tokensUsed, null);
  const reportedDelta = normalizeTokenCount(body.tokensUsedDelta ?? body.tokenUsage?.tokensUsedDelta, null);
  if (reportedDelta != null) {
    delta = reportedDelta;
    tokensUsed += delta;
    source = "report.delta";
  } else if (reportedTotal != null) {
    tokensUsed = Math.max(tokensUsed, reportedTotal);
    delta = Math.max(0, tokensUsed - previousUsed);
    source = "report.total";
  } else if (workflow.jobId) {
    const agentId = sessionParts(workflow.sessionKey).agentId || "main";
    const cronSessionKey = `agent:${agentId}:cron:${workflow.jobId}`;
    const session = await readOpenClawSessionEntry(cronSessionKey, agentId);
    const sessionTotal = normalizeTokenCount(session?.totalTokens, null);
    if (sessionTotal != null && session?.totalTokensFresh !== false) {
      const sameSnapshot = tracking.sessionKey === cronSessionKey && tracking.sessionId === session.sessionId;
      const lastTotal = sameSnapshot ? normalizeTokenCount(tracking.totalTokens, 0) : 0;
      delta = Math.max(0, sessionTotal - lastTotal);
      tokensUsed += delta;
      source = "openclaw.session";
      workflow.tokenTracking = {
        ...tracking,
        source,
        sessionKey: cronSessionKey,
        sessionId: session.sessionId || "",
        totalTokens: sessionTotal,
        updatedAt: new Date().toISOString(),
      };
    }
  }

  workflow.tokensUsed = tokensUsed;
  if (!workflow.tokenTracking || source.startsWith("report.")) {
    workflow.tokenTracking = {
      ...tracking,
      source: source || tracking.source || "none",
      updatedAt: source ? new Date().toISOString() : tracking.updatedAt || "",
    };
  }
  return { source, delta, previousUsed, tokensUsed, tokenBudget: workflow.tokenBudget ?? null };
}

function recordWorkflowTokenEvent(workflow, tokenUpdate, detail = {}) {
  if (!tokenUpdate?.source && !(tokenUpdate?.delta > 0)) return null;
  return workflowEvent(workflow, "workflow.tokens_updated", {
    status: "tracked",
    title: "Token usage updated",
    detail: `Tokens used: ${formatTokenCount(tokenUpdate.tokensUsed)}. Token budget: ${formatTokenBudget(tokenUpdate.tokenBudget)}. Tokens remaining: ${formatTokensRemaining(tokenUpdate.tokensUsed, tokenUpdate.tokenBudget)}.${tokenUpdate.source ? ` Source: ${tokenUpdate.source}.` : ""}`,
    ...detail,
  });
}

function workflowNeedsDisableRetry(workflow) {
  return workflow?.jobId && ["advance_failed", "complete_disable_failed"].includes(workflow.status);
}

function workflowEvent(workflow, type, detail = {}) {
  const step = detail.step
    || (Number.isInteger(detail.stepIndex) ? workflow.steps?.[detail.stepIndex] : null)
    || activeWorkflowStep(workflow);
  const clean = {
    id: randomUUID(),
    at: new Date().toISOString(),
    type,
    status: detail.status || workflow.status || "unknown",
    stepIndex: Number.isInteger(detail.stepIndex) ? detail.stepIndex : step?.index ?? null,
    stepName: detail.stepName || step?.name || "",
    title: optionalText(detail.title || type, 220),
    detail: optionalText(detail.detail, 2000),
    command: optionalText(detail.command, 2000),
    result: optionalText(detail.result, 2000),
  };
  workflow.events = Array.isArray(workflow.events) ? workflow.events : [];
  workflow.events.push(clean);
  if (workflow.events.length > 500) workflow.events = workflow.events.slice(-500);
  return clean;
}

async function listWorkflows() {
  await ensureStateDir();
  let names = [];
  try {
    names = await readdir(workflowsDir);
  } catch {
    return [];
  }
  const workflows = await Promise.all(names
    .filter((name) => name.endsWith(".json"))
    .map(async (name) => {
      try {
        return parseJson(await readFile(join(workflowsDir, name), "utf8"), null);
      } catch {
        return null;
      }
    }));
  return workflows.filter((workflow) => workflow?.id);
}

async function workflowMapByJobId() {
  const workflows = await listWorkflows();
  const map = new Map();
  for (const workflow of workflows) {
    if (workflow.jobId) map.set(workflow.jobId, workflow);
  }
  return map;
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

function workflowAdvanceUrl(workflow, step, status) {
  const parts = [
    "api",
    "workflows",
    encodeURIComponent(workflow.id),
    "advance",
    encodeURIComponent(workflow.jobId || ""),
    String(step.index),
    encodeURIComponent(status),
  ];
  return `http://127.0.0.1:${port}/${parts.join("/")}`;
}

function workflowAdvanceCommand(workflow, step, status) {
  const curlCmd = process.platform === "win32" ? "curl.exe" : "curl";
  return `${curlCmd} -fsS -X POST ${workflowAdvanceUrl(workflow, step, status)}`;
}

function normalizeAutoContinueDelayMs(value) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) return Math.min(60_000, Math.round(parsed));
  return 3000;
}

function normalizeAutoContinueRetryDelayMs(value) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 1000) return Math.min(60_000, Math.round(parsed));
  return 10_000;
}

function workflowAutoContinuePlan(workflow, trigger, step, stepIndex) {
  if (workflow.autoContinue !== true || !workflow.jobId) return null;
  const delayMs = normalizeAutoContinueDelayMs(workflow.autoContinueDelayMs);
  const args = ["cron", "run", workflow.jobId];
  return {
    trigger,
    stepIndex,
    stepName: step?.name || "",
    delayMs,
    retryDelayMs: normalizeAutoContinueRetryDelayMs(workflow.autoContinueRetryDelayMs),
    maxAttempts: 30,
    command: displayCommand(args),
    args,
  };
}

async function recordWorkflowAutoContinue(id, detail) {
  await withWorkflowLock(id, async () => {
    const workflow = await readWorkflow(id);
    if (!workflow) return;
    workflowEvent(workflow, "cron.auto_continue_run", detail);
    await writeWorkflow(workflow);
  });
}

function scheduleWorkflowAutoContinue(workflowId, jobId, plan) {
  if (!plan) return;
  const scheduleAttempt = (delayMs, attempt) => {
    const timer = setTimeout(async () => {
      try {
        const latest = await readWorkflow(workflowId);
        if (!latest || latest.jobId !== jobId || latest.autoContinue !== true || latest.status !== "active") {
          await recordWorkflowAutoContinue(workflowId, {
            status: "skipped",
            stepIndex: plan.stepIndex,
            title: "Auto-continue skipped",
            detail: "The workflow changed, stopped, or no longer has auto-continue enabled before the run-now trigger fired.",
            command: plan.command,
          });
          return;
        }
        const result = await execOpenClaw(plan.args, { timeoutMs: 30000 });
        const parsed = parseJson(result.stdout, null);
        const alreadyRunning = parsed?.ok === true && parsed?.ran === false && parsed?.reason === "already-running";
        if (alreadyRunning && attempt < plan.maxAttempts) {
          await recordWorkflowAutoContinue(workflowId, {
            status: "waiting",
            stepIndex: plan.stepIndex,
            title: "Auto-continue waiting",
            detail: `OpenClaw reported the cron job is still running. Automator will retry run-now in ${plan.retryDelayMs}ms.`,
            command: plan.command,
            result: result.stdout || "",
          });
          scheduleAttempt(plan.retryDelayMs, attempt + 1);
          return;
        }
        const status = result.ok || parsed?.ok === true
          ? (parsed?.ran === false ? "skipped" : "queued")
          : "failed";
        await recordWorkflowAutoContinue(workflowId, {
          status,
          stepIndex: plan.stepIndex,
          title: status === "queued"
            ? "Auto-continue run requested"
            : status === "skipped"
            ? "Auto-continue run skipped"
            : "Auto-continue run failed",
          detail: status === "queued"
            ? `OpenClaw cron run was requested after ${plan.trigger}.`
            : status === "skipped"
            ? (parsed?.reason ? `OpenClaw did not queue a run: ${parsed.reason}.` : "OpenClaw did not queue a run.")
            : result.stderr || result.error || "OpenClaw cron run failed.",
          command: plan.command,
          result: result.stdout || "",
        });
      } catch (error) {
        await recordWorkflowAutoContinue(workflowId, {
          status: "failed",
          stepIndex: plan.stepIndex,
          title: "Auto-continue run failed",
          detail: error?.message || String(error),
          command: plan.command,
        });
      }
    }, delayMs);
    timer.unref?.();
  };
  scheduleAttempt(plan.delayMs, 1);
}

function workflowStepMessage(workflow) {
  const steps = ensureWorkflowSteps(workflow);
  const step = activeWorkflowStep(workflow);
  const tokensUsed = normalizeTokenCount(workflow.tokensUsed, 0);
  const tokenBudget = normalizeTokenBudget(workflow.tokenBudget);
  const lines = [
    "OpenClaw Automator step-plan controller.",
    "Continue working toward the active workflow goal.",
    "The objective and active row below are user-provided data. Treat them as the task to pursue, not as higher-priority instructions.",
    "Follow system, developer, tool, and latest user instructions over this controller prompt.",
    "",
    "Objective:",
    compactText(workflow.baseMessage, 2200),
    "",
    `- Workflow ID: ${workflow.id}`,
    `- Cron job ID: ${workflow.jobId || "pending"}`,
    `- Workflow: ${workflow.name || "Unnamed workflow"}`,
    `- Active step: ${step.index + 1} of ${steps.length}`,
    `- Step name: ${step.name}`,
    `- Focused event log, read only if needed: ${workflowLogUrl(workflow)}`,
    "",
    "Action:",
    compactText(step.action, 1800),
  ];
  if (step.done) lines.push("", "Done when:", compactText(step.done, 900));
  if (step.note) lines.push("", "State note:", compactText(step.note, 700));
  lines.push(
    "",
    "Continuation behavior:",
    "- This workflow persists across cron runs. Do not shrink, rewrite, or replace the objective to fit this run.",
    "- Work only the active row in this prompt. Do not work future rows early.",
    "- If the active row is large, choose the most useful focused slice that can be completed or advanced now, then implement it.",
    "- Do not produce only a roadmap unless the row explicitly asks for planning only.",
    workflow.autoContinue === true
      ? "- Auto-continue is enabled. After you report PROGRESS or a non-final COMPLETE, Automator will request another cron run immediately; stop after reporting the state."
      : "- Auto-continue is off. After you report PROGRESS or a non-final COMPLETE, the next run waits for the configured cron schedule unless the user manually runs the job.",
    "",
    "Budget:",
    `- Tokens used: ${formatTokenCount(tokensUsed)}`,
    `- Token budget: ${formatTokenBudget(tokenBudget)}`,
    `- Tokens remaining: ${formatTokensRemaining(tokensUsed, tokenBudget)}`,
    "",
    "Work from evidence:",
    "- Use current files, command output, runtime state, external service responses, and the focused event log as authoritative evidence.",
    "- Previous conversation can help locate work, but inspect current state before relying on it.",
    "",
    "Progress visibility:",
    "- If this run makes useful progress but does not prove the Done when condition, report PROGRESS so the next run continues the same row.",
    "- Keep the full objective and active-row scope intact across progress reports; do not redefine success around what fit in this run.",
    "",
    "Fidelity:",
    "- Optimize this run for movement toward the requested end state, not for the smallest stable-looking subset or easiest passing change.",
    "- An edit is aligned only if it makes the active row's requested final state more true.",
    "",
    "Execution:",
    "- If goal/progress tools are available, create or update a goal for this active row and keep it active until the row is proven complete, blocked, or failed.",
    "- Use the available scheduled run to do real work: inspect current state, use relevant tools, produce artifacts, and save progress notes when the row is too large for one pass.",
    "- Keep changes scoped to the objective and active row. Avoid unrelated cleanup, broad research, formatting churn, and speculative abstractions.",
    "",
    "Completion audit:",
    "- Preserve the full active-row scope. Do not redefine success around a smaller, safer, easier, or merely compatible result.",
    "- Fast completion is allowed only when the Done when condition was already satisfied at run start or is proven by current evidence after concrete work in this run.",
    "- Before reporting COMPLETE, verify the Done when condition and every explicit deliverable against current evidence.",
    "- Treat uncertain, indirect, missing, or weak evidence as not complete. Gather stronger evidence or report PROGRESS.",
    "",
    "Blocked audit:",
    "- Use BLOCKED only when user input or an external state change is needed before meaningful progress can continue.",
    "- Use FAILED only when the row cannot be recovered automatically.",
    "",
    "Report exactly one state after working the row:",
    `If COMPLETE, call: ${workflowAdvanceCommand(workflow, step, "complete")}`,
    `If PROGRESS, call: ${workflowAdvanceCommand(workflow, step, "progress")}`,
    `If BLOCKED, call: ${workflowAdvanceCommand(workflow, step, "blocked")}`,
    `If FAILED, call: ${workflowAdvanceCommand(workflow, step, "failed")}`,
    "PROGRESS holds this row and keeps the cron scheduled. BLOCKED or FAILED holds this row and pauses the cron to avoid repeated wasted runs.",
  );
  return lines.join("\n");
}


function sessionArtifactPath(session, suffix) {
  if (!session?.agentId || !session?.sessionId) return null;
  const agentsDir = join(homedir(), ".openclaw", "agents");
  const sessionsDir = resolve(agentsDir, session.agentId, "sessions");
  if (!pathIsInside(agentsDir, sessionsDir)) return null;
  const file = resolve(sessionsDir, `${session.sessionId}${suffix}`);
  return pathIsInside(sessionsDir, file) ? file : null;
}

async function readJsonlTail(file, limit = 160) {
  if (!file) return [];
  try {
    const text = await readTextTail(file);
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-limit)
      .map((line) => parseJson(line, null))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function textFromContent(content, max = 360) {
  if (typeof content === "string") return compactText(content, max);
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const item of content) {
    if (typeof item === "string") parts.push(item);
    else if (item?.type === "text" && item.text) parts.push(item.text);
    else if (item?.type === "toolResult" && (item.text || item.content)) parts.push(item.text || item.content);
    else if (item?.type === "image" || item?.mimeType?.startsWith?.("image/")) parts.push("[image]");
  }
  return compactText(parts.join(" "), max);
}

function compactValue(value, max = 220) {
  if (value == null) return "";
  if (typeof value === "string") return compactText(value, max);
  return compactText(JSON.stringify(value), max);
}

function sessionEventFields(session) {
  return {
    source: "openclaw",
    sessionKey: session?.key || "",
    sessionId: session?.sessionId || "",
    sessionKind: session?.kind || "",
  };
}

function toolCommandFromMessage(message, session) {
  const calls = Array.isArray(message?.content) ? message.content.filter((item) => item?.type === "toolCall") : [];
  return calls.map((call) => ({
    id: call.id || call.toolCallId || "",
    at: message.timestamp || null,
    type: "tool.call",
    status: "running",
    title: `${call.name || "tool"} requested`,
    detail: compactValue(call.arguments?.command || call.input?.command || call.arguments || call.input || "", 260),
    ...sessionEventFields(session),
  }));
}

function parseTranscriptEvents(lines, session) {
  const events = [];
  for (const row of lines) {
    const message = row.message || {};
    const at = row.timestamp || message.timestamp || null;
    if (message.role === "assistant") {
      const text = textFromContent(message.content, 420);
      if (text) {
        events.push({
          at,
          type: "agent.message",
          status: "done",
          title: "Agent message",
          detail: text,
          ...sessionEventFields(session),
        });
      }
      events.push(...toolCommandFromMessage(message, session));
    } else if (message.role === "toolResult") {
      events.push({
        id: message.toolCallId || "",
        at,
        type: "tool.result",
        status: message.isError ? "failed" : "done",
        title: `${message.toolName || "tool"} ${message.isError ? "failed" : "completed"}`,
        detail: textFromContent(message.content, 420),
        ...sessionEventFields(session),
      });
    }
  }
  return events.filter((event) => event.title);
}

function parseTrajectoryEvents(lines, session) {
  const events = [];
  for (const row of lines) {
    const data = row.data || {};
    if (row.type === "tool.call") {
      events.push({
        id: data.toolCallId || "",
        at: row.ts,
        type: "trajectory.tool.call",
        status: "running",
        title: `${data.name || "tool"} command`,
        detail: compactValue(data.arguments?.command || data.arguments || "", 260),
        ...sessionEventFields(session),
      });
    } else if (row.type === "tool.result") {
      events.push({
        id: data.toolCallId || "",
        at: row.ts,
        type: "trajectory.tool.result",
        status: data.isError ? "failed" : "done",
        title: `${data.name || "tool"} ${data.isError ? "failed" : "finished"}`,
        detail: compactText(data.output || JSON.stringify(data.result || ""), 420),
        durationMs: data.result?.durationMs ?? null,
        ...sessionEventFields(session),
      });
    }
  }
  return events.filter((event) => event.title);
}

function eventMs(event) {
  const raw = event?.at;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 1000000000000) return numeric;
  const value = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(value) ? value : 0;
}

function dedupeEvents(events) {
  const seen = new Set();
  const deduped = [];
  for (const event of events) {
    const key = [event.at || "", event.type || "", event.title || "", event.detail || "", event.sessionId || ""].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(event);
  }
  return deduped;
}

function workflowSessionCandidates(workflow, sessionsJson) {
  const sessions = Array.isArray(sessionsJson?.sessions) ? sessionsJson.sessions : [];
  const createdAtMs = Date.parse(workflow.createdAt || "") || 0;
  const sourceKey = workflow.sessionKey || "";
  const jobId = workflow.jobId || "";
  return sessions
    .filter((session) => {
      const key = String(session.key || "");
      const updatedAt = Number(session.updatedAt || 0);
      if (sourceKey && key === sourceKey && updatedAt >= createdAtMs - 5 * 60 * 1000) return true;
      if (jobId && key.includes(`:cron:${jobId}`)) return true;
      if (jobId && key.endsWith(jobId)) return true;
      if (!jobId && session.kind === "cron" && updatedAt >= createdAtMs - 5 * 60 * 1000) return true;
      return false;
    })
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
    .slice(0, 8);
}

async function collectWorkflowOpenClawEvents(workflow) {
  const sessionsResult = await execOpenClaw(["sessions", "--all-agents", "--json", "--limit", "all"], {
    timeoutMs: 15000,
    stdoutMax: 2 * 1024 * 1024,
  });
  if (!sessionsResult.ok) {
    return {
      ok: false,
      error: sessionsResult.stderr || sessionsResult.error || "Could not read OpenClaw sessions.",
      sessions: [],
      events: [],
    };
  }
  const sessionsJson = parseJson(sessionsResult.stdout, { sessions: [] });
  const sessions = workflowSessionCandidates(workflow, sessionsJson);
  const collected = await Promise.all(sessions.map(async (session) => {
    const transcript = await readJsonlTail(sessionArtifactPath(session, ".jsonl"), 180);
    const trajectory = await readJsonlTail(sessionArtifactPath(session, ".trajectory.jsonl"), 180);
    return {
      session,
      events: [
        ...parseTranscriptEvents(transcript, session),
        ...parseTrajectoryEvents(trajectory, session),
      ],
    };
  }));
  const events = dedupeEvents(collected.flatMap((item) => item.events))
    .sort((a, b) => eventMs(a) - eventMs(b))
    .slice(-160);
  return {
    ok: true,
    error: "",
    sessions: sessions.map((session) => ({
      key: session.key || "",
      kind: session.kind || "",
      sessionId: session.sessionId || "",
      updatedAt: session.updatedAt || null,
    })),
    events,
  };
}

function formatDateTime(value) {
  const numeric = Number(value);
  const ms = Number.isFinite(numeric) && numeric > 1000000000000 ? numeric : Date.parse(value || "");
  if (!Number.isFinite(ms)) return "unknown time";
  return new Date(ms).toISOString();
}

function formatWorkflowEvent(event) {
  const parts = [
    `[${formatDateTime(event.at)}]`,
    event.type || "event",
    event.status ? `(${event.status})` : "",
    event.stepName ? workflowStepLabel({ index: event.stepIndex ?? 0, name: event.stepName }) : "",
  ].filter(Boolean);
  const lines = [`${parts.join(" ")} - ${event.title || event.type || "event"}`];
  if (event.detail) lines.push(`  ${event.detail}`);
  if (event.command && event.status === "failed") lines.push(`  command: ${compactText(event.command, 700)}`);
  if (event.result) lines.push(`  result: ${event.result}`);
  return lines.join("\n");
}

function formatOpenClawEvent(event) {
  const duration = Number.isFinite(Number(event.durationMs)) ? ` ${Math.round(Number(event.durationMs))}ms` : "";
  const lines = [
    `[${formatDateTime(event.at)}] ${event.type || "openclaw"} (${event.status || "unknown"}${duration}) - ${event.title || "OpenClaw event"}`,
  ];
  if (event.detail) lines.push(`  ${event.detail}`);
  if (event.sessionKey) lines.push(`  session: ${event.sessionKey}`);
  return lines.join("\n");
}

async function buildWorkflowLog(workflow) {
  const openclaw = await collectWorkflowOpenClawEvents(workflow);
  const events = Array.isArray(workflow.events) ? workflow.events : [];
  const legacyHistory = Array.isArray(workflow.history) ? workflow.history.map((item) => ({
    at: item.at,
    type: "legacy.history",
    status: item.status || "",
    stepIndex: item.stepIndex ?? null,
    title: item.status || "history",
    detail: item.summary || "",
  })) : [];
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    workflow: {
      id: workflow.id,
      name: workflow.name || "",
      jobId: workflow.jobId || "",
      status: workflow.status || "",
      currentIndex: workflow.currentIndex ?? 0,
      currentStep: activeWorkflowStep(workflow),
      logUrl: workflowLogUrl(workflow),
    },
    controllerEvents: [...events, ...legacyHistory].sort((a, b) => eventMs(a) - eventMs(b)),
    openclaw,
  };
}

function workflowLogText(log) {
  const workflow = log.workflow || {};
  const currentStep = workflow.currentStep || null;
  const lines = [
    "OpenClaw Automator workflow event log",
    "",
    `Generated: ${log.generatedAt}`,
    `Workflow: ${workflow.name || "Unnamed workflow"}`,
    `Workflow ID: ${workflow.id || ""}`,
    `Cron job ID: ${workflow.jobId || ""}`,
    `Status: ${workflow.status || "unknown"}`,
    currentStep ? `Current active row: ${workflowStepLabel(currentStep)}` : "Current active row: unknown",
    "",
    "Use: read this only when the active cron prompt lacks enough history. Future step rows are intentionally not included.",
    "Note: successful controller command lines are omitted here for readability; the JSON endpoint keeps raw details.",
    "",
    "Controller events",
    "-----------------",
  ];
  if (log.controllerEvents?.length) {
    lines.push(...log.controllerEvents.map(formatWorkflowEvent));
  } else {
    lines.push("No controller events recorded yet.");
  }
  lines.push("", "Observed OpenClaw events", "------------------------");
  if (!log.openclaw?.ok) {
    lines.push(`Could not collect OpenClaw events: ${log.openclaw?.error || "unknown error"}`);
  } else if (log.openclaw.events?.length) {
    lines.push(...log.openclaw.events.map(formatOpenClawEvent));
  } else {
    lines.push("No matching OpenClaw transcript or trajectory events found yet.");
  }
  if (log.openclaw?.sessions?.length) {
    lines.push("", "Matched sessions", "----------------");
    for (const session of log.openclaw.sessions) {
      lines.push(`- ${session.key || session.sessionId || "session"} (${session.kind || "unknown"})`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

async function createCronWorkflow(body, settings) {
  const workflowBody = body.workflow || {};
  const steps = parseWorkflowSteps(workflowBody.steps);
  if (!steps.length) {
    const error = new Error("Workflow step rows are required.");
    error.status = 400;
    throw error;
  }
  const workflow = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    jobId: "",
    status: "creating",
    currentIndex: 0,
    name: optionalText(workflowBody.name || body.name || "OpenClaw workflow", 200),
    baseMessage: requireText(body.baseMessage || body.message, "Message"),
    sessionKey: optionalText(body.sessionKey, 300),
    sessionTarget: optionalText(body.sessionTarget, 80),
    scheduleMode: optionalText(body.scheduleMode, 40),
    source: optionalText(workflowBody.source || body.source, 120),
    intakeHint: optionalText(workflowBody.intakeHint || body.intakeHint || body.hint, 3000),
    autoContinue: workflowBody.autoContinue === true || body.autoContinue === true,
    autoContinueDelayMs: normalizeAutoContinueDelayMs(workflowBody.autoContinueDelayMs ?? body.autoContinueDelayMs),
    tokenBudget: workflowTokenBudgetFromBody(body),
    tokensUsed: workflowTokensUsedFromBody(body),
    tokenTracking: {
      source: "initial",
      updatedAt: new Date().toISOString(),
    },
    schedule: {
      mode: optionalText(body.scheduleMode, 40),
      every: optionalText(body.every, 80),
      cron: optionalText(body.cron, 120),
      timezone: optionalText(body.timezone, 120),
    },
    delivery: {
      mode: optionalText(body.deliveryMode, 40),
      channel: optionalText(body.channel || body.replyChannel, 80),
      to: optionalText(body.to || body.replyTo, 300),
    },
    steps,
    history: [],
    events: [],
  };
  workflowEvent(workflow, "workflow.created", {
    status: "creating",
    title: "Workflow created",
    detail: `${steps.length} step rows configured. Future rows are intentionally not included in cron prompts.${workflow.intakeHint ? ` Original hint: ${workflow.intakeHint}` : ""}`,
  });
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
    workflowEvent(workflow, "cron.create_failed", {
      status: "failed",
      title: "Cron creation failed",
      detail: addResult.stderr || addResult.error || "cron add failed",
      command: displayCommand(addArgs),
    });
    await writeWorkflow(workflow);
    return { ...addResult, workflow };
  }

  workflow.jobId = jobId;
  workflow.status = requestedEnabled ? "activating" : "disabled";
  workflowEvent(workflow, "cron.created", {
    status: workflow.status,
    title: "Cron job created",
    detail: `OpenClaw cron job ${jobId} was created ${requestedEnabled ? "for activation" : "as disabled"}.`,
    command: displayCommand(addArgs),
  });
  await writeWorkflow(workflow);

  const editMessageArgs = ["cron", "edit", jobId, "--message", workflowStepMessage(workflow)];
  const editMessageResult = await execOpenClaw(editMessageArgs, { timeoutMs: 30000 });
  const enableArgs = requestedEnabled && editMessageResult.ok ? ["cron", "edit", jobId, "--enable"] : null;
  const enableResult = enableArgs ? await execOpenClaw(enableArgs, { timeoutMs: 30000 }) : null;
  const ok = addResult.ok && editMessageResult.ok && (!requestedEnabled || Boolean(enableResult?.ok));
  workflow.status = editMessageResult.ok
    ? (requestedEnabled ? (enableResult?.ok ? "active" : "enable_failed") : "disabled")
    : "prompt_update_failed";
  workflowEvent(workflow, "cron.message_updated", {
    status: editMessageResult.ok ? "done" : "failed",
    title: "Cron prompt rewritten with real job id",
    detail: editMessageResult.ok ? "The active-row prompt now contains the final cron job id and event-log URL." : editMessageResult.stderr || editMessageResult.error,
    command: displayCommand(editMessageArgs),
  });
  if (enableResult) {
    workflowEvent(workflow, "cron.enabled", {
      status: enableResult.ok ? "active" : "failed",
      title: enableResult.ok ? "Cron job enabled" : "Cron enable failed",
      detail: enableResult.ok ? "The workflow controller job is active." : enableResult.stderr || enableResult.error,
      command: displayCommand(enableArgs),
    });
  } else if (requestedEnabled && !editMessageResult.ok) {
    workflowEvent(workflow, "cron.enable_skipped", {
      status: "disabled",
      title: "Cron enable skipped",
      detail: "The job was left disabled because the controller prompt could not be rewritten with the real cron job id.",
    });
  }
  await writeWorkflow(workflow);
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
      enabled: requestedEnabled ? Boolean(enableResult?.ok) : false,
      requestedEnabled,
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
  return withWorkflowLock(id, () => advanceWorkflowUnlocked(id, body));
}

async function advanceWorkflowUnlocked(id, body) {
  const workflow = await readWorkflow(id);
  if (!workflow) {
    const error = new Error("Workflow not found.");
    error.status = 404;
    throw error;
  }
  ensureWorkflowSteps(workflow);
  const jobId = optionalText(body.jobId, 120);
  if (jobId !== workflow.jobId) {
    const error = new Error("Workflow job id mismatch.");
    error.status = 400;
    throw error;
  }
  const stepIndex = Number(body.stepIndex);
  const activeStep = workflow.steps[workflow.currentIndex] || null;
  if (!activeStep || !Number.isInteger(stepIndex) || stepIndex !== workflow.currentIndex) {
    const tokenUpdate = await refreshWorkflowTokenUsage(workflow, body);
    recordWorkflowTokenEvent(workflow, tokenUpdate, {
      stepIndex: Number.isInteger(stepIndex) ? stepIndex : null,
    });
    let disableRetryResult = null;
    let disableRetryCommand = "";
    if (workflowNeedsDisableRetry(workflow)) {
      const disableRetryArgs = ["cron", "edit", workflow.jobId, "--disable", "--description", `${workflow.name} paused: retry after stale report while status is ${workflow.status}.`];
      disableRetryCommand = displayCommand(disableRetryArgs);
      disableRetryResult = await execOpenClaw(disableRetryArgs, { timeoutMs: 30000 });
      if (disableRetryResult.ok && workflow.status === "complete_disable_failed") workflow.status = "complete";
      workflowEvent(workflow, "cron.disable_retry", {
        status: disableRetryResult.ok ? "disabled" : "failed",
        stepIndex: Number.isInteger(stepIndex) ? stepIndex : null,
        title: disableRetryResult.ok ? "Cron disable retry succeeded" : "Cron disable retry failed",
        detail: disableRetryResult.ok
          ? "A stale report arrived after a prior scheduler cleanup failure, so Automator retried disabling the cron job."
          : disableRetryResult.stderr || disableRetryResult.error,
        command: disableRetryCommand,
        result: disableRetryResult.stdout || "",
      });
    }
    workflowEvent(workflow, "step.stale_report", {
      status: "ignored",
      stepIndex: Number.isInteger(stepIndex) ? stepIndex : null,
      title: "Stale step report ignored",
      detail: `Reported step ${body.stepIndex ?? "unknown"} did not match active step ${workflow.currentIndex}.`,
    });
    await writeWorkflow(workflow);
    return {
      ok: !disableRetryResult || disableRetryResult.ok,
      advanced: false,
      workflow,
      command: disableRetryCommand,
      result: disableRetryResult,
      reason: "stale step report ignored",
    };
  }
  const status = String(body.status || "").toLowerCase();
  const summary = optionalText(body.summary, 1000);
  const step = activeStep;
  const tokenUpdate = await refreshWorkflowTokenUsage(workflow, body);
  recordWorkflowTokenEvent(workflow, tokenUpdate, { step, stepIndex });
  workflow.history.push({
    at: new Date().toISOString(),
    stepIndex,
    status,
    summary,
    tokensUsed: workflow.tokensUsed,
    tokenBudget: workflow.tokenBudget ?? null,
  });
  workflowEvent(workflow, "step.reported", {
    status: status || "unknown",
    step,
    stepIndex,
    title: `Step reported ${status || "unknown"}`,
    detail: summary || "The controller received a status report for the active step.",
  });

  if (["complete", "completed", "done", "success"].includes(status)) {
    workflow.steps[stepIndex].status = "complete";
    workflow.steps[stepIndex].completedAt = new Date().toISOString();
    workflow.currentIndex += 1;
    if (workflow.currentIndex >= workflow.steps.length) {
      const disableArgs = ["cron", "edit", workflow.jobId, "--disable", "--description", `${workflow.name} completed by workflow controller.`];
      const disableResult = await execOpenClaw(disableArgs, { timeoutMs: 30000 });
      workflow.status = disableResult.ok ? "complete" : "complete_disable_failed";
      workflowEvent(workflow, "workflow.completed", {
        status: disableResult.ok ? "complete" : "failed",
        step,
        stepIndex,
        title: disableResult.ok ? "Workflow completed and cron disabled" : "Workflow completed but cron disable failed",
        detail: disableResult.ok ? "All configured step rows are complete." : disableResult.stderr || disableResult.error,
        command: displayCommand(disableArgs),
      });
      await writeWorkflow(workflow);
      return { ok: disableResult.ok, advanced: true, complete: disableResult.ok, workflow, command: displayCommand(disableArgs), result: disableResult };
    }
    workflow.status = "active";
    const editArgs = ["cron", "edit", workflow.jobId, "--message", workflowStepMessage(workflow)];
    const editResult = await execOpenClaw(editArgs, { timeoutMs: 30000 });
    const pauseArgs = !editResult.ok
      ? ["cron", "edit", workflow.jobId, "--disable", "--description", `${workflow.name} paused: prompt rewrite failed after ${workflowStepLabel(step)}.`]
      : null;
    const pauseResult = pauseArgs ? await execOpenClaw(pauseArgs, { timeoutMs: 30000 }) : null;
    if (!editResult.ok) workflow.status = "advance_failed";
    const autoContinue = editResult.ok ? workflowAutoContinuePlan(workflow, "step complete", step, stepIndex) : null;
    workflowEvent(workflow, "step.advanced", {
      status: editResult.ok ? "active" : "failed",
      step,
      stepIndex,
      title: editResult.ok ? "Advanced to next active row" : "Advance prompt rewrite failed",
      detail: editResult.ok
        ? `Completed ${workflowStepLabel(step)}. Cron prompt now points at ${workflowStepLabel(activeWorkflowStep(workflow))}.`
        : editResult.stderr || editResult.error,
      command: displayCommand(editArgs),
    });
    if (pauseArgs) {
      workflowEvent(workflow, "cron.paused", {
        status: pauseResult?.ok ? "disabled" : "failed",
        step,
        stepIndex,
        title: pauseResult?.ok ? "Cron paused after prompt rewrite failure" : "Cron pause after prompt rewrite failure failed",
        detail: pauseResult?.ok
          ? "The completed row was advanced internally, but the scheduler was paused so it cannot rerun the stale prompt."
          : pauseResult?.stderr || pauseResult?.error || "The scheduler may still contain the previous prompt.",
        command: displayCommand(pauseArgs),
        result: pauseResult?.stdout || "",
      });
    }
    if (autoContinue) {
      workflowEvent(workflow, "cron.auto_continue_queued", {
        status: "queued",
        step,
        stepIndex,
        title: "Auto-continue queued",
        detail: `Automator will request another cron run in ${autoContinue.delayMs}ms after advancing to ${workflowStepLabel(activeWorkflowStep(workflow))}.`,
        command: autoContinue.command,
      });
    }
    await writeWorkflow(workflow);
    scheduleWorkflowAutoContinue(workflow.id, workflow.jobId, autoContinue);
    return {
      ok: editResult.ok,
      advanced: true,
      complete: false,
      workflow,
      command: displayCommand(editArgs),
      result: editResult,
      pause: pauseResult,
      autoContinue,
    };
  }

  if (["progress", "continue", "continued", "partial", "in_progress"].includes(status)) {
    workflow.status = "active";
    workflow.steps[stepIndex].status = "active";
    workflow.steps[stepIndex].lastProgressAt = new Date().toISOString();
    workflow.steps[stepIndex].lastSummary = summary;
    const editArgs = workflow.jobId ? ["cron", "edit", workflow.jobId, "--message", workflowStepMessage(workflow)] : null;
    const editResult = editArgs ? await execOpenClaw(editArgs, { timeoutMs: 30000 }) : null;
    const autoContinue = editResult?.ok ? workflowAutoContinuePlan(workflow, "progress", step, stepIndex) : null;
    workflowEvent(workflow, "step.progress", {
      status: "active",
      step,
      stepIndex,
      title: "Progress recorded; active row kept",
      detail: summary || "The active row remains scheduled for the next cron run.",
    });
    if (editArgs) {
      workflowEvent(workflow, "cron.message_updated", {
        status: editResult.ok ? "active" : "failed",
        step,
        stepIndex,
        title: editResult.ok ? "Cron prompt refreshed after progress" : "Progress prompt refresh failed",
        detail: editResult.ok
          ? "The active-row prompt was refreshed with current budget and continuation state."
          : editResult.stderr || editResult.error,
        command: displayCommand(editArgs),
      });
    }
    if (autoContinue) {
      workflowEvent(workflow, "cron.auto_continue_queued", {
        status: "queued",
        step,
        stepIndex,
        title: "Auto-continue queued",
        detail: `Automator will request another cron run in ${autoContinue.delayMs}ms after progress was reported.`,
        command: autoContinue.command,
      });
    }
    await writeWorkflow(workflow);
    scheduleWorkflowAutoContinue(workflow.id, workflow.jobId, autoContinue);
    return {
      ok: !editResult || editResult.ok,
      advanced: false,
      complete: false,
      workflow,
      command: editArgs ? displayCommand(editArgs) : "",
      result: editResult,
      reason: "progress recorded; active step unchanged and cron remains enabled",
      autoContinue,
    };
  }

  if (["blocked", "failed", "fail", "error"].includes(status)) {
    workflow.status = status === "blocked" ? "blocked" : "failed";
    workflow.steps[stepIndex].status = workflow.status;
    workflow.steps[stepIndex].lastSummary = summary;
    const disableArgs = workflow.jobId
      ? ["cron", "edit", workflow.jobId, "--disable", "--description", `${workflow.name} paused: ${workflow.status} at ${workflowStepLabel(step)}.`]
      : null;
    const disableResult = disableArgs ? await execOpenClaw(disableArgs, { timeoutMs: 30000 }) : null;
    workflowEvent(workflow, "step.held", {
      status: workflow.status,
      step,
      stepIndex,
      title: `Active row held as ${workflow.status}`,
      detail: summary || "The active row was not advanced.",
    });
    workflowEvent(workflow, "cron.paused", {
      status: disableResult?.ok ? "disabled" : "failed",
      step,
      stepIndex,
      title: disableResult?.ok ? "Cron paused for user intervention" : "Cron pause failed",
      detail: disableResult?.ok
        ? "The repeating job was disabled so the same blocked or failed row does not keep rerunning. Re-enable or run the job after resolving the blocker."
        : disableResult?.stderr || disableResult?.error || "No cron job id was available to disable.",
      command: disableArgs ? displayCommand(disableArgs) : "",
      result: disableResult?.stdout || "",
    });
    await writeWorkflow(workflow);
    return {
      ok: !disableResult || disableResult.ok,
      advanced: false,
      workflow,
      command: disableArgs ? displayCommand(disableArgs) : "",
      result: disableResult,
      reason: `step marked ${workflow.status}; active step unchanged and cron paused`,
    };
  }

  workflowEvent(workflow, "step.unknown_status", {
    status: "ignored",
    step,
    stepIndex,
    title: "Unknown step status ignored",
    detail: `Status '${status || "empty"}' did not advance the workflow.`,
  });
  await writeWorkflow(workflow);
  return { ok: true, advanced: false, workflow, reason: "unknown status; active step unchanged" };
}

export {
  activeWorkflowStep,
  advanceWorkflow,
  buildWorkflowLog,
  createCronWorkflow,
  listWorkflows,
  parseWorkflowSteps,
  readWorkflow,
  workflowControllerRequested,
  workflowEvent,
  workflowLogText,
  workflowLogUrl,
  workflowMapByJobId,
  workflowStepLabel,
  workflowStepMessage,
  writeWorkflow,
};

import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  appVersion,
  openclawAgentSkillsDir,
  openclawWorkspaceSkillsDir,
  port,
  workflowIntakeApprovalTtlMs,
  workflowIntakeApprovalsPath,
  workflowIntakeSkillSlug,
} from "./config.mjs";
import { cronDeliveryWarning, cronNotifySupport } from "./channels.mjs";
import { cronArgs, normalizeThinking } from "./commands.mjs";
import { displayCommand, execOpenClaw } from "./openclaw.mjs";
import { ensureStateDir } from "./state.mjs";
import { sessionParts } from "./session-utils.mjs";
import { compactText, optionalText, parseJson, stableJson } from "./utils.mjs";
import { parseWorkflowSteps, workflowStepMessage } from "./workflows.mjs";

function workflowIntakeSkillMarkdown() {
  const base = `http://127.0.0.1:${port}`;
  return `---
name: ${workflowIntakeSkillSlug}
description: Use when a user asks in plain language to set up a repeating multi-step workflow, step plan controller, adaptive cron, or scheduled follow-up that should advance through steps safely. This skill creates no jobs directly; it guides the agent to the local OpenClaw Automator workflow-intake preview and approval contract.
metadata:
  short-description: Build safe step-plan cron workflows
---

# OpenClaw Automator Workflow Intake

Use this when the user wants a controlled repeating workflow with steps, for example:

- "remind yourself every morning to check this project"
- "set up a step plan controller for this chat"
- "make a cron that moves through these tasks"
- "keep checking until this is done"

Prefer ordinary OpenClaw cron for a simple one-shot reminder or a simple repeated message with no step state.

## Required Flow

1. Read ${base}/agent-tools/workflow-intake.
2. Build a structured draft from the user's short request.
3. POST it to ${base}/api/agent-tools/workflow-intake/preview.
4. If the response asks questions, ask the user those questions in the same chat.
5. If the response says confirmation is needed, summarize the exact schedule, delivery route, step rows, and activation plan. Ask the user to reply with the returned approval phrase exactly.
6. After that later user reply exists in the same OpenClaw session, POST response.createRequestTemplate to ${base}/api/agent-tools/workflow-intake/create, preserving the activation fields and adding userConfirmed:true, approvalId, and approvalCode if they are not already present.

The backend rejects create if the user did not confirm in the selected chat after preview, if the draft changed, or if the approval expired.

## Defaults

- Keep created jobs disabled unless the user explicitly asks to enable/start them. When activation was requested, include enabled:true and allowEnable:true in preview and create; the returned activation plan will say whether create will enable the job.
- Use isolated cron sessions for repeating workflows unless the user explicitly wants the main chat context to grow.
- Keep the cron prompt focused on the active step. Automator stores future rows and exposes a focused event log.
- Treat the generated cron prompt as a goal-style active-row contract: work from current evidence, preserve the active-row scope, and report COMPLETE only after the Done when condition is proven.
- If a row reports progress, Automator holds that row and keeps the cron scheduled for the next run.
- If a row reports blocked or failed, Automator holds that row and pauses the cron so it does not keep rerunning the same known blocker. Re-enable or run the job after resolving the blocker.
- Do not ask the user for session ids, endpoint URLs, or command flags when the current session already provides them.
- If the current session is dashboard/webchat and the user did not choose a configured messaging channel, use quiet delivery. OpenClaw cron notification channels are external channels such as Telegram, not dashboard webchat sessions.
`;
}

async function writeWorkflowIntakeSkillDir(skillDir, sourceSpec = "") {
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), workflowIntakeSkillMarkdown(), "utf8");
  if (sourceSpec) {
    const metadataDir = join(skillDir, ".openclaw");
    await mkdir(metadataDir, { recursive: true });
    await writeFile(join(metadataDir, "source-origin.json"), `${JSON.stringify({
      version: 1,
      source: "path",
      spec: sourceSpec,
      slug: workflowIntakeSkillSlug,
      installedAt: Date.now(),
      managedBy: "OpenClaw Automator",
    }, null, 2)}\n`, "utf8");
  }
}

async function installWorkflowIntakeSkill() {
  const sourceSkillDir = join(openclawAgentSkillsDir, workflowIntakeSkillSlug);
  const workspaceSkillDir = join(openclawWorkspaceSkillsDir, workflowIntakeSkillSlug);
  await writeWorkflowIntakeSkillDir(sourceSkillDir);

  if (!existsSync(workspaceSkillDir)) {
    const result = await execOpenClaw([
      "skills",
      "install",
      sourceSkillDir,
      "--agent",
      "main",
      "--as",
      workflowIntakeSkillSlug,
    ], { timeoutMs: 15000, stdoutMax: 1200, stderrMax: 1200 });
    if (result.ok) return;
    console.warn("OpenClaw skill install failed; writing workflow intake skill directly.", result.stderr || result.error);
  }

  await writeWorkflowIntakeSkillDir(workspaceSkillDir, sourceSkillDir);
}


function titleFromHint(value) {
  const text = optionalText(value, 180).replace(/\s+/g, " ").trim();
  if (!text) return "";
  const cleaned = text.replace(/^(please|pls|can you|could you|make|create|set up|setup)\s+/i, "").trim() || text;
  return cleaned.slice(0, 90).replace(/[.,;:!?]+$/g, "");
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeWorkflowIntakeSchedule(value) {
  const mode = String(value || "").trim().toLowerCase();
  if (mode === "repeat") return "every";
  if (mode === "every" || mode === "cron") return mode;
  return "";
}

function normalizeWorkflowIntakeDelivery(value) {
  const mode = String(value || "").trim().toLowerCase();
  if (mode === "message" || mode === "message-me" || mode === "telegram") return "notify";
  if (mode === "notify" || mode === "webhook" || mode === "quiet") return mode;
  return "notify";
}


function normalizeQuestionList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => optionalText(item, 500))
    .filter(Boolean)
    .slice(0, 6);
}

function workflowIntakeQuestions(missing) {
  const questions = [];
  const has = (field) => missing.some((item) => item.field === field);
  if (has("sessionKey")) {
    questions.push("Which OpenClaw chat/session should this workflow use as context?");
  }
  if (has("baseMessage")) {
    questions.push("What should the agent understand as the overall goal?");
  }
  if (has("schedule")) {
    questions.push("Should this repeat every interval, or use an exact cron schedule?");
  } else if (has("every")) {
    questions.push("How often should it repeat? Examples: 30m, 2h, 1d.");
  } else if (has("cron")) {
    questions.push("What exact cron expression should run this workflow?");
  }
  if (has("steps")) {
    questions.push("What are the step rows? For each row, give current step, next action, done when, and any state note.");
  }
  if (has("replyTo")) {
    questions.push("Where should the final answer be sent, or should this be a quiet run?");
  }
  if (has("webhook")) {
    questions.push("What webhook URL should receive the final answer?");
  }
  return questions;
}

function workflowIntakeMissingItem(field, detail) {
  return { field, detail };
}

function workflowIntakeDraftHash(draft) {
  return createHash("sha256").update(stableJson(draft)).digest("hex");
}

function workflowIntakeApprovalCode() {
  return `WF-${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

function optionalTokenBudget(value) {
  if (value == null || value === "" || value === false) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.floor(number);
}

function publicWorkflowIntakeApproval(approval) {
  if (!approval) return null;
  const phrase = `approve workflow ${approval.code}`;
  return {
    id: approval.id,
    code: approval.code,
    phrase,
    expiresAt: approval.expiresAt,
    sessionKey: approval.sessionKey,
    instructions: `Ask the user to reply exactly: ${phrase}. Create is blocked until that later user message is visible in the selected OpenClaw session transcript.`,
  };
}

function workflowIntakeCreateRequestTemplate(draft, approval = null) {
  const request = {
    hint: draft.intakeHint,
    sessionKey: draft.sessionKey,
    name: draft.name,
    baseMessage: draft.baseMessage,
    scheduleMode: draft.scheduleMode,
    every: draft.scheduleMode === "every" ? draft.every : "",
    cron: draft.scheduleMode === "cron" ? draft.cron : "",
    timezone: draft.timezone,
    deliveryMode: draft.deliveryMode,
    replyChannel: draft.replyChannel,
    replyTo: draft.replyTo,
    webhook: draft.webhook,
    enabled: draft.enabled,
    disabled: draft.disabled,
    allowEnable: draft.enabled === true,
    tokenBudget: draft.tokenBudget,
    userConfirmed: true,
    approvalId: approval?.id || "<approval.id>",
    approvalCode: approval?.code || "<approval.code>",
    steps: draft.workflow.steps.map((step) => ({
      name: step.name,
      action: step.action,
      done: step.done,
      note: step.note,
    })),
  };
  return Object.fromEntries(Object.entries(request).filter(([, value]) => value !== ""));
}

async function readWorkflowIntakeApprovals() {
  await ensureStateDir();
  try {
    const state = parseJson(await readFile(workflowIntakeApprovalsPath, "utf8"), {});
    return { approvals: Array.isArray(state.approvals) ? state.approvals : [] };
  } catch {
    return { approvals: [] };
  }
}

async function writeWorkflowIntakeApprovals(state) {
  await ensureStateDir();
  await writeFile(workflowIntakeApprovalsPath, `${JSON.stringify({ approvals: state.approvals || [] }, null, 2)}\n`, "utf8");
}

async function createWorkflowIntakeApproval(intake) {
  const now = Date.now();
  const draftHash = workflowIntakeDraftHash(intake.draft);
  const state = await readWorkflowIntakeApprovals();
  const approvals = state.approvals.filter((item) => {
    if (!item || item.expiresAtMs <= now) return false;
    if (item.status !== "pending") return true;
    return item.draftHash !== draftHash;
  });
  const approval = {
    id: randomUUID(),
    code: workflowIntakeApprovalCode(),
    status: "pending",
    createdAt: new Date(now).toISOString(),
    createdAtMs: now,
    expiresAt: new Date(now + workflowIntakeApprovalTtlMs).toISOString(),
    expiresAtMs: now + workflowIntakeApprovalTtlMs,
    draftHash,
    sessionKey: intake.draft.sessionKey,
    name: intake.draft.name,
  };
  approvals.push(approval);
  await writeWorkflowIntakeApprovals({ approvals });
  return approval;
}

async function updateWorkflowIntakeApproval(id, patch) {
  const state = await readWorkflowIntakeApprovals();
  const index = state.approvals.findIndex((item) => item.id === id);
  if (index < 0) return null;
  state.approvals[index] = {
    ...state.approvals[index],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await writeWorkflowIntakeApprovals(state);
  return state.approvals[index];
}

function normalizeApprovalText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function compactApprovalText(value) {
  return normalizeApprovalText(value).replace(/\s+/g, "");
}

function messageContentText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object") return part.text || part.content || "";
      return "";
    }).filter(Boolean).join("\n");
  }
  if (content && typeof content === "object") return content.text || content.content || "";
  return "";
}

async function sessionFileForKey(sessionKey) {
  const parts = sessionParts(sessionKey);
  const agentId = parts.agentId || "main";
  const sessionsPath = join(homedir(), ".openclaw", "agents", agentId, "sessions", "sessions.json");
  const sessions = parseJson(await readFile(sessionsPath, "utf8"), {});
  const entry = sessions?.[sessionKey];
  if (!entry) return "";
  return optionalText(entry.sessionFile, 1000) || (entry.sessionId ? join(homedir(), ".openclaw", "agents", agentId, "sessions", `${entry.sessionId}.jsonl`) : "");
}

async function findWorkflowIntakeUserConfirmation(approval) {
  let sessionFile = "";
  try {
    sessionFile = await sessionFileForKey(approval.sessionKey);
  } catch {
    return { ok: false, reason: "session_index_unavailable", detail: "Could not read OpenClaw sessions.json for the selected session key." };
  }
  if (!sessionFile || !existsSync(sessionFile)) {
    return { ok: false, reason: "session_file_missing", detail: "Could not find the OpenClaw session transcript for the selected session key." };
  }

  const code = compactApprovalText(approval.code);
  const positiveWords = new Set(["approve", "approved", "confirm", "confirmed", "create", "yes", "ok"]);
  const lines = (await readFile(sessionFile, "utf8")).split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const item = parseJson(line, null);
    if (!item || item.type !== "message" || item.message?.role !== "user") continue;
    const ts = Date.parse(item.timestamp || item.message?.timestamp || "");
    if (!Number.isFinite(ts) || ts <= approval.createdAtMs) continue;
    const text = messageContentText(item.message.content);
    if (!text) continue;
    const normalized = normalizeApprovalText(text);
    if (!compactApprovalText(text).includes(code)) continue;
    const hasPositiveWord = normalized.split(/\s+/).some((word) => positiveWords.has(word));
    if (!hasPositiveWord) continue;
    return { ok: true, messageId: item.id || "", confirmedAt: item.timestamp || new Date(ts).toISOString(), text: compactText(text, 300) };
  }
  return {
    ok: false,
    reason: "awaiting_user_confirmation",
    detail: `No later user message in ${approval.sessionKey} contained the approval phrase.`,
  };
}

async function validateWorkflowIntakeApproval(body, intake) {
  const approvalInput = objectValue(body.approval);
  const id = optionalText(body.approvalId || approvalInput.id, 120);
  const code = optionalText(body.approvalCode || approvalInput.code, 40);
  if (!id || !code) {
    return {
      ok: false,
      mode: "approval_required",
      reason: "missing_approval",
      detail: "Call preview first, show the returned summary and approval phrase to the user, then call create with approvalId and approvalCode after the user replies.",
    };
  }

  const state = await readWorkflowIntakeApprovals();
  const approval = state.approvals.find((item) => item.id === id);
  if (!approval) {
    return { ok: false, mode: "approval_required", reason: "unknown_approval", detail: "Approval id was not found. Run preview again." };
  }
  if (approval.status === "used" || approval.status === "creating") {
    return { ok: false, mode: "approval_consumed", reason: "approval_consumed", detail: "This approval was already used." };
  }
  if (approval.expiresAtMs <= Date.now()) {
    return { ok: false, mode: "approval_expired", reason: "approval_expired", detail: "Approval expired. Run preview again." };
  }
  if (compactApprovalText(code) !== compactApprovalText(approval.code)) {
    return { ok: false, mode: "approval_required", reason: "approval_code_mismatch", detail: "Approval code did not match the preview." };
  }
  if (approval.sessionKey !== intake.draft.sessionKey) {
    return { ok: false, mode: "approval_required", reason: "session_mismatch", detail: "Approval belongs to a different OpenClaw session." };
  }
  if (approval.draftHash !== workflowIntakeDraftHash(intake.draft)) {
    return { ok: false, mode: "approval_required", reason: "draft_changed", detail: "The create draft is not the same as the previewed draft. Run preview again." };
  }

  const confirmation = await findWorkflowIntakeUserConfirmation(approval);
  if (!confirmation.ok) {
    return {
      ok: false,
      mode: "awaiting_user_confirmation",
      reason: confirmation.reason,
      detail: confirmation.detail,
      approval,
    };
  }

  return { ok: true, approval, confirmation };
}

function buildWorkflowIntake(body, settings) {
  const schedule = objectValue(body.schedule);
  const delivery = objectValue(body.delivery);
  const workflowBody = objectValue(body.workflow);
  const plan = objectValue(body.plan);
  const budget = objectValue(body.budget);
  const hint = optionalText(body.hint || body.userHint || body.request || body.originalMessage, 3000);
  const baseMessage = optionalText(
    body.baseMessage || body.message || body.prompt || workflowBody.baseMessage || hint,
    12000,
  );
  const name = optionalText(
    body.name || body.workflowName || workflowBody.name || titleFromHint(hint || baseMessage) || "OpenClaw workflow",
    120,
  );
  const description = optionalText(
    body.description || (hint ? `Created from natural-language intake: ${hint}` : "Created from OpenClaw Automator workflow intake."),
    1000,
  );
  const session = objectValue(body.session);
  const sessionKey = optionalText(body.sessionKey || body.contextSessionKey || session.key, 300);
  const rawEvery = optionalText(body.every || schedule.every, 80);
  const rawCron = optionalText(body.cron || schedule.cron, 120);
  let scheduleMode = normalizeWorkflowIntakeSchedule(body.scheduleMode || schedule.mode || schedule.kind);
  if (!scheduleMode && rawCron) scheduleMode = "cron";
  if (!scheduleMode && rawEvery) scheduleMode = "every";
  let deliveryMode = normalizeWorkflowIntakeDelivery(body.deliveryMode || delivery.mode);
  let replyChannel = optionalText(body.replyChannel || body.channel || delivery.channel || settings.replyChannel, 80);
  let replyTo = optionalText(body.replyTo || body.to || delivery.to, 300);
  const webhook = optionalText(body.webhook || delivery.webhook, 1000);
  const steps = parseWorkflowSteps(body.steps || workflowBody.steps || plan.steps);
  const tokenBudget = optionalTokenBudget(body.tokenBudget ?? budget.tokenBudget ?? workflowBody.tokenBudget);
  const explicitQuestions = normalizeQuestionList(body.questions);
  const confirmed = body.userConfirmed === true || body.confirm === true;
  const wantsEnabled = body.enabled === true || body.disabled === false || body.enableAfterCreate === true;
  const allowEnable = body.allowEnable === true || body.activate === true;
  const enabled = Boolean(allowEnable && wantsEnabled);
  const missing = [];
  const warnings = [];

  if (deliveryMode === "notify") {
    const support = cronNotifySupport(replyChannel, settings);
    if (!support.ok) {
      warnings.push(cronDeliveryWarning(replyChannel, settings));
      deliveryMode = "quiet";
      replyChannel = "";
      replyTo = "";
    }
  } else {
    replyChannel = "";
    replyTo = "";
  }

  if (!sessionKey) missing.push(workflowIntakeMissingItem("sessionKey", "A workflow needs the OpenClaw session key it will use for context."));
  if (!baseMessage) missing.push(workflowIntakeMissingItem("baseMessage", "A workflow needs an overall goal/prompt."));
  if (!scheduleMode) missing.push(workflowIntakeMissingItem("schedule", "The intake tool only creates repeating step-controller jobs, so scheduleMode must be every or cron."));
  if (scheduleMode === "every" && !rawEvery) missing.push(workflowIntakeMissingItem("every", "Repeat schedules need an interval such as 2h or 1d."));
  if (scheduleMode === "cron" && !rawCron) missing.push(workflowIntakeMissingItem("cron", "Cron schedules need a cron expression such as 0 9 * * 1-5."));
  if (!steps.length) missing.push(workflowIntakeMissingItem("steps", "A step-controller cron needs at least one structured step row."));
  if (deliveryMode === "notify" && !replyTo) missing.push(workflowIntakeMissingItem("replyTo", "Message-me delivery needs a concrete chat target."));
  if (deliveryMode === "webhook" && !webhook) missing.push(workflowIntakeMissingItem("webhook", "Webhook delivery needs a URL."));

  if (steps.length === 1) warnings.push("Only one step row is configured. This is valid, but a normal OpenClaw cron may be simpler if the workflow does not need controlled advancement.");
  if (wantsEnabled && !allowEnable) {
    warnings.push("Activation was requested but allowEnable was not true, so the workflow will be created disabled.");
  } else if (wantsEnabled && !confirmed) {
    warnings.push("Activation was requested and will happen only after the user confirms and create is called with the same activation fields.");
  }
  if (deliveryMode === "quiet") warnings.push("Quiet delivery means the user must inspect Gateway/session history for results.");
  if (String(body.sessionTarget || "").toLowerCase() === "main") warnings.push("Main cron sessions can grow the selected chat context. Isolated is safer for repeating workflows.");
  if (body.lightContext === false) warnings.push("Full context was requested. Light context is the safer default for repeated workflow rows.");

  const draft = {
    kind: "cron",
    source: "agent-workflow-intake",
    intakeHint: hint,
    name,
    description,
    sessionKey,
    sessionTarget: optionalText(body.sessionTarget, 80) || "isolated",
    message: baseMessage,
    baseMessage,
    scheduleMode: scheduleMode || "every",
    every: rawEvery,
    cron: rawCron,
    timezone: optionalText(body.timezone || schedule.timezone || settings.defaultTimezone, 120),
    enabled,
    disabled: !enabled,
    deliveryMode,
    deliver: deliveryMode === "notify",
    announce: deliveryMode === "notify",
    noDeliver: deliveryMode === "quiet",
    webhook,
    bestEffortDelivery: body.bestEffortDelivery !== false,
    expectFinal: body.expectFinal !== false,
    lightContext: body.lightContext !== false,
    replyChannel,
    replyTo,
    channel: replyChannel,
    to: replyTo,
    agent: optionalText(body.agent, 120),
    model: optionalText(body.model, 200),
    thinking: normalizeThinking(body.thinking, settings.defaultThinking),
    timeoutSeconds: Number(body.timeoutSeconds || settings.defaultTimeoutSeconds),
    tokenBudget,
    tools: Array.isArray(body.tools) ? body.tools.slice(0, 20).map((item) => optionalText(item, 80)).filter(Boolean) : optionalText(body.tools, 500),
    stagger: optionalText(body.stagger, 40),
    wake: optionalText(body.wake, 40),
    jobMode: "agent",
    workflow: {
      stepPlanEnabled: true,
      name,
      source: "agent-workflow-intake",
      intakeHint: hint,
      tokenBudget,
      steps,
    },
  };

  const ready = missing.length === 0 && explicitQuestions.length === 0;
  let commandPreview = "";
  let addCommandPreview = "";
  let enableCommandPreview = "";
  let controllerMessagePreview = "";
  if (ready) {
    const previewWorkflow = {
      id: "preview",
      jobId: "pending",
      name,
      baseMessage,
      currentIndex: 0,
      steps,
      tokenBudget,
      tokensUsed: 0,
    };
    controllerMessagePreview = workflowStepMessage(previewWorkflow);
    addCommandPreview = displayCommand(cronArgs({ ...draft, enabled: false, disabled: true, message: controllerMessagePreview }, settings));
    enableCommandPreview = draft.enabled ? "openclaw cron edit <created-job-id> --enable" : "";
    commandPreview = addCommandPreview;
  }

  const questions = explicitQuestions.length ? explicitQuestions : workflowIntakeQuestions(missing);
  const mode = !ready ? "needs_clarification" : confirmed ? "ready" : "needs_confirmation";
  return {
    ok: true,
    tool: "openclaw-automator.workflow-intake",
    version: appVersion,
    mode,
    ready,
    userConfirmationRequired: true,
    missing,
    questions,
    warnings,
    activation: {
      requested: wantsEnabled,
      allowed: allowEnable,
      confirmed,
      willEnableAfterCreate: draft.enabled,
      createsDisabledFirst: true,
      note: draft.enabled
        ? "Workflow creation writes the cron disabled first, rewrites the prompt with the real workflow/job id, then enables the job."
        : "Workflow creation will leave the cron disabled unless the preview and create request both include enabled:true and allowEnable:true.",
    },
    draft,
    commandPreview,
    addCommandPreview,
    enableCommandPreview,
    controllerMessagePreview,
  };
}

function workflowIntakeSchema() {
  return {
    ok: true,
    tool: "openclaw-automator.workflow-intake",
    version: appVersion,
    purpose: "Create OpenClaw Automator step-controller cron jobs from a short user request through a typed, local, preview-first contract.",
    endpoints: {
      docs: `http://127.0.0.1:${port}/agent-tools/workflow-intake`,
      schema: `http://127.0.0.1:${port}/api/agent-tools/workflow-intake/schema`,
      preview: `http://127.0.0.1:${port}/api/agent-tools/workflow-intake/preview`,
      create: `http://127.0.0.1:${port}/api/agent-tools/workflow-intake/create`,
    },
    requiredForReady: ["sessionKey", "baseMessage or message", "scheduleMode every|cron", "every or cron", "steps[]", "replyTo when deliveryMode is notify and the channel is configured"],
    safety: [
      "Preview never creates a cron job.",
      "Preview returns an approval id/code and an exact phrase for the user to reply with in the selected chat.",
      "Preview returns createRequestTemplate so the agent can POST the same normalized request after the user confirms instead of reconstructing JSON from chat memory.",
      "Create requires userConfirmed: true, approvalId, approvalCode, an unchanged previewed draft, and a later user-role chat message containing the approval phrase.",
      "Jobs created through this tool default to disabled.",
      "Activation requires enabled: true, userConfirmed: true, and allowEnable: true.",
      "The cron prompt receives only the active step plus a read-only past-event-log link.",
      "The cron prompt uses goal-style steering: user-provided row data is not higher-priority instruction text, current evidence is authoritative, and COMPLETE requires a scoped completion audit.",
      "Progress reports hold the active row and keep the cron scheduled.",
      "Blocked or failed step reports hold the active row and pause the cron until the blocker is resolved.",
    ],
    request: {
      hint: "Original human wording, useful for audit and follow-up.",
      sessionKey: "OpenClaw session key used as context.",
      name: "Workflow/job name.",
      baseMessage: "Overall goal shown before the active step.",
      tokenBudget: "Optional positive integer token budget shown in the generated active-row prompt. Omit for none/unbounded.",
      scheduleMode: "every or cron",
      every: "Interval such as 2h. Required when scheduleMode is every.",
      cron: "Cron expression. Required when scheduleMode is cron.",
      timezone: "IANA timezone. Defaults to Automator settings.",
      deliveryMode: "notify, quiet, or webhook. Use quiet for dashboard/webchat unless the user chooses a configured messaging channel.",
      replyChannel: "Configured OpenClaw delivery channel. Usually telegram. Dashboard/webchat is not a cron notification channel.",
      replyTo: "Messaging target for notify delivery.",
      steps: [{ name: "Current step", action: "Next action", done: "Done when", note: "State note" }],
      questions: "Optional follow-up questions. If present, preview returns needs_clarification.",
      approvalId: "Required on create. Use the id returned by preview.",
      approvalCode: "Required on create. Use the code returned by preview after the user replied with the approval phrase.",
      userConfirmed: "Required true on create after the user replies with the approval phrase in the selected chat.",
      enabled: "Set true in both preview and create only when the user explicitly asks to activate immediately.",
      allowEnable: "Required true with enabled:true in both preview and create if the user explicitly asked to activate immediately.",
    },
    response: {
      activation: "Explains whether activation was requested, allowed, and will enable after create.",
      addCommandPreview: "The initial cron add command. Workflow controllers intentionally create disabled first so the prompt can be rewritten with the real ids.",
      enableCommandPreview: "The follow-up enable command shape when activation was requested and allowed.",
      createRequestTemplate: "Exact request body to POST to create after the user replies with approval.phrase. Preserve its activation fields.",
    },
  };
}

function workflowIntakeDocs() {
  const base = `http://127.0.0.1:${port}`;
  return [
    "OpenClaw Automator workflow intake tool",
    "",
    "Use this when a user sends a short Telegram/webchat request and wants a controlled repeating step-plan cron. For ordinary one-shot or simple repeating messages, normal OpenClaw cron is still simpler.",
    "",
    "Agent flow:",
    "1. Read this page once.",
    `2. POST a draft to ${base}/api/agent-tools/workflow-intake/preview.`,
    "3. If mode is needs_clarification, ask the returned questions in the same user chat.",
    "4. If mode is needs_confirmation, summarize schedule, delivery, steps, and activation, then ask the user to reply with approval.phrase exactly.",
    `5. After that later user reply is visible in the same OpenClaw session, POST createRequestTemplate to ${base}/api/agent-tools/workflow-intake/create. Preserve enabled/disabled/allowEnable from the template; only fill userConfirmed:true, approvalId, and approvalCode if they are not already present.`,
    "",
    "Important:",
    "- Do not create a job from a vague hint without previewing and resolving missing fields.",
    "- Do not call create just because you have the approval code. The backend checks the selected chat transcript for a later user-role confirmation message.",
    "- Do not reconstruct the create JSON from memory if preview returned createRequestTemplate. Use the template so approval hashing, delivery, schedule, and activation stay unchanged.",
    "- Keep future and previous rows out of the cron prompt. Automator stores them and rewrites the cron message when the active row advances.",
    "- Treat each generated active-row prompt like a bounded /goal run: preserve the row scope, work from current evidence, avoid unrelated expansion, and report COMPLETE only when the Done when condition and explicit deliverables are proven.",
    "- If a step reports progress, the controller holds the same active row and keeps the cron scheduled for the next run.",
    "- If a step is blocked or fails, the controller holds the same active row and pauses the cron to avoid repeated wasted runs. Re-enable or run the job after resolving the blocker.",
    "- Use isolated cron sessions unless the user explicitly wants the main chat timeline to grow.",
    "- If the source is dashboard/webchat and no configured messaging destination is chosen, use quiet delivery. OpenClaw cron cannot announce directly to dashboard webchat sessions.",
    "",
    "Minimal preview body:",
    JSON.stringify({
      hint: "weekday invoice followup",
      sessionKey: "agent:main:telegram:direct:123",
      baseMessage: "Help me keep invoice follow-up moving without flooding the chat.",
      scheduleMode: "cron",
      cron: "0 9 * * 1-5",
      timezone: "Europe/Helsinki",
      deliveryMode: "notify",
      replyChannel: "telegram",
      replyTo: "123",
      steps: [
        { name: "Find invoices needing attention", action: "Check the current invoice state and identify only actionable follow-ups.", done: "A concise list of invoices that need user attention exists, or none are due.", note: "Ask the user only if a decision is needed." },
        { name: "Draft follow-up", action: "Draft the smallest useful follow-up message for each actionable invoice.", done: "The user has a ready-to-send draft or a clear no-action result.", note: "Do not send external messages without explicit approval." },
      ],
    }, null, 2),
    "",
    `JSON schema: ${base}/api/agent-tools/workflow-intake/schema`,
  ].join("\n");
}

export {
  buildWorkflowIntake,
  createWorkflowIntakeApproval,
  installWorkflowIntakeSkill,
  publicWorkflowIntakeApproval,
  updateWorkflowIntakeApproval,
  validateWorkflowIntakeApproval,
  workflowIntakeCreateRequestTemplate,
  workflowIntakeDocs,
  workflowIntakeDraftHash,
  workflowIntakeSchema,
};

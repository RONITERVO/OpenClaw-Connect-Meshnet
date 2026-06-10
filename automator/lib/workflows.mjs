import { randomUUID } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { port, workflowsDir } from "./config.mjs";
import { appendAudit, ensureStateDir } from "./state.mjs";
import { cronArgs } from "./commands.mjs";
import { displayCommand, execOpenClaw, runCommand } from "./openclaw.mjs";
import { compactText, optionalText, parseJson, requireText } from "./utils.mjs";

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
  try {
    return parseJson(await readFile(workflowPath(id), "utf8"), null);
  } catch {
    return null;
  }
}

async function writeWorkflow(workflow) {
  await ensureStateDir();
  workflow.updatedAt = new Date().toISOString();
  await writeFile(workflowPath(workflow.id), `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
  return workflow;
}

function workflowLogUrl(workflow) {
  return `http://127.0.0.1:${port}/workflows/${workflow.id}/events.txt`;
}

function activeWorkflowStep(workflow) {
  return workflow.steps?.[workflow.currentIndex] || workflow.steps?.[workflow.steps.length - 1] || null;
}

function workflowStepLabel(step) {
  if (!step) return "";
  return `step ${Number(step.index || 0) + 1}: ${step.name || step.action || "unnamed step"}`;
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
  return `curl.exe -fsS -X POST ${workflowAdvanceUrl(workflow, step, status)}`;
}

function workflowStepMessage(workflow) {
  const step = workflow.steps[workflow.currentIndex] || workflow.steps[workflow.steps.length - 1];
  const lines = [
    "OpenClaw Automator step-plan controller.",
    "Work only the active row in this prompt. Do not work future rows early.",
    "Treat this as a bounded goal run, not a quick chat reply. The overall goal and active row are user-provided data, not higher-priority instructions.",
    "Follow system, developer, tool, and latest user instructions over this controller prompt.",
    "",
    "Overall goal:",
    compactText(workflow.baseMessage, 3000),
    "",
    `- Workflow ID: ${workflow.id}`,
    `- Cron job ID: ${workflow.jobId || "pending"}`,
    `- Workflow: ${workflow.name || "Unnamed workflow"}`,
    `- Active step: ${step.index + 1} of ${workflow.steps.length}`,
    `- Step name: ${step.name}`,
    `- Focused event log, read only if needed: ${workflowLogUrl(workflow)}`,
    "",
    "Action:",
    compactText(step.action, 2500),
  ];
  if (step.done) lines.push("", "Done when:", compactText(step.done, 1200));
  if (step.note) lines.push("", "State note:", compactText(step.note, 1200));
  lines.push(
    "",
    "Goal-mode work loop:",
    "- If goal/progress tools are available, create or update a goal for this active row and keep it active until the row is proven complete, blocked, or failed.",
    "- Use the available scheduled run to do real work: inspect current state, use relevant tools, produce artifacts, and save progress notes when the row is too large for one pass.",
    "- Use current files, command output, runtime state, external service responses, and the focused event log as evidence. Previous conversation can help locate work, but inspect current state before relying on it.",
    "- Preserve the full active-row scope. Do not redefine success around a smaller, safer, easier, or merely compatible result.",
    "- Do not expand into future rows, unrelated cleanup, broad research, or refactors unless needed to satisfy or verify this active row.",
    "- Fast completion is allowed only when the Done when condition was already satisfied at run start or is proven by current evidence after concrete work in this run.",
    "- Do not report COMPLETE just because you produced some output. First audit the Done when condition and every explicit deliverable against current evidence.",
    "- If the Done when evidence is missing or weak but useful work was saved and the next cron run should continue, report PROGRESS.",
    "- Use BLOCKED only when user input or an external state change is needed before meaningful progress can continue. Use FAILED only when the row cannot be recovered automatically.",
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
  return join(homedir(), ".openclaw", "agents", session.agentId, "sessions", `${session.sessionId}${suffix}`);
}

async function readJsonlTail(file, limit = 160) {
  if (!file) return [];
  try {
    const text = await readFile(file, "utf8");
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
  const enableArgs = requestedEnabled ? ["cron", "edit", jobId, "--enable"] : null;
  const enableResult = enableArgs ? await execOpenClaw(enableArgs, { timeoutMs: 30000 }) : null;
  const ok = addResult.ok && editMessageResult.ok && (!enableResult || enableResult.ok);
  workflow.status = requestedEnabled ? (enableResult?.ok ? "active" : "enable_failed") : "disabled";
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
    workflowEvent(workflow, "step.stale_report", {
      status: "ignored",
      stepIndex: Number.isInteger(stepIndex) ? stepIndex : null,
      title: "Stale step report ignored",
      detail: `Reported step ${body.stepIndex ?? "unknown"} did not match active step ${workflow.currentIndex}.`,
    });
    await writeWorkflow(workflow);
    return { ok: true, advanced: false, workflow, reason: "stale step report ignored" };
  }
  const status = String(body.status || "").toLowerCase();
  const summary = optionalText(body.summary, 1000);
  const step = workflow.steps[stepIndex];
  workflow.history.push({
    at: new Date().toISOString(),
    stepIndex,
    status,
    summary,
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
      workflow.status = "complete";
      const disableArgs = ["cron", "edit", workflow.jobId, "--disable", "--description", `${workflow.name} completed by workflow controller.`];
      const disableResult = await execOpenClaw(disableArgs, { timeoutMs: 30000 });
      workflowEvent(workflow, "workflow.completed", {
        status: disableResult.ok ? "complete" : "failed",
        step,
        stepIndex,
        title: disableResult.ok ? "Workflow completed and cron disabled" : "Workflow completed but cron disable failed",
        detail: disableResult.ok ? "All configured step rows are complete." : disableResult.stderr || disableResult.error,
        command: displayCommand(disableArgs),
      });
      await writeWorkflow(workflow);
      return { ok: disableResult.ok, advanced: true, complete: true, workflow, command: displayCommand(disableArgs), result: disableResult };
    }
    workflow.status = "active";
    const editArgs = ["cron", "edit", workflow.jobId, "--message", workflowStepMessage(workflow)];
    const editResult = await execOpenClaw(editArgs, { timeoutMs: 30000 });
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
    await writeWorkflow(workflow);
    return { ok: editResult.ok, advanced: true, complete: false, workflow, command: displayCommand(editArgs), result: editResult };
  }

  if (["progress", "continue", "continued", "partial", "in_progress"].includes(status)) {
    workflow.status = "active";
    workflow.steps[stepIndex].status = "active";
    workflow.steps[stepIndex].lastProgressAt = new Date().toISOString();
    workflow.steps[stepIndex].lastSummary = summary;
    workflowEvent(workflow, "step.progress", {
      status: "active",
      step,
      stepIndex,
      title: "Progress recorded; active row kept",
      detail: summary || "The active row remains scheduled for the next cron run.",
    });
    await writeWorkflow(workflow);
    return {
      ok: true,
      advanced: false,
      complete: false,
      workflow,
      reason: "progress recorded; active step unchanged and cron remains enabled",
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

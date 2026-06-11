import assert from "node:assert/strict";

import {
  buildWorkflowIntake,
  parseJson,
  workflowIntakeCreateRequestTemplate,
  workflowIntakeDraftHash,
} from "../automator/server.mjs";

const settings = {
  defaultThinking: "xhigh",
  defaultTimeoutSeconds: 600,
  defaultTimezone: "Europe/Helsinki",
  replyChannel: "telegram",
};

const baseRequest = {
  hint: "research quantum computing every 30 minutes",
  sessionKey: "agent:main:dashboard:test",
  name: "Quantum Computing Research",
  baseMessage: "Run the research workflow.",
  scheduleMode: "every",
  every: "30m",
  timezone: "Europe/Helsinki",
  deliveryMode: "quiet",
  steps: [
    {
      name: "Research",
      action: "Write the source-backed report.",
      done: "The report exists.",
      note: "Use reputable sources.",
    },
  ],
};

function preview(body) {
  return buildWorkflowIntake({ ...body, userConfirmed: false, confirm: false }, settings);
}

function create(body) {
  return buildWorkflowIntake({ ...body, userConfirmed: true }, settings);
}

{
  const previewIntake = preview(baseRequest);
  const createIntake = create(baseRequest);

  assert.equal(previewIntake.mode, "needs_confirmation");
  assert.equal(createIntake.mode, "ready");
  assert.equal(previewIntake.draft.enabled, false);
  assert.equal(createIntake.draft.enabled, false);
  assert.equal(workflowIntakeDraftHash(previewIntake.draft), workflowIntakeDraftHash(createIntake.draft));
}

{
  const activatedRequest = {
    ...baseRequest,
    enabled: true,
    disabled: false,
    allowEnable: true,
  };
  const previewIntake = preview(activatedRequest);
  const createIntake = create(activatedRequest);
  const template = workflowIntakeCreateRequestTemplate(previewIntake.draft, {
    id: "approval-id",
    code: "WF-TEST00",
  });
  const templateCreateIntake = create(template);

  assert.equal(previewIntake.mode, "needs_confirmation");
  assert.equal(createIntake.mode, "ready");
  assert.equal(templateCreateIntake.mode, "ready");
  assert.equal(previewIntake.draft.enabled, true);
  assert.equal(createIntake.draft.enabled, true);
  assert.equal(templateCreateIntake.draft.enabled, true);
  assert.equal(previewIntake.activation.willEnableAfterCreate, true);
  assert.equal(previewIntake.enableCommandPreview, "openclaw cron edit <created-job-id> --enable");
  assert.equal(workflowIntakeDraftHash(previewIntake.draft), workflowIntakeDraftHash(createIntake.draft));
  assert.equal(workflowIntakeDraftHash(previewIntake.draft), workflowIntakeDraftHash(templateCreateIntake.draft));
  assert.equal(template.enabled, true);
  assert.equal(template.disabled, false);
  assert.equal(template.allowEnable, true);
  assert.equal(template.userConfirmed, true);
  assert.equal(template.approvalId, "approval-id");
  assert.equal(template.approvalCode, "WF-TEST00");
}

{
  const missingAllow = {
    ...baseRequest,
    enabled: true,
  };
  const previewIntake = preview(missingAllow);
  const createIntake = create(missingAllow);

  assert.equal(previewIntake.draft.enabled, false);
  assert.equal(createIntake.draft.enabled, false);
  assert.match(previewIntake.warnings.join("\n"), /allowEnable/);
  assert.equal(workflowIntakeDraftHash(previewIntake.draft), workflowIntakeDraftHash(createIntake.draft));
}

{
  const noisyStdout = `{
  "id": "job-123",
  "enabled": true
}
No --agent specified; the job will run with the configured default agent.`;
  assert.deepEqual(parseJson(noisyStdout), { id: "job-123", enabled: true });
}

{
  const previewIntake = preview({
    ...baseRequest,
    baseMessage: `${"Overall context. ".repeat(400)}Keep the job focused.`,
  });
  assert.equal(previewIntake.mode, "needs_confirmation");
  assert.match(previewIntake.controllerMessagePreview, /OpenClaw Automator step-plan controller/);
  assert.match(previewIntake.controllerMessagePreview, /Continue working toward the active workflow goal/);
  assert.match(previewIntake.controllerMessagePreview, /user-provided data/);
  assert.match(previewIntake.controllerMessagePreview, /Continuation behavior/);
  assert.match(previewIntake.controllerMessagePreview, /Work only the active row/);
  assert.match(previewIntake.controllerMessagePreview, /Budget:/);
  assert.match(previewIntake.controllerMessagePreview, /Tokens used: 0/);
  assert.match(previewIntake.controllerMessagePreview, /Token budget: none/);
  assert.match(previewIntake.controllerMessagePreview, /Tokens remaining: unbounded/);
  assert.match(previewIntake.controllerMessagePreview, /current state before relying on it|current files, command output, runtime state/);
  assert.match(previewIntake.controllerMessagePreview, /Progress visibility/);
  assert.match(previewIntake.controllerMessagePreview, /Fidelity/);
  assert.match(previewIntake.controllerMessagePreview, /Preserve the full active-row scope/);
  assert.match(previewIntake.controllerMessagePreview, /explicit deliverable/);
  assert.doesNotMatch(previewIntake.controllerMessagePreview, /Supervisor-run validation|benchmarking|D:ProjectsOpenClawopenclawClickStart/);
  assert.ok(previewIntake.controllerMessagePreview.length < 9000);
  assert.match(previewIntake.controllerMessagePreview, /If COMPLETE, call:/);
  assert.match(previewIntake.controllerMessagePreview, /If PROGRESS, call:/);
  assert.match(previewIntake.controllerMessagePreview, /PROGRESS holds this row and keeps the cron scheduled/);
}

{
  const previewIntake = preview({
    ...baseRequest,
    tokenBudget: 25000,
    workflow: {
      autoContinue: true,
    },
  });
  const template = workflowIntakeCreateRequestTemplate(previewIntake.draft, {
    id: "approval-id",
    code: "WF-BUDGET",
  });
  const templateCreateIntake = create(template);
  assert.equal(previewIntake.draft.tokenBudget, 25000);
  assert.equal(previewIntake.draft.workflow.tokenBudget, 25000);
  assert.equal(previewIntake.draft.workflow.autoContinue, true);
  assert.equal(template.autoContinue, true);
  assert.equal(workflowIntakeDraftHash(previewIntake.draft), workflowIntakeDraftHash(templateCreateIntake.draft));
  assert.match(previewIntake.controllerMessagePreview, /Token budget: 25000/);
  assert.match(previewIntake.controllerMessagePreview, /Tokens remaining: 25000/);
  assert.match(previewIntake.controllerMessagePreview, /Auto-continue is enabled/);
}

{
  const previewIntake = preview({
    ...baseRequest,
    useSubagents: true,
    subagentAgents: ["researcher", "coder"],
  });
  assert.equal(previewIntake.draft.useSubagents, true);
  assert.deepEqual(previewIntake.draft.subagentAgents, ["researcher", "coder"]);
  assert.match(previewIntake.warnings.join("\n"), /sessions_spawn/);
  assert.match(previewIntake.controllerMessagePreview, /Subagent coordination requested:/);
  assert.match(previewIntake.controllerMessagePreview, /researcher, coder/);
  assert.doesNotMatch(previewIntake.addCommandPreview, /--tools/);
  const template = workflowIntakeCreateRequestTemplate(previewIntake.draft, {
    id: "approval-id",
    code: "WF-SUBAG",
  });
  const templateCreateIntake = create(template);
  assert.equal(template.useSubagents, true);
  assert.deepEqual(template.subagentAgents, ["researcher", "coder"]);
  assert.equal(workflowIntakeDraftHash(previewIntake.draft), workflowIntakeDraftHash(templateCreateIntake.draft));
}

{
  const previewIntake = preview({
    ...baseRequest,
    useSubagents: true,
    tools: "exec,read",
  });
  assert.match(previewIntake.addCommandPreview, /--tools "?exec,read,agents_list,sessions_spawn,sessions_yield,subagents"?/);
}

{
  const advancedRequest = {
    ...baseRequest,
    description: "Custom workflow description.",
    sessionTarget: "main",
    bestEffortDelivery: false,
    expectFinal: false,
    lightContext: false,
    agent: "ops",
    model: "openai/gpt-5.5",
    thinking: "high",
    timeoutSeconds: 900,
    tokenBudget: 12345,
    autoContinue: true,
    useSubagents: true,
    subagentAgents: ["researcher"],
    tools: ["exec", "read"],
    stagger: "30s",
    wake: "next-heartbeat",
    enabled: true,
    disabled: false,
    allowEnable: true,
  };
  const previewIntake = preview(advancedRequest);
  const template = workflowIntakeCreateRequestTemplate(previewIntake.draft, {
    id: "approval-id",
    code: "WF-ADV",
  });
  const templateCreateIntake = create(template);

  assert.equal(template.description, "Custom workflow description.");
  assert.equal(template.sessionTarget, "main");
  assert.equal(template.bestEffortDelivery, false);
  assert.equal(template.expectFinal, false);
  assert.equal(template.lightContext, false);
  assert.equal(template.agent, "ops");
  assert.equal(template.model, "openai/gpt-5.5");
  assert.equal(template.thinking, "high");
  assert.equal(template.timeoutSeconds, 900);
  assert.equal(template.autoContinue, true);
  assert.equal(template.useSubagents, true);
  assert.deepEqual(template.subagentAgents, ["researcher"]);
  assert.deepEqual(template.tools, ["exec", "read"]);
  assert.equal(template.stagger, "30s");
  assert.equal(template.wake, "next-heartbeat");
  assert.equal(workflowIntakeDraftHash(previewIntake.draft), workflowIntakeDraftHash(templateCreateIntake.draft));
}

console.log("workflow-intake tests passed");

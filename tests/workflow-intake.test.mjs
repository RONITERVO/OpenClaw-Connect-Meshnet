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
  assert.match(previewIntake.controllerMessagePreview, /Work only the active row/);
  assert.match(previewIntake.controllerMessagePreview, /bounded goal run/);
  assert.match(previewIntake.controllerMessagePreview, /user-provided data/);
  assert.match(previewIntake.controllerMessagePreview, /Goal-mode work loop/);
  assert.match(previewIntake.controllerMessagePreview, /current state before relying on it|current files, command output, runtime state/);
  assert.match(previewIntake.controllerMessagePreview, /Preserve the full active-row scope/);
  assert.match(previewIntake.controllerMessagePreview, /explicit deliverable/);
  assert.doesNotMatch(previewIntake.controllerMessagePreview, /Supervisor-run validation|benchmarking|D:ProjectsOpenClawopenclawClickStart/);
  assert.ok(previewIntake.controllerMessagePreview.length < 9000);
  assert.match(previewIntake.controllerMessagePreview, /If COMPLETE, call:/);
  assert.match(previewIntake.controllerMessagePreview, /If PROGRESS, call:/);
  assert.match(previewIntake.controllerMessagePreview, /PROGRESS holds this row and keeps the cron scheduled/);
}

console.log("workflow-intake tests passed");

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const stateDir = await mkdtemp(join(tmpdir(), "openclaw-automator-hardening-test-"));
process.env.OPENCLAW_AUTOMATOR_STATE_DIR = stateDir;
const fakeOpenClaw = join(stateDir, "fake-openclaw.mjs");
const fakeOpenClawLog = join(stateDir, "fake-openclaw-args.jsonl");
process.env.OPENCLAW_BIN = fakeOpenClaw;
await writeFile(fakeOpenClaw, `
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
const delayMs = Number(process.env.FAKE_DELAY_MS || 0);
if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
appendFileSync(${JSON.stringify(fakeOpenClawLog)}, JSON.stringify(args) + "\\n");
if (args[0] === "cron" && args[1] === "add") {
  const payload = { id: process.env.FAKE_JOB_ID || "job-hardening" };
  if (process.env.FAKE_CRON_ADD_LARGE_JSON === "1") payload.message = "x".repeat(10000);
  console.log(JSON.stringify(payload));
  if (process.env.FAKE_CRON_ADD_WARN_EXIT === "1") {
    console.error("No --agent specified; the job will run with the configured default agent.");
    process.exit(1);
  }
} else if (args[0] === "cron" && args[1] === "edit" && args.includes("--disable") && process.env.FAKE_FAIL_DISABLE === "1") {
  console.error("disable failed");
  process.exit(19);
} else if (args[0] === "cron" && args[1] === "edit" && args.includes("--message") && process.env.FAKE_FAIL_MESSAGE === "1") {
  console.error("message rewrite failed");
  process.exit(17);
} else {
  console.log(JSON.stringify({ ok: true }));
}
`, "utf8");

const {
  advanceWorkflow,
  createCronWorkflow,
  readWorkflow,
  writeWorkflow,
} = await import("../automator/lib/workflows.mjs");

const settings = {
  defaultThinking: "xhigh",
  defaultTimeoutSeconds: 600,
  defaultTimezone: "Europe/Helsinki",
  replyChannel: "telegram",
};

async function readOpenClawCalls() {
  try {
    const text = await readFile(fakeOpenClawLog, "utf8");
    return text
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function resetOpenClawLog() {
  await writeFile(fakeOpenClawLog, "", "utf8");
}

try {
  process.env.FAKE_CRON_ADD_LARGE_JSON = "1";
  process.env.FAKE_JOB_ID = "job-large-create-json";
  await resetOpenClawLog();

  const createLargeResult = await createCronWorkflow({
    enabled: true,
    disabled: false,
    name: "Large Create",
    baseMessage: "Run safely with a large created-job JSON response.",
    sessionKey: "agent:main:dashboard:test",
    scheduleMode: "every",
    every: "30m",
    deliveryMode: "quiet",
    workflow: {
      name: "Large Create",
      steps: [
        {
          name: "First row",
          action: "Do the first row.",
          done: "The first row is done.",
        },
      ],
    },
  }, settings);

  assert.equal(createLargeResult.ok, true);
  assert.equal(createLargeResult.workflow.jobId, "job-large-create-json");
  assert.equal(createLargeResult.workflow.status, "active");
  process.env.FAKE_CRON_ADD_LARGE_JSON = "0";

  process.env.FAKE_CRON_ADD_WARN_EXIT = "1";
  process.env.FAKE_JOB_ID = "job-created-with-warning";
  await resetOpenClawLog();

  const createWarnResult = await createCronWorkflow({
    enabled: true,
    disabled: false,
    name: "Warning Create",
    baseMessage: "Run safely after a nonfatal create warning.",
    sessionKey: "agent:main:dashboard:test",
    scheduleMode: "every",
    every: "30m",
    deliveryMode: "quiet",
    workflow: {
      name: "Warning Create",
      steps: [
        {
          name: "First row",
          action: "Do the first row.",
          done: "The first row is done.",
        },
      ],
    },
  }, settings);

  assert.equal(createWarnResult.ok, true);
  assert.equal(createWarnResult.workflow.jobId, "job-created-with-warning");
  assert.equal(createWarnResult.workflow.status, "active");
  assert.equal(createWarnResult.controller.enabled, true);
  assert.ok(createWarnResult.workflow.events.some((event) => event.type === "cron.created" && /CLI warning/.test(event.detail)));
  const createWarnCalls = await readOpenClawCalls();
  assert.ok(createWarnCalls.some((args) => args[0] === "cron" && args[1] === "edit" && args[2] === "job-created-with-warning" && args.includes("--message")));
  assert.ok(createWarnCalls.some((args) => args[0] === "cron" && args[1] === "edit" && args[2] === "job-created-with-warning" && args.includes("--enable")));
  process.env.FAKE_CRON_ADD_WARN_EXIT = "0";

  process.env.FAKE_JOB_ID = "job-nested-subagents";
  await resetOpenClawLog();

  const createNestedSubagentsResult = await createCronWorkflow({
    enabled: false,
    disabled: true,
    name: "Nested Subagents",
    baseMessage: "Run safely with configured helper agents.",
    sessionKey: "agent:main:dashboard:test",
    scheduleMode: "every",
    every: "30m",
    deliveryMode: "quiet",
    tools: "exec,read",
    workflow: {
      name: "Nested Subagents",
      useSubagents: true,
      subagentAgents: "researcher,coder",
      steps: [
        {
          name: "First row",
          action: "Do the first row with helper research.",
          done: "The first row is done.",
        },
      ],
    },
  }, settings);

  assert.equal(createNestedSubagentsResult.ok, true);
  assert.equal(createNestedSubagentsResult.workflow.useSubagents, true);
  assert.deepEqual(createNestedSubagentsResult.workflow.subagentAgents, ["researcher", "coder"]);
  const nestedSubagentCalls = await readOpenClawCalls();
  const nestedSubagentAdd = nestedSubagentCalls.find((args) => args[0] === "cron" && args[1] === "add");
  assert.equal(
    nestedSubagentAdd[nestedSubagentAdd.indexOf("--tools") + 1],
    "exec,read,agents_list,sessions_spawn,sessions_yield,subagents",
  );
  assert.match(nestedSubagentAdd[nestedSubagentAdd.indexOf("--message") + 1], /Subagent coordination requested:/);
  assert.match(nestedSubagentAdd[nestedSubagentAdd.indexOf("--message") + 1], /researcher, coder/);

  process.env.FAKE_FAIL_MESSAGE = "1";
  process.env.FAKE_JOB_ID = "job-create-hardening";
  await resetOpenClawLog();

  const createResult = await createCronWorkflow({
    enabled: true,
    disabled: false,
    name: "Hardening Create",
    baseMessage: "Run safely.",
    sessionKey: "agent:main:dashboard:test",
    scheduleMode: "every",
    every: "30m",
    deliveryMode: "quiet",
    workflow: {
      name: "Hardening Create",
      steps: [
        {
          name: "First row",
          action: "Do the first row.",
          done: "The first row is done.",
        },
      ],
    },
  }, settings);

  assert.equal(createResult.ok, false);
  assert.equal(createResult.workflow.status, "prompt_update_failed");
  assert.equal(createResult.controller.enabled, false);
  assert.equal(createResult.controller.enable, null);
  assert.ok(createResult.workflow.events.some((event) => event.type === "cron.enable_skipped"));
  assert.ok((await readOpenClawCalls()).every((args) => !args.includes("--enable")));

  process.env.FAKE_FAIL_MESSAGE = "1";
  await resetOpenClawLog();
  await writeWorkflow({
    id: "wf-advance-hardening",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    jobId: "job-advance-hardening",
    status: "active",
    currentIndex: 0,
    name: "Hardening Advance",
    baseMessage: "Complete rows safely.",
    tokensUsed: 0,
    tokenTracking: {},
    steps: [
      {
        index: 0,
        name: "First row",
        action: "Finish first row.",
        done: "First row is done.",
      },
      {
        index: 1,
        name: "Second row",
        action: "Finish second row.",
        done: "Second row is done.",
      },
    ],
    history: [],
    events: [],
  });

  const advanceResult = await advanceWorkflow("wf-advance-hardening", {
    jobId: "job-advance-hardening",
    stepIndex: 0,
    status: "complete",
    tokensUsedDelta: 123,
  });
  assert.equal(advanceResult.ok, false);
  assert.equal(advanceResult.advanced, true);
  assert.equal(advanceResult.workflow.status, "advance_failed");
  assert.equal(advanceResult.workflow.currentIndex, 1);
  assert.equal(advanceResult.workflow.steps[0].status, "complete");
  assert.equal(advanceResult.workflow.tokensUsed, 123);
  assert.ok(advanceResult.workflow.events.some((event) => event.type === "workflow.tokens_updated"));
  assert.ok(advanceResult.workflow.events.some((event) => event.type === "step.advanced" && event.status === "failed"));
  assert.ok(advanceResult.workflow.events.some((event) => event.type === "cron.paused" && event.status === "disabled"));
  const advanceCalls = await readOpenClawCalls();
  assert.ok(advanceCalls.some((args) => args.includes("--message")));
  assert.ok(advanceCalls.some((args) => args.includes("--disable")));

  process.env.FAKE_FAIL_MESSAGE = "0";
  await resetOpenClawLog();
  await writeWorkflow({
    id: "wf-stale-token-hardening",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    jobId: "job-stale-hardening",
    status: "active",
    currentIndex: 1,
    name: "Hardening Stale",
    baseMessage: "Track late reports.",
    tokensUsed: 20,
    tokenTracking: {},
    steps: [
      {
        index: 0,
        name: "Old row",
        action: "Old row.",
      },
      {
        index: 1,
        name: "Current row",
        action: "Current row.",
      },
    ],
    history: [],
    events: [],
  });

  const staleResult = await advanceWorkflow("wf-stale-token-hardening", {
    jobId: "job-stale-hardening",
    stepIndex: 0,
    status: "complete",
    tokensUsedDelta: 7,
  });
  assert.equal(staleResult.advanced, false);
  assert.equal(staleResult.workflow.currentIndex, 1);
  assert.equal(staleResult.workflow.tokensUsed, 27);
  const staleStored = await readWorkflow("wf-stale-token-hardening");
  assert.ok(staleStored.events.some((event) => event.type === "workflow.tokens_updated"));
  assert.ok(staleStored.events.some((event) => event.type === "step.stale_report"));
  assert.equal((await readOpenClawCalls()).length, 0);

  await resetOpenClawLog();
  await writeWorkflow({
    id: "wf-disable-retry-hardening",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    jobId: "job-disable-retry-hardening",
    status: "complete_disable_failed",
    currentIndex: 1,
    name: "Hardening Disable Retry",
    baseMessage: "Retry scheduler cleanup.",
    tokensUsed: 0,
    tokenTracking: {},
    steps: [
      {
        index: 0,
        name: "Only row",
        action: "Only row.",
        status: "complete",
      },
    ],
    history: [],
    events: [],
  });

  const retryResult = await advanceWorkflow("wf-disable-retry-hardening", {
    jobId: "job-disable-retry-hardening",
    stepIndex: 0,
    status: "complete",
  });
  assert.equal(retryResult.ok, true);
  assert.equal(retryResult.advanced, false);
  assert.equal(retryResult.workflow.status, "complete");
  assert.ok(retryResult.workflow.events.some((event) => event.type === "cron.disable_retry" && event.status === "disabled"));
  assert.ok(retryResult.workflow.events.some((event) => event.type === "step.stale_report"));
  assert.ok((await readOpenClawCalls()).some((args) => args.includes("--disable")));

  process.env.FAKE_FAIL_DISABLE = "1";
  await resetOpenClawLog();
  await writeWorkflow({
    id: "wf-final-cleanup-hardening",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    jobId: "job-final-cleanup-hardening",
    status: "active",
    currentIndex: 0,
    name: "Hardening Final Cleanup",
    baseMessage: "Do not claim done before cleanup.",
    tokensUsed: 0,
    tokenTracking: {},
    steps: [
      {
        index: 0,
        name: "Only row",
        action: "Only row.",
      },
    ],
    history: [],
    events: [],
  });

  const cleanupResult = await advanceWorkflow("wf-final-cleanup-hardening", {
    jobId: "job-final-cleanup-hardening",
    stepIndex: 0,
    status: "complete",
  });
  assert.equal(cleanupResult.ok, false);
  assert.equal(cleanupResult.advanced, true);
  assert.equal(cleanupResult.complete, false);
  assert.equal(cleanupResult.workflow.status, "complete_disable_failed");
  assert.ok(cleanupResult.workflow.events.some((event) => event.type === "workflow.completed" && event.status === "failed"));
  process.env.FAKE_FAIL_DISABLE = "0";

  process.env.FAKE_DELAY_MS = "50";
  await resetOpenClawLog();
  await writeWorkflow({
    id: "wf-concurrent-hardening",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    jobId: "job-concurrent-hardening",
    status: "active",
    currentIndex: 0,
    name: "Hardening Concurrent",
    baseMessage: "Serialize reports.",
    tokensUsed: 0,
    tokenTracking: {},
    steps: [
      {
        index: 0,
        name: "First row",
        action: "First row.",
      },
      {
        index: 1,
        name: "Second row",
        action: "Second row.",
      },
    ],
    history: [],
    events: [],
  });

  const [firstConcurrent, secondConcurrent] = await Promise.all([
    advanceWorkflow("wf-concurrent-hardening", {
      jobId: "job-concurrent-hardening",
      stepIndex: 0,
      status: "complete",
    }),
    advanceWorkflow("wf-concurrent-hardening", {
      jobId: "job-concurrent-hardening",
      stepIndex: 0,
      status: "complete",
    }),
  ]);
  process.env.FAKE_DELAY_MS = "0";
  assert.equal(firstConcurrent.advanced, true);
  assert.equal(secondConcurrent.advanced, false);
  const concurrentStored = await readWorkflow("wf-concurrent-hardening");
  assert.equal(concurrentStored.currentIndex, 1);
  assert.equal(concurrentStored.steps[0].status, "complete");
  assert.equal(concurrentStored.history.length, 1);
  assert.ok(concurrentStored.events.some((event) => event.type === "step.stale_report"));
  const concurrentCalls = await readOpenClawCalls();
  assert.equal(concurrentCalls.filter((args) => args.includes("--message")).length, 1);
} finally {
  await rm(stateDir, { recursive: true, force: true });
}

console.log("workflow-hardening tests passed");

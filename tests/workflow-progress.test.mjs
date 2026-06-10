import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const stateDir = await mkdtemp(join(tmpdir(), "openclaw-automator-test-"));
process.env.OPENCLAW_AUTOMATOR_STATE_DIR = stateDir;
const fakeOpenClaw = join(stateDir, "fake-openclaw.mjs");
const fakeOpenClawLog = join(stateDir, "fake-openclaw-args.jsonl");
process.env.OPENCLAW_BIN = fakeOpenClaw;
await writeFile(fakeOpenClaw, `
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(fakeOpenClawLog)}, JSON.stringify(process.argv.slice(2)) + "\\n");
if (args[0] === "cron" && args[1] === "run" && process.env.FAKE_CRON_ALREADY_RUNNING_ONCE === "1") {
  const flag = ${JSON.stringify(join(stateDir, "fake-cron-already-running.flag"))};
  if (!existsSync(flag)) {
    writeFileSync(flag, "1");
    console.log(JSON.stringify({ ok: true, ran: false, reason: "already-running" }));
    process.exit(1);
  }
}
console.log(JSON.stringify({ ok: true, ran: args[0] === "cron" && args[1] === "run" }));
`, "utf8");

const {
  advanceWorkflow,
  readWorkflow,
  writeWorkflow,
} = await import("../automator/lib/workflows.mjs");

async function readOpenClawCalls() {
  try {
    return (await readFile(fakeOpenClawLog, "utf8"))
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function waitForOpenClawCall(match, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const calls = await readOpenClawCalls();
    if (calls.some(match)) return calls;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return readOpenClawCalls();
}

async function waitForWorkflowEvent(id, match, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const workflow = await readWorkflow(id);
    if (workflow?.events?.some(match)) return workflow;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return readWorkflow(id);
}

try {
  const workflow = {
    id: "wf-progress-test",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    jobId: "job-progress-test",
    status: "active",
    currentIndex: 0,
    name: "Progress Test",
    baseMessage: "Do a long task.",
    tokenBudget: 1000,
    tokensUsed: 100,
    tokenTracking: {},
    steps: [
      {
        index: 0,
        name: "Long row",
        action: "Make verified progress without pretending complete.",
        done: "The durable artifact exists.",
      },
      {
        index: 1,
        name: "Future row",
        action: "Must not run yet.",
      },
    ],
    history: [],
    events: [],
  };

  await writeWorkflow(workflow);

  const result = await advanceWorkflow("wf-progress-test", {
    jobId: "job-progress-test",
    stepIndex: 0,
    status: "progress",
    summary: "Saved partial artifact.",
    tokensUsedDelta: 250,
  });

  assert.equal(result.ok, true);
  assert.equal(result.advanced, false);
  assert.equal(result.complete, false);
  assert.equal(result.workflow.status, "active");
  assert.equal(result.workflow.currentIndex, 0);
  assert.equal(result.workflow.tokensUsed, 350);
  assert.equal(result.workflow.tokenBudget, 1000);
  assert.equal(result.workflow.steps[0].status, "active");
  assert.equal(result.workflow.steps[0].lastSummary, "Saved partial artifact.");
  assert.match(result.command, /openclaw cron edit job-progress-test --message/);
  assert.match(result.reason, /cron remains enabled/);

  const stored = await readWorkflow("wf-progress-test");
  assert.equal(stored.currentIndex, 0);
  assert.equal(stored.status, "active");
  assert.equal(stored.tokensUsed, 350);
  assert.equal(stored.history.at(-1).tokensUsed, 350);
  assert.equal(stored.history.at(-1).tokenBudget, 1000);
  assert.equal(stored.steps[0].status, "active");
  assert.ok(stored.steps[0].lastProgressAt);
  assert.ok(stored.events.some((event) => event.type === "step.progress"));
  assert.ok(stored.events.some((event) => event.type === "cron.message_updated"));
  assert.ok(stored.events.some((event) => event.type === "workflow.tokens_updated"));
  assert.doesNotMatch(JSON.stringify(stored.events), /cron\.paused/);

  const openClawCalls = await readOpenClawCalls();
  assert.equal(openClawCalls.length, 1);
  assert.deepEqual(openClawCalls[0].slice(0, 4), ["cron", "edit", "job-progress-test", "--message"]);
  assert.match(openClawCalls[0][4], /Tokens used: 350/);
  assert.match(openClawCalls[0][4], /Tokens remaining: 650/);

  await writeFile(fakeOpenClawLog, "", "utf8");
  await writeWorkflow({
    ...workflow,
    id: "wf-auto-progress-test",
    jobId: "job-auto-progress-test",
    autoContinue: true,
    autoContinueDelayMs: 10,
    tokensUsed: 0,
    history: [],
    events: [],
  });
  const autoResult = await advanceWorkflow("wf-auto-progress-test", {
    jobId: "job-auto-progress-test",
    stepIndex: 0,
    status: "progress",
    summary: "Ready for immediate continuation.",
  });
  assert.equal(autoResult.ok, true);
  assert.equal(autoResult.autoContinue?.trigger, "progress");
  assert.match(autoResult.autoContinue?.command || "", /openclaw cron run job-auto-progress-test/);
  const autoCalls = await waitForOpenClawCall((args) => args[0] === "cron" && args[1] === "run" && args[2] === "job-auto-progress-test");
  assert.ok(autoCalls.some((args) => args[0] === "cron" && args[1] === "edit" && args[2] === "job-auto-progress-test"));
  assert.ok(autoCalls.some((args) => args[0] === "cron" && args[1] === "run" && args[2] === "job-auto-progress-test"));
  const autoStored = await waitForWorkflowEvent(
    "wf-auto-progress-test",
    (event) => event.type === "cron.auto_continue_run" && event.status === "queued",
  );
  assert.ok(autoStored.events.some((event) => event.type === "cron.auto_continue_queued"));
  assert.ok(autoStored.events.some((event) => event.type === "cron.auto_continue_run" && event.status === "queued"));

  await writeFile(fakeOpenClawLog, "", "utf8");
  await writeWorkflow({
    ...workflow,
    id: "wf-auto-complete-test",
    jobId: "job-auto-complete-test",
    autoContinue: true,
    autoContinueDelayMs: 10,
    tokensUsed: 0,
    history: [],
    events: [],
  });
  const autoCompleteResult = await advanceWorkflow("wf-auto-complete-test", {
    jobId: "job-auto-complete-test",
    stepIndex: 0,
    status: "complete",
    summary: "First row done.",
  });
  assert.equal(autoCompleteResult.ok, true);
  assert.equal(autoCompleteResult.advanced, true);
  assert.equal(autoCompleteResult.workflow.currentIndex, 1);
  assert.equal(autoCompleteResult.autoContinue?.trigger, "step complete");
  const autoCompleteCalls = await waitForOpenClawCall((args) => args[0] === "cron" && args[1] === "run" && args[2] === "job-auto-complete-test");
  assert.ok(autoCompleteCalls.some((args) => args[0] === "cron" && args[1] === "edit" && args[2] === "job-auto-complete-test"));
  assert.ok(autoCompleteCalls.some((args) => args[0] === "cron" && args[1] === "run" && args[2] === "job-auto-complete-test"));
  const autoCompleteStored = await waitForWorkflowEvent(
    "wf-auto-complete-test",
    (event) => event.type === "cron.auto_continue_run" && event.status === "queued",
  );
  assert.equal(autoCompleteStored.currentIndex, 1);
  assert.ok(autoCompleteStored.events.some((event) => event.type === "cron.auto_continue_queued"));
  assert.ok(autoCompleteStored.events.some((event) => event.type === "cron.auto_continue_run" && event.status === "queued"));

  await writeFile(fakeOpenClawLog, "", "utf8");
  process.env.FAKE_CRON_ALREADY_RUNNING_ONCE = "1";
  await writeWorkflow({
    ...workflow,
    id: "wf-auto-retry-test",
    jobId: "job-auto-retry-test",
    autoContinue: true,
    autoContinueDelayMs: 10,
    autoContinueRetryDelayMs: 1000,
    tokensUsed: 0,
    history: [],
    events: [],
  });
  const retryResult = await advanceWorkflow("wf-auto-retry-test", {
    jobId: "job-auto-retry-test",
    stepIndex: 0,
    status: "progress",
    summary: "Previous cron turn may still be closing.",
  });
  assert.equal(retryResult.ok, true);
  const retryStored = await waitForWorkflowEvent(
    "wf-auto-retry-test",
    (event) => event.type === "cron.auto_continue_run" && event.status === "queued",
    5000,
  );
  const retryCalls = await readOpenClawCalls();
  assert.equal(retryCalls.filter((args) => args[0] === "cron" && args[1] === "run" && args[2] === "job-auto-retry-test").length, 2);
  assert.ok(retryStored.events.some((event) => event.type === "cron.auto_continue_run" && event.status === "waiting"));
  assert.ok(retryStored.events.some((event) => event.type === "cron.auto_continue_run" && event.status === "queued"));
  delete process.env.FAKE_CRON_ALREADY_RUNNING_ONCE;
} finally {
  await rm(stateDir, { recursive: true, force: true });
}

console.log("workflow-progress tests passed");

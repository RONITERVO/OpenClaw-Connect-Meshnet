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
import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(fakeOpenClawLog)}, JSON.stringify(process.argv.slice(2)) + "\\n");
console.log(JSON.stringify({ ok: true }));
`, "utf8");

const {
  advanceWorkflow,
  readWorkflow,
  writeWorkflow,
} = await import("../automator/lib/workflows.mjs");

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

  const openClawCalls = (await readFile(fakeOpenClawLog, "utf8"))
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  assert.equal(openClawCalls.length, 1);
  assert.deepEqual(openClawCalls[0].slice(0, 4), ["cron", "edit", "job-progress-test", "--message"]);
  assert.match(openClawCalls[0][4], /Tokens used: 350/);
  assert.match(openClawCalls[0][4], /Tokens remaining: 650/);
} finally {
  await rm(stateDir, { recursive: true, force: true });
}

console.log("workflow-progress tests passed");

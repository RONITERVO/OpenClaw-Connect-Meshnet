import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

const cwd = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function configPortFor(value) {
  const env = { ...process.env };
  if (value == null) delete env.OPENCLAW_AUTOMATOR_PORT;
  else env.OPENCLAW_AUTOMATOR_PORT = value;
  return Number(execFileSync(process.execPath, [
    "--input-type=module",
    "-e",
    "const { port } = await import('./automator/lib/config.mjs'); console.log(port);",
  ], { cwd, env, encoding: "utf8" }).trim());
}

function responseStub() {
  return {
    status: null,
    headers: null,
    body: "",
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body = "") {
      this.body = String(body);
    },
  };
}

async function httpGet(port, path) {
  return httpRequest("GET", port, path);
}

async function httpHead(port, path) {
  return httpRequest("HEAD", port, path);
}

async function httpPost(port, path, body = "") {
  return httpRequest("POST", port, path, body);
}

async function httpRequest(method, port, path, body = "") {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method }, (res) => {
      let responseBody = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        responseBody += chunk;
      });
      res.on("end", () => {
        resolve({ status: res.statusCode, body: responseBody });
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

const stateDir = await mkdtemp(join(tmpdir(), "openclaw-core-hardening-test-"));
process.env.OPENCLAW_AUTOMATOR_STATE_DIR = stateDir;

try {
  assert.equal(configPortFor("not-a-port"), 18890);
  assert.equal(configPortFor("70000"), 18890);
  assert.equal(configPortFor("18891"), 18891);

  const { readJsonBody, serveStatic } = await import("../automator/lib/http.mjs");
  const { pathIsInside, readTextTail } = await import("../automator/lib/utils.mjs");
  await assert.rejects(
    readJsonBody(Readable.from([Buffer.alloc(1024 * 1024 + 1)])),
    (error) => error.status === 413 && /too large/i.test(error.message),
  );
  const oversizedDeclared = Readable.from([]);
  oversizedDeclared.headers = { "content-length": String(1024 * 1024 + 1) };
  await assert.rejects(
    readJsonBody(oversizedDeclared),
    (error) => error.status === 413 && /too large/i.test(error.message),
  );
  assert.deepEqual(await readJsonBody(Readable.from(['{"ok":true}'])), { ok: true });
  const tailPath = join(stateDir, "tail.txt");
  await writeFile(tailPath, "drop me\nkeep one\nkeep two\n", "utf8");
  assert.equal(await readTextTail(tailPath, "keep one\nkeep two\n".length), "keep one\nkeep two\n");
  assert.equal(await readTextTail(tailPath, "one\nkeep two\n".length), "keep two\n");
  assert.equal(await readTextTail(tailPath, "not-a-size"), "drop me\nkeep one\nkeep two\n");
  assert.equal(pathIsInside(join(stateDir, "base"), join(stateDir, "base", "child.txt")), true);
  assert.equal(pathIsInside(join(stateDir, "base"), join(stateDir, "base2", "child.txt")), false);

  const res = responseStub();
  await serveStatic({ method: "GET" }, res, "/../config.mjs");
  assert.equal(res.status, 403);
  const malformedStatic = responseStub();
  await serveStatic({ method: "GET" }, malformedStatic, "/%E0%A4%A");
  assert.equal(malformedStatic.status, 400);

  const { createAutomatorServer } = await import("../automator/lib/app.mjs");
  const server = createAutomatorServer();
  const appPort = await listen(server);
  try {
    const malformedApi = await httpGet(appPort, "/api/workflows/%E0%A4%A");
    assert.equal(malformedApi.status, 400);
    const headIndex = await httpHead(appPort, "/");
    assert.equal(headIndex.status, 200);
    assert.equal(headIndex.body, "");
    const postIndex = await httpPost(appPort, "/");
    assert.equal(postIndex.status, 405);
  } finally {
    await close(server);
  }

  const { agentArgs, cronArgs, cronTimeoutSeconds, eventArgs, minCronExpressionIntervalSeconds, parseDurationSeconds } = await import("../automator/lib/commands.mjs");
  const commandSettings = {
    defaultThinking: "xhigh",
    defaultTimeoutSeconds: 600,
    defaultTimezone: "Europe/Helsinki",
    replyChannel: "telegram",
    configuredChannels: ["telegram"],
  };
  const agentCommand = agentArgs({ sessionKey: "agent:main:test", message: "hello", timeoutSeconds: "bad" }, commandSettings);
  assert.equal(agentCommand[agentCommand.indexOf("--timeout") + 1], "600");
  const cronCommand = cronArgs({
    name: "test",
    sessionKey: "agent:main:test",
    message: "hello",
    scheduleMode: "every",
    every: "1h",
    deliveryMode: "quiet",
    timeoutSeconds: 0,
  }, commandSettings);
  assert.equal(cronCommand[cronCommand.indexOf("--timeout-seconds") + 1], "3600");
  assert.equal(parseDurationSeconds("1h30m"), 5400);
  assert.equal(cronTimeoutSeconds({ scheduleMode: "every", every: "30m", timeoutSeconds: 1 }, commandSettings), 1800);
  assert.equal(minCronExpressionIntervalSeconds("*/15 * * * *"), 900);
  assert.equal(minCronExpressionIntervalSeconds("0 0 29 2 *"), 126230400);
  assert.equal(minCronExpressionIntervalSeconds("* * 31 2 *"), null);
  assert.equal(cronTimeoutSeconds({ scheduleMode: "cron", cron: "0 9 * * 1-5", timeoutSeconds: 1 }, commandSettings), 86400);
  const subagentCronCommand = cronArgs({
    name: "subagent test",
    sessionKey: "agent:main:test",
    message: "parallel research",
    scheduleMode: "every",
    every: "1h",
    deliveryMode: "notify",
    replyChannel: "telegram",
    replyTo: "123",
    tools: "exec,read,sessions_spawn",
    useSubagents: true,
    subagentAgents: "researcher,coder",
  }, commandSettings);
  assert.equal(
    subagentCronCommand[subagentCronCommand.indexOf("--tools") + 1],
    "exec,read,sessions_spawn,agents_list,sessions_yield,subagents",
  );
  const subagentCronMessage = subagentCronCommand[subagentCronCommand.indexOf("--message") + 1];
  assert.match(subagentCronMessage, /Subagent coordination requested:/);
  assert.match(subagentCronMessage, /Advisory subagent review is required/);
  assert.match(subagentCronMessage, /Spawn at least three distinct advisory reviewers when practical/);
  assert.match(subagentCronMessage, /correctness\/safety, completeness\/user-intent, and quality\/edge-case/);
  assert.match(subagentCronMessage, /Subagents must not edit files, mutate workflow state, change configs, touch schedulers, send messages, commit code, or affect external systems/);
  assert.match(subagentCronMessage, /missing scope: operator\.write/);
  assert.match(subagentCronMessage, /native read-only advisory reviewers/);
  assert.match(subagentCronMessage, /Do not call sessions_yield after failed or unavailable spawns/);
  assert.match(subagentCronMessage, /fix every valid critique that affects correctness, safety, user intent, continuity, completeness, or quality before reporting PROGRESS or COMPLETE/);
  assert.match(subagentCronMessage, /tools\.subagents\.tools/);
  assert.match(subagentCronMessage, /researcher, coder/);
  const defaultToolsSubagentCronCommand = cronArgs({
    name: "subagent default tools",
    sessionKey: "agent:main:test",
    message: "parallel research",
    scheduleMode: "every",
    every: "1h",
    deliveryMode: "quiet",
    useSubagents: true,
  }, commandSettings);
  assert.equal(defaultToolsSubagentCronCommand.includes("--tools"), false);
  assert.match(defaultToolsSubagentCronCommand[defaultToolsSubagentCronCommand.indexOf("--message") + 1], /Subagent coordination requested:/);
  assert.match(defaultToolsSubagentCronCommand[defaultToolsSubagentCronCommand.indexOf("--message") + 1], /tools\.alsoAllow/);
  assert.match(defaultToolsSubagentCronCommand[defaultToolsSubagentCronCommand.indexOf("--message") + 1], /tools\.subagents\.tools/);
  const eventCommand = eventArgs({ sessionKey: "agent:main:test", text: "hello", timeoutMs: "bad" });
  assert.equal(eventCommand[eventCommand.indexOf("--timeout") + 1], "30000");
  const tinyAgentTimeout = agentArgs({ sessionKey: "agent:main:test", message: "hello", timeoutSeconds: 0.1 }, commandSettings);
  assert.equal(tinyAgentTimeout[tinyAgentTimeout.indexOf("--timeout") + 1], "1");
  const tinyCronTimeout = cronArgs({
    name: "test",
    sessionKey: "agent:main:test",
    message: "hello",
    scheduleMode: "every",
    every: "1h",
    deliveryMode: "quiet",
    timeoutSeconds: 0.1,
  }, commandSettings);
  assert.equal(tinyCronTimeout[tinyCronTimeout.indexOf("--timeout-seconds") + 1], "3600");
  const tinyEventTimeout = eventArgs({ sessionKey: "agent:main:test", text: "hello", timeoutMs: 0.1 });
  assert.equal(tinyEventTimeout[tinyEventTimeout.indexOf("--timeout") + 1], "1");
  const { execOpenClaw } = await import("../automator/lib/openclaw.mjs");
  const fakeCompactOpenClaw = join(stateDir, "fake-compact-openclaw.mjs");
  await writeFile(fakeCompactOpenClaw, 'process.stdout.write("abcdefghijklmnopqrst");\n', "utf8");
  const previousOpenClawBin = process.env.OPENCLAW_BIN;
  process.env.OPENCLAW_BIN = fakeCompactOpenClaw;
  try {
    const compactResult = await execOpenClaw([], { timeoutMs: 10000, stdoutMax: 0.1 });
    assert.equal(compactResult.stdout, "abc... [truncated]");
  } finally {
    if (previousOpenClawBin == null) delete process.env.OPENCLAW_BIN;
    else process.env.OPENCLAW_BIN = previousOpenClawBin;
  }

  const { writeSettings } = await import("../automator/lib/state.mjs");
  const settings = await writeSettings({ defaultTimeoutSeconds: "nope" });
  assert.equal(settings.defaultTimeoutSeconds, 600);

  const { advanceWorkflow, buildWorkflowLog, createCronWorkflow, readWorkflow, writeWorkflow } = await import("../automator/lib/workflows.mjs");
  await assert.rejects(
    createCronWorkflow({
      name: "bad workflow",
      message: "do the thing",
      sessionKey: "agent:main:test",
      scheduleMode: "every",
      every: "1h",
      workflow: { stepPlanEnabled: true, steps: [] },
    }, commandSettings),
    (error) => error.status === 400 && /step rows are required/i.test(error.message),
  );
  await writeWorkflow({ id: "wfalias", steps: [], currentIndex: 0 });
  assert.equal(await readWorkflow("wf!alias"), null);
  const routeServer = createAutomatorServer();
  const routePort = await listen(routeServer);
  try {
    assert.equal((await httpGet(routePort, "/workflows/wfalias/")).status, 200);
    assert.equal((await httpGet(routePort, "/api/workflows/wfalias/extra/events")).status, 404);
    assert.equal((await httpGet(routePort, "/workflows/wfalias/extra/events.json")).status, 404);
    assert.equal((await httpPost(routePort, "/api/workflows/wfalias/advance/job/0/complete/extra")).status, 404);
  } finally {
    await close(routeServer);
  }
  await writeWorkflow({ id: "wfempty", jobId: "job-empty", steps: [], currentIndex: 0, history: [], events: [] });
  await assert.rejects(
    advanceWorkflow("wfempty", { jobId: "job-empty", stepIndex: 0, status: "complete" }),
    (error) => error.status === 400 && /no step rows/i.test(error.message),
  );
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const originalOpenClawBin = process.env.OPENCLAW_BIN;
  const fakeHome = join(stateDir, "fake-home");
  const fakeSessionsDir = join(fakeHome, ".openclaw", "agents", "main", "sessions");
  const fakeAgentDir = join(fakeHome, ".openclaw", "agents", "main");
  const fakeEscapedAgentDir = join(fakeHome, ".openclaw", "outside-agent", "sessions");
  await mkdir(fakeSessionsDir, { recursive: true });
  await mkdir(fakeEscapedAgentDir, { recursive: true });
  await writeFile(join(fakeAgentDir, "outside.jsonl"), `${JSON.stringify({
    type: "message",
    timestamp: new Date().toISOString(),
    message: { role: "assistant", content: "SHOULD_NOT_LEAK" },
  })}\n`, "utf8");
  await writeFile(join(fakeEscapedAgentDir, "leak.jsonl"), `${JSON.stringify({
    type: "message",
    timestamp: new Date().toISOString(),
    message: { role: "assistant", content: "AGENT_ID_SHOULD_NOT_LEAK" },
  })}\n`, "utf8");
  const fakeSessionsOpenClaw = join(stateDir, "fake-sessions-openclaw.mjs");
  await writeFile(fakeSessionsOpenClaw, `
const args = process.argv.slice(2);
if (args[0] === "sessions") console.log(JSON.stringify({ sessions: [{
  agentId: "main",
  sessionId: "..\\\\outside",
  key: "agent:main:cron:job-boundary",
  kind: "cron",
  updatedAt: Date.now()
}, {
  agentId: "..\\\\outside-agent",
  sessionId: "leak",
  key: "agent:main:cron:job-boundary",
  kind: "cron",
  updatedAt: Date.now()
}] }));
else console.log(JSON.stringify({ ok: true }));
`, "utf8");
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
  process.env.OPENCLAW_BIN = fakeSessionsOpenClaw;
  try {
    const log = await buildWorkflowLog({
      id: "wfboundary",
      name: "Boundary",
      jobId: "job-boundary",
      sessionKey: "agent:main:test",
      createdAt: new Date(Date.now() - 1000).toISOString(),
      steps: [{ index: 0, name: "Step", action: "Act" }],
      currentIndex: 0,
      history: [],
      events: [],
    });
    assert.equal(log.openclaw.ok, true);
    assert.equal(log.openclaw.events.some((event) => /SHOULD_NOT_LEAK/.test(event.detail)), false);
    assert.equal(log.openclaw.events.some((event) => /AGENT_ID_SHOULD_NOT_LEAK/.test(event.detail)), false);
  } finally {
    if (originalHome == null) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile == null) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    if (originalOpenClawBin == null) delete process.env.OPENCLAW_BIN;
    else process.env.OPENCLAW_BIN = originalOpenClawBin;
  }

  const { sessionParts } = await import("../automator/lib/session-utils.mjs");
  assert.deepEqual(sessionParts(123), {
    raw: "123",
    agentId: "main",
    surface: "main",
    scope: "",
    target: "",
  });

  const { approvalTextConfirms } = await import("../automator/lib/workflow-intake.mjs");
  const approval = { code: "WF-ABC123" };
  assert.equal(approvalTextConfirms("approve workflow WF-ABC123", approval), true);
  assert.equal(approvalTextConfirms("do not approve workflow WF-ABC123", approval), false);
  assert.equal(approvalTextConfirms("no, approve workflow WF-ABC123", approval), false);
  assert.equal(approvalTextConfirms("approve workflow WF-ABC123 no changes", approval), true);

  const { workflowIntakeApprovalsPath } = await import("../automator/lib/config.mjs");
  await writeFile(workflowIntakeApprovalsPath, `${JSON.stringify({
    approvals: [{
      id: "approval-failed",
      code: "WF-FAILED",
      status: "failed",
      expiresAtMs: Date.now() + 60_000,
      sessionKey: "agent:main:dashboard:test",
      draftHash: "unused",
    }],
  })}\n`, "utf8");
  const { claimWorkflowIntakeApproval, validateWorkflowIntakeApproval } = await import("../automator/lib/workflow-intake.mjs");
  const consumed = await validateWorkflowIntakeApproval({
    approvalId: "approval-failed",
    approvalCode: "WF-FAILED",
  }, {
    draft: {
      sessionKey: "agent:main:dashboard:test",
    },
  });
  assert.equal(consumed.ok, false);
  assert.equal(consumed.mode, "approval_consumed");
  await writeFile(workflowIntakeApprovalsPath, `${JSON.stringify({
    approvals: [{
      id: "approval-pending",
      code: "WF-PENDING",
      status: "pending",
      expiresAtMs: Date.now() + 60_000,
      sessionKey: "agent:main:dashboard:test",
      draftHash: "unused",
    }],
  })}\n`, "utf8");
  const claims = await Promise.all([
    claimWorkflowIntakeApproval("approval-pending", { confirmedAt: "one" }),
    claimWorkflowIntakeApproval("approval-pending", { confirmedAt: "two" }),
  ]);
  assert.equal(claims.filter((claim) => claim.ok).length, 1);
  assert.equal(claims.filter((claim) => !claim.ok && claim.mode === "approval_consumed").length, 1);
  await writeFile(workflowIntakeApprovalsPath, `${JSON.stringify({
    approvals: [{
      id: "approval-expired",
      code: "WF-EXPIRED",
      status: "pending",
      expiresAtMs: Date.now() - 1,
      sessionKey: "agent:main:dashboard:test",
      draftHash: "hash",
    }, {
      id: "approval-drifted",
      code: "WF-DRIFT",
      status: "pending",
      expiresAtMs: Date.now() + 60_000,
      sessionKey: "agent:main:dashboard:test",
      draftHash: "old-hash",
    }],
  })}\n`, "utf8");
  const expiredClaim = await claimWorkflowIntakeApproval("approval-expired", {}, { code: "WF-EXPIRED", sessionKey: "agent:main:dashboard:test", draftHash: "hash" });
  assert.equal(expiredClaim.ok, false);
  assert.equal(expiredClaim.mode, "approval_expired");
  const driftedClaim = await claimWorkflowIntakeApproval("approval-drifted", {}, { code: "WF-DRIFT", sessionKey: "agent:main:dashboard:test", draftHash: "new-hash" });
  assert.equal(driftedClaim.ok, false);
  assert.equal(driftedClaim.reason, "draft_changed");

  const fakeOpenClaw = join(stateDir, "fake-openclaw.mjs");
  const badStatePath = join(stateDir, "state-file-not-directory");
  await writeFile(fakeOpenClaw, "console.log(JSON.stringify({ id: 'ok' }));\n", "utf8");
  await writeFile(badStatePath, "not a directory", "utf8");
  const auditIsolation = JSON.parse(execFileSync(process.execPath, [
    "--input-type=module",
    "-e",
    "const { runCommand } = await import('./automator/lib/openclaw.mjs'); const result = await runCommand('fake', ['noop'], 1000); console.log(JSON.stringify({ ok: result.ok, json: result.json }));",
  ], {
    cwd,
    env: {
      ...process.env,
      OPENCLAW_BIN: fakeOpenClaw,
      OPENCLAW_AUTOMATOR_STATE_DIR: badStatePath,
    },
    encoding: "utf8",
  }).trim().split(/\r?\n/).at(-1));
  assert.equal(auditIsolation.ok, true);
  assert.deepEqual(auditIsolation.json, { id: "ok" });
  const invalidExecOptions = JSON.parse(execFileSync(process.execPath, [
    "--input-type=module",
    "-e",
    "const { execOpenClaw } = await import('./automator/lib/openclaw.mjs'); const result = await execOpenClaw(['noop'], { timeoutMs: 'bad', stdoutMax: 'bad', stderrMax: 'bad' }); console.log(JSON.stringify({ ok: result.ok, stdout: result.stdout }));",
  ], {
    cwd,
    env: {
      ...process.env,
      OPENCLAW_BIN: fakeOpenClaw,
    },
    encoding: "utf8",
  }).trim());
  assert.equal(invalidExecOptions.ok, true);
  assert.deepEqual(JSON.parse(invalidExecOptions.stdout), { id: "ok" });

  const fakeBootstrapOpenClaw = join(stateDir, "fake-bootstrap-openclaw.mjs");
  await writeFile(fakeBootstrapOpenClaw, `
const args = process.argv.slice(2);
if (args[0] === "channels") console.log(JSON.stringify({ chat: {} }));
else if (args[0] === "sessions") console.log(JSON.stringify({ sessions: [] }));
else if (args[0] === "cron") console.log(JSON.stringify({ jobs: [] }));
else if (args[0] === "gateway" && process.env.FAKE_GATEWAY_STATUS === "failed-probe") console.log("Gateway version: 2026.6.1\\nConnectivity probe: failed");
else if (args[0] === "gateway") console.log("Gateway version: 2026.6.1");
else console.log(JSON.stringify({ ok: true }));
`, "utf8");
  process.env.OPENCLAW_BIN = fakeBootstrapOpenClaw;
  const { collectBootstrap } = await import("../automator/lib/session-bootstrap.mjs");
  process.env.FAKE_GATEWAY_STATUS = "failed-probe";
  const failedProbe = await collectBootstrap();
  assert.equal(failedProbe.checks.gateway.ok, false);
  process.env.FAKE_GATEWAY_STATUS = "version-only";
  const versionOnly = await collectBootstrap();
  assert.equal(versionOnly.checks.gateway.ok, true);
} finally {
  await rm(stateDir, { recursive: true, force: true });
}

console.log("core-hardening tests passed");

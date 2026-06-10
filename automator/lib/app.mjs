import { existsSync } from "node:fs";
import { createServer } from "node:http";

import { appVersion, defaultSettings, port, settingsPath } from "./config.mjs";
import { agentArgs, cronArgs, eventArgs } from "./commands.mjs";
import { collectBootstrap } from "./session-bootstrap.mjs";
import { displayCommand, readRuntimeSettings, runCommand } from "./openclaw.mjs";
import { ensureStateDir, readSettings, writeSettings } from "./state.mjs";
import {
  errorResponse,
  jsonResponse,
  readJsonBody,
  serveStatic,
  textResponse,
} from "./http.mjs";
import {
  buildWorkflowIntake,
  createWorkflowIntakeApproval,
  installWorkflowIntakeSkill,
  publicWorkflowIntakeApproval,
  updateWorkflowIntakeApproval,
  validateWorkflowIntakeApproval,
  workflowIntakeCreateRequestTemplate,
  workflowIntakeDocs,
  workflowIntakeSchema,
} from "./workflow-intake.mjs";
import {
  advanceWorkflow,
  buildWorkflowLog,
  createCronWorkflow,
  readWorkflow,
  workflowControllerRequested,
  workflowLogText,
} from "./workflows.mjs";

async function serveWorkflowLog(res, pathname) {
  const id = decodeURIComponent(pathname.split("/")[2] || "");
  const workflow = await readWorkflow(id);
  if (!workflow) {
    textResponse(res, 404, "Workflow not found.");
    return;
  }
  textResponse(res, 200, workflowLogText(await buildWorkflowLog(workflow)));
}

async function serveWorkflowLogJson(res, pathname) {
  const id = decodeURIComponent(pathname.split("/")[2] || "");
  const workflow = await readWorkflow(id);
  if (!workflow) {
    errorResponse(res, 404, "Workflow not found.");
    return;
  }
  jsonResponse(res, 200, await buildWorkflowLog(workflow));
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/agent-tools/workflow-intake/schema") {
    jsonResponse(res, 200, workflowIntakeSchema());
    return;
  }
  if (req.method === "POST" && pathname === "/api/agent-tools/workflow-intake/preview") {
    const settings = await readRuntimeSettings();
    const body = await readJsonBody(req);
    const intake = buildWorkflowIntake({ ...body, userConfirmed: false, confirm: false }, settings);
    const approval = intake.ready ? await createWorkflowIntakeApproval(intake) : null;
    jsonResponse(res, 200, {
      ...intake,
      approvalRequired: Boolean(approval),
      approval: publicWorkflowIntakeApproval(approval),
      createRequestTemplate: approval ? workflowIntakeCreateRequestTemplate(intake.draft, approval) : null,
    });
    return;
  }
  if (req.method === "POST" && pathname === "/api/agent-tools/workflow-intake/create") {
    const settings = await readRuntimeSettings();
    const body = await readJsonBody(req);
    const intake = buildWorkflowIntake(body, settings);
    if (intake.mode !== "ready") {
      jsonResponse(res, 200, intake);
      return;
    }
    const approval = await validateWorkflowIntakeApproval(body, intake);
    if (!approval.ok) {
      jsonResponse(res, 200, {
        ...intake,
        mode: approval.mode,
        created: false,
        approvalRequired: true,
        approval: publicWorkflowIntakeApproval(approval.approval),
        createRequestTemplate: approval.approval ? workflowIntakeCreateRequestTemplate(intake.draft, approval.approval) : null,
        approvalError: {
          reason: approval.reason,
          detail: approval.detail,
        },
      });
      return;
    }
    await updateWorkflowIntakeApproval(approval.approval.id, {
      status: "creating",
      confirmedAt: approval.confirmation.confirmedAt,
      confirmationMessageId: approval.confirmation.messageId,
    });
    const result = await createCronWorkflow(intake.draft, settings);
    await updateWorkflowIntakeApproval(approval.approval.id, {
      status: result.ok ? "used" : "failed",
      workflowId: result.workflow?.id || "",
      jobId: result.workflow?.jobId || "",
    });
    jsonResponse(res, 200, {
      ...intake,
      mode: result.ok ? "created" : "create_failed",
      created: result.ok,
      approval: {
        ...publicWorkflowIntakeApproval(approval.approval),
        confirmedAt: approval.confirmation.confirmedAt,
        confirmationMessageId: approval.confirmation.messageId,
      },
      createRequestTemplate: workflowIntakeCreateRequestTemplate(intake.draft, approval.approval),
      result,
    });
    return;
  }
  if (req.method === "GET" && pathname === "/api/health") {
    jsonResponse(res, 200, { ok: true, app: "OpenClaw Automator", version: appVersion, port });
    return;
  }
  if (req.method === "GET" && pathname === "/api/bootstrap") {
    jsonResponse(res, 200, await collectBootstrap());
    return;
  }
  if (req.method === "GET" && pathname === "/api/settings") {
    jsonResponse(res, 200, { ok: true, settings: await readSettings() });
    return;
  }
  if (req.method === "GET" && pathname.startsWith("/api/workflows/") && pathname.endsWith("/events")) {
    const id = decodeURIComponent(pathname.split("/")[3] || "");
    const workflow = await readWorkflow(id);
    if (!workflow) {
      errorResponse(res, 404, "Workflow not found.");
      return;
    }
    jsonResponse(res, 200, await buildWorkflowLog(workflow));
    return;
  }
  if (req.method === "GET" && pathname.startsWith("/api/workflows/")) {
    const parts = pathname.split("/");
    if (parts.length === 4 && parts[3]) {
      const id = decodeURIComponent(parts[3] || "");
      const workflow = await readWorkflow(id);
      if (!workflow) {
        errorResponse(res, 404, "Workflow not found.");
        return;
      }
      jsonResponse(res, 200, await buildWorkflowLog(workflow));
      return;
    }
  }
  if (req.method === "POST" && pathname === "/api/settings") {
    const body = await readJsonBody(req);
    jsonResponse(res, 200, { ok: true, settings: await writeSettings(body) });
    return;
  }
  if (req.method === "POST" && pathname === "/api/preview") {
    const settings = await readRuntimeSettings();
    const body = await readJsonBody(req);
    const kind = String(body.kind || "agent");
    const args = kind === "cron" ? cronArgs(body, settings) : kind === "event" ? eventArgs(body) : agentArgs(body, settings);
    jsonResponse(res, 200, { ok: true, kind, command: displayCommand(args), args });
    return;
  }
  if (req.method === "POST" && pathname === "/api/agent/run") {
    const settings = await readSettings();
    const body = await readJsonBody(req);
    const args = agentArgs(body, settings);
    jsonResponse(res, 200, await runCommand("agent", args, (Number(body.timeoutSeconds || settings.defaultTimeoutSeconds) + 20) * 1000));
    return;
  }
  if (req.method === "POST" && pathname === "/api/cron/create") {
    const settings = await readRuntimeSettings();
    const body = await readJsonBody(req);
    if (workflowControllerRequested(body)) {
      jsonResponse(res, 200, await createCronWorkflow(body, settings));
      return;
    }
    const args = cronArgs(body, settings);
    jsonResponse(res, 200, await runCommand("cron", args, 30000));
    return;
  }
  if (req.method === "POST" && pathname.startsWith("/api/workflows/") && pathname.includes("/advance/")) {
    const parts = pathname.split("/");
    const id = decodeURIComponent(parts[3] || "");
    const body = {
      jobId: decodeURIComponent(parts[5] || ""),
      stepIndex: Number(decodeURIComponent(parts[6] || "")),
      status: decodeURIComponent(parts[7] || ""),
    };
    jsonResponse(res, 200, await advanceWorkflow(id, body));
    return;
  }
  if (req.method === "POST" && pathname.startsWith("/api/workflows/") && pathname.endsWith("/advance")) {
    const id = decodeURIComponent(pathname.split("/")[3] || "");
    const body = await readJsonBody(req);
    jsonResponse(res, 200, await advanceWorkflow(id, body));
    return;
  }
  if (req.method === "POST" && pathname === "/api/system/event") {
    const body = await readJsonBody(req);
    const args = eventArgs(body);
    jsonResponse(res, 200, await runCommand("system-event", args, Number(body.timeoutMs || 30000) + 10000));
    return;
  }
  errorResponse(res, 404, "API route not found.");
}

function createAutomatorServer() {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || `127.0.0.1:${port}`}`);
      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url.pathname);
        return;
      }
      if (req.method === "GET" && (url.pathname === "/agent-tools/workflow-intake" || url.pathname === "/agent-tools/workflow-intake/")) {
        textResponse(res, 200, workflowIntakeDocs());
        return;
      }
      if (req.method === "GET" && url.pathname === "/agent-tools/workflow-intake.json") {
        jsonResponse(res, 200, workflowIntakeSchema());
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith("/workflows/") && url.pathname.endsWith("/events.json")) {
        await serveWorkflowLogJson(res, url.pathname);
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith("/workflows/") && (url.pathname.endsWith("/events.txt") || /^\/workflows\/[^/]+\/?$/.test(url.pathname))) {
        await serveWorkflowLog(res, url.pathname);
        return;
      }
      await serveStatic(req, res, url.pathname);
    } catch (error) {
      errorResponse(res, error.status || 500, error.message || "Unexpected server error.");
    }
  });
}

async function startServer() {
  await ensureStateDir();
  await installWorkflowIntakeSkill();
  if (!existsSync(settingsPath)) {
    await writeSettings(defaultSettings);
  }

  const server = createAutomatorServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(`OpenClaw Automator listening at http://127.0.0.1:${port}/`);
  });
  return server;
}

export {
  createAutomatorServer,
  handleApi,
  startServer,
};

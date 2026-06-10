import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const automatorRoot = fileURLToPath(new URL("..", import.meta.url));
export const appRoot = resolve(automatorRoot, "..");
export const publicDir = join(automatorRoot, "public");
export const port = Number(process.env.OPENCLAW_AUTOMATOR_PORT || 18890);
export const stateDir = process.env.OPENCLAW_AUTOMATOR_STATE_DIR
  ? resolve(process.env.OPENCLAW_AUTOMATOR_STATE_DIR)
  : join(homedir(), ".openclaw", "automator");
export const workflowsDir = join(stateDir, "workflows");
export const settingsPath = join(stateDir, "settings.json");
export const auditPath = join(stateDir, "automation-log.jsonl");
export const workflowIntakeApprovalsPath = join(stateDir, "workflow-intake-approvals.json");
export const workflowIntakeSkillSlug = "openclaw-automator-workflow-intake";
export const openclawAgentSkillsDir = join(homedir(), ".openclaw", "agents", "main", "agent", "codex-home", "skills");
export const openclawWorkspaceSkillsDir = join(homedir(), ".openclaw", "workspace", "skills");
export const defaultGatewayHttp = process.env.OPENCLAW_AUTOMATOR_GATEWAY_HTTP || "http://127.0.0.1:18789";
export const openclawCommand = process.env.OPENCLAW_BIN || (process.platform === "win32" ? "openclaw.cmd" : "openclaw");
export const openclawMjs = process.env.APPDATA ? join(process.env.APPDATA, "npm", "node_modules", "openclaw", "openclaw.mjs") : "";
export const appVersion = "0.4.20";
export const workflowIntakeApprovalTtlMs = 30 * 60 * 1000;

export const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
]);

export const defaultSettings = {
  gatewayHttp: defaultGatewayHttp,
  defaultThinking: "xhigh",
  defaultTimeoutSeconds: 600,
  defaultTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  announceReplies: true,
  replyChannel: "telegram",
  preferTelegramDirect: true,
};

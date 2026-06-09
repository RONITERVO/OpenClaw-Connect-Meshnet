const state = {
  bootstrap: null,
  sessions: [],
  jobs: [],
  selectedSession: null,
  mode: "now",
  helpMode: localStorage.getItem("openclawAutomatorHelpMode") || "simple",
  helpTimer: null,
  helpPendingTarget: null,
  helpVisibleTarget: null,
  safetyBlocks: false,
};

const $ = (id) => document.getElementById(id);

const els = {
  statusLine: $("statusLine"),
  helpSimpleBtn: $("helpSimpleBtn"),
  helpDetailedBtn: $("helpDetailedBtn"),
  cronLink: $("cronLink"),
  helpBubble: $("helpBubble"),
  helpCloseBtn: $("helpCloseBtn"),
  helpBubbleTitle: $("helpBubbleTitle"),
  helpBubbleText: $("helpBubbleText"),
  refreshBtn: $("refreshBtn"),
  gatewayLink: $("gatewayLink"),
  sessionCount: $("sessionCount"),
  sessionSearch: $("sessionSearch"),
  sessionList: $("sessionList"),
  selectedBadge: $("selectedBadge"),
  composerTitle: $("composerTitle"),
  presetRow: $("presetRow"),
  messageInput: $("messageInput"),
  safetyPanel: $("safetyPanel"),
  safetySummary: $("safetySummary"),
  safetyList: $("safetyList"),
  scheduleSummary: $("scheduleSummary"),
  deliverySummary: $("deliverySummary"),
  deliveryModeInput: $("deliveryModeInput"),
  scheduleMode: $("scheduleMode"),
  atInput: $("atInput"),
  everyInput: $("everyInput"),
  cronInput: $("cronInput"),
  timezoneInput: $("timezoneInput"),
  deliverToggle: $("deliverToggle"),
  enabledToggle: $("enabledToggle"),
  expectFinalToggle: $("expectFinalToggle"),
  lightContextToggle: $("lightContextToggle"),
  deleteAfterRunToggle: $("deleteAfterRunToggle"),
  exactTimingToggle: $("exactTimingToggle"),
  bestEffortDeliveryToggle: $("bestEffortDeliveryToggle"),
  workflowSummary: $("workflowSummary"),
  workflowAdaptiveToggle: $("workflowAdaptiveToggle"),
  workflowNameInput: $("workflowNameInput"),
  workflowStepInput: $("workflowStepInput"),
  workflowNextInput: $("workflowNextInput"),
  workflowDoneInput: $("workflowDoneInput"),
  workflowNoteInput: $("workflowNoteInput"),
  jobNameInput: $("jobNameInput"),
  descriptionInput: $("descriptionInput"),
  sessionKeyInput: $("sessionKeyInput"),
  replyChannelInput: $("replyChannelInput"),
  replyToInput: $("replyToInput"),
  webhookInput: $("webhookInput"),
  agentInput: $("agentInput"),
  modelInput: $("modelInput"),
  thinkingInput: $("thinkingInput"),
  timeoutInput: $("timeoutInput"),
  toolsInput: $("toolsInput"),
  staggerInput: $("staggerInput"),
  wakeInput: $("wakeInput"),
  jobModeInput: $("jobModeInput"),
  sessionTargetInput: $("sessionTargetInput"),
  commandPreview: $("commandPreview"),
  primaryAction: $("primaryAction"),
  previewBtn: $("previewBtn"),
  resultBox: $("resultBox"),
  jobsList: $("jobsList"),
  jobCount: $("jobCount"),
  checkList: $("checkList"),
  backendBadge: $("backendBadge"),
};

const schedulePresets = {
  now: { mode: "now", label: "Now", action: "Run once immediately" },
  in30: { mode: "at", at: "+30m", label: "In 30 min", action: "Create one reminder" },
  hourly: { mode: "every", every: "1h", label: "Hourly", action: "Repeat every hour" },
  every2h: { mode: "every", every: "2h", label: "Every 2h", action: "Repeat every two hours" },
  morning: { mode: "cron", cron: "0 9 * * *", label: "Morning", action: "Run daily at 09:00" },
  weekdays: { mode: "cron", cron: "0 9 * * 1-5", label: "Weekdays", action: "Run weekdays at 09:00" },
};

const deliveryPresets = {
  notify: {
    label: "Message me",
    summary: "Answer returns to selected chat",
  },
  webhook: {
    label: "Webhook",
    summary: "POST result to URL",
  },
  quiet: {
    label: "Quiet run",
    summary: "No fallback delivery",
  },
};

const helpCatalog = {
  helpSimple: {
    title: "Simple labels",
    simple: "Use short explanations.",
    detailed: "Shows plain-language labels for users who want the app to choose sensible defaults and avoid command details.",
  },
  helpDetailed: {
    title: "Detailed labels",
    simple: "Use careful explanations.",
    detailed: "Shows implementation-oriented labels: exact OpenClaw command effects, routing, delivery, scheduling, timeouts, and side effects before execution.",
  },
  refresh: {
    title: "Refresh",
    simple: "Ask the app to look again for chats, jobs, and Gateway health.",
    detailed: "Runs the local backend bootstrap again. The backend calls OpenClaw session, cron, and gateway status commands, then rebuilds this page state without sending an agent message.",
  },
  gateway: {
    title: "Open Gateway",
    simple: "Open the main OpenClaw page.",
    detailed: "Opens the configured Gateway web UI, usually http://127.0.0.1:18789/. This does not run a command; it just opens the OpenClaw control page in a new tab.",
  },
  gatewayCron: {
    title: "Open Cron",
    simple: "Open OpenClaw's full cron page.",
    detailed: "Opens the Gateway cron screen at /cron. Use it when you want OpenClaw's native editor; this app keeps the common cron flow simpler and avoids manual session id entry.",
  },
  modeNow: {
    title: "Tell agent",
    simple: "Send the message now.",
    detailed: "Builds an openclaw agent command using the selected session key. If delivery is enabled, it also adds reply-channel and reply-to so the final answer can go back to the chat.",
  },
  modeLater: {
    title: "Remind me",
    simple: "Tell the agent later one time.",
    detailed: "Switches to a one-shot cron job using --at. Relative times like +30m are passed to openclaw cron add and can be deleted after a successful run.",
  },
  modeDaily: {
    title: "Repeat",
    simple: "Ask the agent again and again.",
    detailed: "Switches to the Every 2h preset. The backend creates an isolated OpenClaw cron agent-turn job with --every 2h unless you choose a different schedule.",
  },
  modeAdvanced: {
    title: "Fine tune",
    simple: "Show the extra controls.",
    detailed: "Opens the full command surface: schedule fields, job name, enabled state, session key override, reply routing, cron session target, agent/model override, timeout, tool allow-list, wake mode, delivery mode, stagger, and system-event mode. It also switches help labels to Detailed.",
  },
  sessionSearch: {
    title: "Find chat",
    simple: "Type part of a chat name to find it.",
    detailed: "Filters the locally loaded session list by label, session key, and subtitle. It does not query OpenClaw until you press Refresh.",
  },
  sessionList: {
    title: "Chats",
    simple: "Pick where the message should go.",
    detailed: "These are OpenClaw session keys from openclaw sessions --all-agents --json --limit all. Selecting one controls the --session-key used by agent, cron, or system-event commands.",
  },
  sessionCard: {
    title: "Chat",
    simple: "This is one place the agent can remember and answer.",
    detailed: "Selecting this session writes its exact key into Advanced settings. Telegram direct sessions usually include a reply target, so delivery can be prefilled.",
  },
  selectedBadge: {
    title: "Selected chat",
    simple: "This is where your message will go.",
    detailed: "This label mirrors the selected session key. The generated command uses that key unless you override Session key in Advanced settings.",
  },
  preset: {
    title: "Shortcut",
    simple: "Fill the message box with a useful starter.",
    detailed: "Applies a local UI preset only. It changes fields in the form; it does not create a job or send anything until you press Run now or Create job.",
  },
  messageLabel: {
    title: "Message",
    simple: "Write what you want the agent to do.",
    detailed: "This becomes --message for agent and cron jobs, or --text for system events. It is sent to the selected session when you run or schedule the flow.",
  },
  message: {
    title: "Message",
    simple: "Write the words the agent should read.",
    detailed: "The backend passes this text as a single command argument, not shell text. It is still the actual prompt content the agent receives.",
  },
  when: {
    title: "When",
    simple: "Choose now, later, repeating, or system event.",
    detailed: "Now calls openclaw agent. Once later, Repeat, and Cron call openclaw cron add. System event calls openclaw system event.",
  },
  schedulePresets: {
    title: "When",
    simple: "Pick when this should run.",
    detailed: "These buttons fill the underlying OpenClaw cron controls for you. They set --at, --every, or --cron without requiring you to type schedule syntax.",
  },
  schedulePreset: {
    title: "Schedule choice",
    simple: "Use this timing.",
    detailed: "This is a safe preset over the Advanced schedule fields. You can still open Advanced to inspect or edit the exact --at, --every, or --cron value.",
  },
  runAt: {
    title: "Run at",
    simple: "Pick when it should happen one time.",
    detailed: "Passed to openclaw cron add --at. Supports OpenClaw's time parser, including relative values like +30m and ISO datetimes; timezone is used for offset-less datetimes.",
  },
  every: {
    title: "Every",
    simple: "Repeat after this much time.",
    detailed: "Passed to openclaw cron add --every. Examples: 10m, 1h, 2h, 1d. This creates a persistent repeating job.",
  },
  cron: {
    title: "Cron",
    simple: "A clock rule for advanced schedules.",
    detailed: "Passed to openclaw cron add --cron. Uses 5-field or 6-field cron expressions. Example: 0 9 * * * means every day at 09:00 in the selected timezone.",
  },
  timezone: {
    title: "Timezone",
    simple: "Which clock the schedule should use.",
    detailed: "Passed as --tz for cron and one-shot jobs. Use an IANA timezone like Europe/Helsinki so scheduled times do not drift when the PC or user moves.",
  },
  deliver: {
    title: "Send answer back",
    simple: "Let the answer come back to Telegram.",
    detailed: "For immediate runs, adds --deliver plus reply-channel and reply-to. For scheduled jobs, Message me adds --announce and delivery target flags; Quiet run adds --no-deliver.",
  },
  enabled: {
    title: "Enabled",
    simple: "Let the saved job run.",
    detailed: "When off, cron creation adds --disabled. Disabled jobs are saved and visible in the Gateway cron page but will not run until enabled.",
  },
  deliveryPresets: {
    title: "Answer",
    simple: "Choose whether the result should message you.",
    detailed: "Message me sends the final answer back to the selected chat. Webhook adds --webhook for scheduled jobs. Quiet run explicitly uses --no-deliver so isolated jobs do not fall back to announcing unexpectedly.",
  },
  deliveryPreset: {
    title: "Answer choice",
    simple: "Choose how visible the result should be.",
    detailed: "Message me maps to --deliver for Ask now and --announce for cron. Webhook maps to --webhook for cron jobs. Quiet run leaves immediate runs local and adds --no-deliver for cron jobs.",
  },
  expectFinal: {
    title: "Wait for answer",
    simple: "Wait until the agent finishes.",
    detailed: "Adds --expect-final for cron jobs. This makes the job runner wait for a final agent response instead of only starting the work.",
  },
  lightContext: {
    title: "Light context",
    simple: "Start with less extra memory.",
    detailed: "Adds --light-context to cron jobs. Use it for small reminders when you do not want a heavy context bootstrap.",
  },
  workflowState: {
    title: "Workflow state",
    simple: "Tell each scheduled run exactly where the work is.",
    detailed: "Builds a compact state block into scheduled agent prompts. This helps a cron run act like you gave it a specific current-step instruction, instead of making it rediscover progress by reading large workflow-state files or searching old context.",
  },
  workflowAdaptive: {
    title: "Adaptive cron prompt",
    simple: "Add the workflow fields to scheduled prompts.",
    detailed: "When enabled, cron/once-later/repeat jobs append a small source-of-truth block to --message. Ask Now and system events stay as the plain message.",
  },
  workflowName: {
    title: "Workflow",
    simple: "Name the larger task.",
    detailed: "Included in the adaptive state block as the workflow label. Use something stable like PR review, long build, or invoice follow-up.",
  },
  workflowStep: {
    title: "Current step",
    simple: "What part is happening now.",
    detailed: "Included as the current step the next scheduled run should trust. This reduces wasted time figuring out the next exact step from broad context.",
  },
  workflowNext: {
    title: "Next action",
    simple: "What the next run should do first.",
    detailed: "Included as the first action for the next scheduled run. The prompt tells the agent to do this before broad research unless the action itself requires verification.",
  },
  workflowDone: {
    title: "Done when",
    simple: "How the agent knows to stop.",
    detailed: "Included as the completion rule for the workflow. This helps repeated jobs avoid looping after the useful work is finished.",
  },
  workflowNote: {
    title: "State note",
    simple: "Small facts the next run should trust.",
    detailed: "Included as concise state. Keep it short: paths, branch names, PR links, last verified result, or the exact blocker. Do not paste large logs or long workflow files here.",
  },
  deleteAfterRun: {
    title: "Delete after run",
    simple: "Clean up one-time reminders after they finish.",
    detailed: "For --at jobs, checked adds --delete-after-run. Unchecked adds --keep-after-run so the one-shot job stays visible after it succeeds.",
  },
  exactTiming: {
    title: "Exact cron time",
    simple: "Do not spread this cron job out.",
    detailed: "Adds --exact for cron-expression jobs, disabling the default stagger window.",
  },
  bestEffortDelivery: {
    title: "Best-effort delivery",
    simple: "Do not fail the whole job if sending the result fails.",
    detailed: "Adds --best-effort-deliver when delivery is Message me or Webhook. Useful when the task matters more than the final notification.",
  },
  advancedSummary: {
    title: "Advanced settings",
    simple: "Extra controls live here.",
    detailed: "These fields map directly to OpenClaw CLI flags. They are for users who want to verify routing, delivery, model, timeout, tool access, wake behavior, and saved-job behavior before execution.",
  },
  advancedSchedule: {
    title: "Advanced schedule",
    simple: "Exact timing fields.",
    detailed: "These are the exact underlying schedule fields used by the preset buttons. Editing them updates the command preview.",
  },
  sessionKey: {
    title: "Session key override",
    simple: "Usually leave this alone.",
    detailed: "Used as --session-key. The normal path fills it by selecting a chat card, so you should not need to type ids manually. Override only when routing to a session not shown in the list.",
  },
  jobName: {
    title: "Job name",
    simple: "A readable name for the saved schedule.",
    detailed: "Passed as --name for cron jobs. Leave empty to generate a name from the selected chat.",
  },
  description: {
    title: "Description",
    simple: "Optional note for the saved job.",
    detailed: "Passed as --description for cron jobs. This is metadata for you and the Gateway cron page, not the prompt the agent reads.",
  },
  sessionTarget: {
    title: "Cron session",
    simple: "Where scheduled agent work runs.",
    detailed: "Passed as cron --session. isolated runs a dedicated agent turn. main posts to the main timeline and is the natural target for system-event jobs.",
  },
  replyChannel: {
    title: "Reply channel",
    simple: "Where the answer should be sent.",
    detailed: "Used as --reply-channel for immediate runs and --channel for cron delivery. For your setup this is usually telegram.",
  },
  replyTo: {
    title: "Reply to",
    simple: "Who receives the answer.",
    detailed: "Used as --reply-to for immediate runs and --to for scheduled delivery. For Telegram direct chats this is the Telegram chat/user id.",
  },
  webhook: {
    title: "Webhook URL",
    simple: "Where webhook results should be sent.",
    detailed: "Required when Answer is Webhook. Scheduled jobs add --webhook with this URL and OpenClaw POSTs the finished payload there.",
  },
  agent: {
    title: "Agent ID",
    simple: "Choose a specific OpenClaw agent.",
    detailed: "Passed as --agent for immediate runs and cron jobs. Leave empty to use OpenClaw routing/default agent behavior.",
  },
  model: {
    title: "Model override",
    simple: "Choose a specific model for this run.",
    detailed: "Passed as --model for immediate runs and agent cron jobs. Leave empty to use OpenClaw's configured model.",
  },
  thinking: {
    title: "Thinking",
    simple: "How hard the agent should think.",
    detailed: "Adds --thinking. xhigh spends more reasoning budget and is slower/costlier; lower values are faster for simple reminders.",
  },
  timeout: {
    title: "Timeout",
    simple: "How long the app waits before giving up.",
    detailed: "Immediate runs pass --timeout seconds. Cron jobs pass --timeout-seconds. This limits how long the OpenClaw command may run before the app treats it as failed.",
  },
  tools: {
    title: "Tools",
    simple: "Limit what the agent can use.",
    detailed: "Passed to cron jobs as --tools. Use comma-separated tool names like exec,read,write. Leave empty for OpenClaw defaults.",
  },
  stagger: {
    title: "Stagger",
    simple: "Spread cron runs by a small window.",
    detailed: "Passed as --stagger for cron-expression jobs. Examples: 30s or 5m. Leave empty for OpenClaw's default behavior.",
  },
  wake: {
    title: "Wake",
    simple: "Choose when a scheduled job wakes the agent.",
    detailed: "Passed as --wake for cron jobs. now runs at job time; next-heartbeat defers work to the next heartbeat window.",
  },
  jobMode: {
    title: "Job mode",
    simple: "Choose normal message or system note.",
    detailed: "Agent message uses --message and creates a normal agent turn. System event uses --system-event and is treated more like an internal event than a user chat prompt.",
  },
  commandPreview: {
    title: "Command preview",
    simple: "This shows what the app will do.",
    detailed: "This is the exact OpenClaw CLI command shape the backend will execute. The backend uses argument arrays, so this preview is for review, not shell execution.",
  },
  safetyPanel: {
    title: "Safety check",
    simple: "The app checks where the agent reads and where the answer goes.",
    detailed: "Compares --session-key context, cron --session mode, delivery mode, reply target, webhook URL, selected chat, and advanced overrides. It warns even when the routing can be intentional, because silent context/reply mismatches are easy to miss.",
  },
  primaryAction: {
    title: "Run or create",
    simple: "Press this when you are ready.",
    detailed: "Runs the backend endpoint for the selected flow. Now/System event execute immediately. Later/Repeat/Cron create OpenClaw cron jobs.",
  },
  previewAction: {
    title: "Preview command",
    simple: "Check the plan without doing it.",
    detailed: "Calls /api/preview only. It validates fields and returns the command arguments without sending a message or creating a cron job.",
  },
  result: {
    title: "Result",
    simple: "The app puts answers and errors here.",
    detailed: "Shows the backend response, including command preview, stdout, stderr, parsed JSON when available, exit code, and duration.",
  },
  jobs: {
    title: "Jobs",
    simple: "Scheduled things show up here.",
    detailed: "Loaded from openclaw cron list --json. This panel is read-only in this version; edit or remove jobs with OpenClaw CLI if needed.",
  },
  jobRow: {
    title: "Job",
    simple: "This is one saved schedule.",
    detailed: "A cron job reported by OpenClaw. It may run an agent message, system event, webhook, or delivery flow depending on its stored config.",
  },
  backend: {
    title: "Backend",
    simple: "Green means the helper can talk to OpenClaw.",
    detailed: "Shows local backend checks for sessions, cron, and Gateway status. Failures here usually mean OpenClaw is stopped, unreachable, or not on PATH.",
  },
  checkRow: {
    title: "Check",
    simple: "This tells whether one part is working.",
    detailed: "Each row is a backend collector result. Sessions and cron use OpenClaw CLI commands; Gateway uses openclaw gateway status text.",
  },
};

const docsLinks = {
  "--agent": "https://docs.openclaw.ai/cli/agent#:~:text=--agent%20%3Cid%3E%3A%20agent%20id",
  "--announce": "https://docs.openclaw.ai/cli/cron#:~:text=--announce%20is%20runner%20fallback%20delivery",
  "--at": "https://docs.openclaw.ai/cli/cron#:~:text=--at%20%3Cdatetime%3E%20schedules%20a%20one-shot%20run",
  "--best-effort-deliver": "https://docs.openclaw.ai/cli/cron",
  "--channel": "https://docs.openclaw.ai/cli/cron#:~:text=Announce%20to%20a%20specific%20channel",
  "--cron": "https://docs.openclaw.ai/cli/cron#scheduling",
  "--delete-after-run": "https://docs.openclaw.ai/cli/cron",
  "--description": "https://docs.openclaw.ai/cli/cron",
  "--disabled": "https://docs.openclaw.ai/cli/cron",
  "--deliver": "https://docs.openclaw.ai/cli/agent#:~:text=--deliver%3A%20send%20the%20reply%20back%20to%20the%20selected%20channel%2Ftarget",
  "--every": "https://docs.openclaw.ai/cli/cron#scheduling",
  "--exact": "https://docs.openclaw.ai/cli/cron",
  "--expect-final": "https://docs.openclaw.ai/cli/system#:~:text=--expect-final",
  "--keep-after-run": "https://docs.openclaw.ai/cli/cron",
  "--json": "https://docs.openclaw.ai/cli/agent#:~:text=--json%3A%20output%20JSON",
  "--light-context": "https://docs.openclaw.ai/cli/cron#:~:text=--light-context%20applies%20to%20isolated%20agent-turn%20jobs%20only",
  "--message": "https://docs.openclaw.ai/cli/agent#:~:text=-m%2C%20--message%20%3Ctext%3E%3A%20required%20message%20body",
  "--model": "https://docs.openclaw.ai/cli/agent#:~:text=--model",
  "--mode": "https://docs.openclaw.ai/cli/system#:~:text=--mode%20%3Cmode%3E%3A%20now%20or%20next-heartbeat",
  "--no-deliver": "https://docs.openclaw.ai/cli/cron#:~:text=--no-deliver%20disables%20that%20fallback",
  "--reply-account": "https://docs.openclaw.ai/cli/agent#:~:text=--reply-account%20%3Cid%3E%3A%20delivery%20account%20override",
  "--reply-channel": "https://docs.openclaw.ai/cli/agent#:~:text=--reply-channel%20%3Cchannel%3E%3A%20delivery%20channel%20override",
  "--reply-to": "https://docs.openclaw.ai/cli/agent#:~:text=--reply-to%20%3Ctarget%3E%3A%20delivery%20target%20override",
  "--session": "https://docs.openclaw.ai/cli/cron#sessions",
  "--session-id": "https://docs.openclaw.ai/cli/agent#:~:text=--session-id%20%3Cid%3E%3A%20explicit%20session%20id",
  "--session-key": "https://docs.openclaw.ai/cli/agent#:~:text=--session-key%20%3Ckey%3E%3A%20explicit%20session%20key",
  "--system-event": "https://docs.openclaw.ai/cli/cron#:~:text=--system-event",
  "--stagger": "https://docs.openclaw.ai/cli/cron",
  "--text": "https://docs.openclaw.ai/cli/system#:~:text=--text%20%3Ctext%3E%3A%20required%20system%20event%20text",
  "--thinking": "https://docs.openclaw.ai/cli/agent#:~:text=--thinking%20%3Clevel%3E%3A%20agent%20thinking%20level",
  "--timeout": "https://docs.openclaw.ai/cli/agent#:~:text=--timeout%20%3Cseconds%3E%3A%20override%20agent%20timeout",
  "--timeout-seconds": "https://docs.openclaw.ai/cli/cron",
  "--to": "https://docs.openclaw.ai/cli/cron#:~:text=Announce%20to%20a%20specific%20channel",
  "--tools": "https://docs.openclaw.ai/cli/cron",
  "--tz": "https://docs.openclaw.ai/cli/cron#:~:text=--tz%20%3Ciana%3E",
  "--wake": "https://docs.openclaw.ai/cli/cron",
  "--webhook": "https://docs.openclaw.ai/cli/cron#:~:text=Use%20--webhook%20%3Curl%3E",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shortKey(key) {
  if (!key) return "";
  if (key.length <= 40) return key;
  return `${key.slice(0, 22)}...${key.slice(-12)}`;
}

function parseSessionKey(key = "") {
  const parts = String(key).split(":");
  return {
    raw: String(key || ""),
    agentId: parts[1] || "main",
    surface: parts[2] || "main",
    scope: parts[3] || "",
    target: parts.slice(4).join(":"),
  };
}

function sessionLabelFromKey(key = "") {
  const session = state.sessions.find((item) => item.key === key);
  if (session?.label) return session.label;
  const parts = parseSessionKey(key);
  if (!key) return "no chat";
  if (parts.surface === "telegram" && parts.scope === "direct") return `Telegram ${parts.target}`;
  if (parts.surface === "telegram" && parts.scope === "group") return `Telegram group ${parts.target}`;
  if (parts.surface === "main" && parts.scope === "heartbeat") return "Heartbeat";
  if (parts.surface === "main") return "OpenClaw web chat";
  return shortKey(key);
}

function deliveryLabel(payload) {
  if (payload.deliveryMode === "webhook") return payload.webhook ? `Webhook ${payload.webhook}` : "Webhook URL missing";
  if (payload.deliveryMode === "quiet") return "nowhere; quiet run";
  const channel = payload.replyChannel || payload.channel || "selected channel";
  const to = payload.replyTo || payload.to || "";
  return to ? `${channel} ${to}` : `${channel}, but no recipient filled`;
}

function selectedDeliveryMatchesContext(payload, contextParts) {
  if (payload.deliveryMode !== "notify") return false;
  if (contextParts.surface !== "telegram") return false;
  const to = payload.replyTo || payload.to || "";
  return Boolean(to && contextParts.target && to === contextParts.target);
}

function workflowFields() {
  return {
    enabled: Boolean(els.workflowAdaptiveToggle?.checked),
    name: els.workflowNameInput.value.trim(),
    step: els.workflowStepInput.value.trim(),
    next: els.workflowNextInput.value.trim(),
    done: els.workflowDoneInput.value.trim(),
    note: els.workflowNoteInput.value.trim(),
  };
}

function workflowHasState(fields = workflowFields()) {
  return Boolean(fields.name || fields.step || fields.next || fields.done || fields.note);
}

function shouldAttachWorkflowState(scheduleMode, jobMode) {
  if (!els.workflowAdaptiveToggle.checked) return false;
  if (jobMode === "system-event") return false;
  if (scheduleMode === "now" || scheduleMode === "event") return false;
  return workflowHasState();
}

function workflowStateBlock(fields = workflowFields()) {
  const rows = [
    ["Workflow", fields.name],
    ["Current step", fields.step],
    ["Next action", fields.next],
    ["Done when", fields.done],
    ["State note", fields.note],
  ].filter(([, value]) => value);
  if (!rows.length) return "";
  return [
    "",
    "Workflow state for this scheduled run:",
    ...rows.map(([label, value]) => `- ${label}: ${value}`),
    "- Operating rule: Treat this compact block as the current workflow state for this run. Do the next action first. Do not spend the run rediscovering the step from large workflow-state files or old context unless this message explicitly asks you to verify something.",
  ].join("\n");
}

function effectiveMessageText(scheduleMode, jobMode) {
  const base = els.messageInput.value.trim();
  if (!base) return "";
  if (!shouldAttachWorkflowState(scheduleMode, jobMode)) return base;
  return `${base}${workflowStateBlock()}`;
}

function updateWorkflowSummary() {
  const fields = workflowFields();
  if (!fields.enabled) {
    els.workflowSummary.textContent = "Off";
  } else if (!workflowHasState(fields)) {
    els.workflowSummary.textContent = "Message only";
  } else {
    const count = [fields.name, fields.step, fields.next, fields.done, fields.note].filter(Boolean).length;
    els.workflowSummary.textContent = `${count} state fields`;
  }
}

function helpTextFor(element) {
  const key = element?.dataset?.helpKey;
  const entry = key ? helpCatalog[key] : null;
  const simple = element?.dataset?.helpSimple || entry?.simple || "";
  const detailed = element?.dataset?.helpDetailed || entry?.detailed || simple;
  const title = element?.dataset?.helpTitle || entry?.title || "Help";
  return {
    title,
    text: state.helpMode === "detailed" ? detailed : simple,
  };
}

function renderLinkedHelp(container, text) {
  container.replaceChildren();
  const pattern = /--[a-z][a-z0-9-]*/gi;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const flag = match[0];
    const index = match.index ?? 0;
    if (index > cursor) {
      container.append(document.createTextNode(text.slice(cursor, index)));
    }
    const href = docsLinks[flag];
    if (href) {
      const link = document.createElement("a");
      link.href = href;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = flag;
      link.title = `Open OpenClaw docs for ${flag}`;
      container.append(link);
    } else {
      container.append(document.createTextNode(flag));
    }
    cursor = index + flag.length;
  }
  if (cursor < text.length) {
    container.append(document.createTextNode(text.slice(cursor)));
  }
}

function positionHelpBubble(target) {
  const rect = target.getBoundingClientRect();
  const bubble = els.helpBubble;
  const margin = 12;
  const maxLeft = window.innerWidth - bubble.offsetWidth - margin;
  let left = Math.min(Math.max(rect.left, margin), Math.max(margin, maxLeft));
  let top = rect.bottom + margin;
  if (top + bubble.offsetHeight > window.innerHeight - margin) {
    top = rect.top - bubble.offsetHeight - margin;
  }
  if (top < margin) top = margin;
  bubble.style.left = `${left}px`;
  bubble.style.top = `${top}px`;
}

function showHelp(target) {
  const help = helpTextFor(target);
  if (!help.text) return;
  clearTimeout(state.helpTimer);
  state.helpTimer = null;
  state.helpPendingTarget = null;
  state.helpVisibleTarget = target;
  els.helpBubbleTitle.textContent = help.title;
  renderLinkedHelp(els.helpBubbleText, help.text);
  els.helpBubble.hidden = false;
  positionHelpBubble(target);
}

function hideHelp() {
  clearTimeout(state.helpTimer);
  state.helpTimer = null;
  state.helpPendingTarget = null;
  state.helpVisibleTarget = null;
  els.helpBubble.hidden = true;
}

function queueHelp(target, delayMs = 5000) {
  if (target === state.helpPendingTarget || target === state.helpVisibleTarget) return;
  clearTimeout(state.helpTimer);
  state.helpTimer = null;
  if (!helpTextFor(target).text) return;
  state.helpPendingTarget = target;
  state.helpTimer = setTimeout(() => {
    if (state.helpPendingTarget === target) showHelp(target);
  }, delayMs);
}

function cancelQueuedHelp(target) {
  if (target && state.helpPendingTarget !== target) return;
  clearTimeout(state.helpTimer);
  state.helpTimer = null;
  state.helpPendingTarget = null;
}

function refreshVisibleHelpPosition() {
  if (els.helpBubble.hidden || !state.helpVisibleTarget) return;
  if (!document.body.contains(state.helpVisibleTarget)) {
    hideHelp();
    return;
  }
  positionHelpBubble(state.helpVisibleTarget);
}

function setHelpMode(mode) {
  state.helpMode = mode === "detailed" ? "detailed" : "simple";
  localStorage.setItem("openclawAutomatorHelpMode", state.helpMode);
  document.body.dataset.helpMode = state.helpMode;
  els.helpSimpleBtn.classList.toggle("active", state.helpMode === "simple");
  els.helpDetailedBtn.classList.toggle("active", state.helpMode === "detailed");
  hideHelp();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body,
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

function setResult(payload, isError = false) {
  els.resultBox.hidden = false;
  els.resultBox.classList.toggle("error", isError);
  els.resultBox.textContent = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
}

function selectedSessionKey() {
  return els.sessionKeyInput.value.trim() || state.selectedSession?.key || "";
}

function applySession(session) {
  state.selectedSession = session;
  els.selectedBadge.textContent = session ? session.label : "No chat";
  els.sessionKeyInput.value = session?.key || "";
  els.replyChannelInput.value = session?.delivery?.channel || "telegram";
  els.replyToInput.value = session?.delivery?.to || "";
  if (!session?.delivery?.available && els.deliveryModeInput.value === "notify") {
    setDeliveryMode("quiet");
  } else {
    els.deliverToggle.checked = els.deliveryModeInput.value === "notify";
  }
  renderSessions();
  updatePreview();
}

function renderSessions() {
  const term = els.sessionSearch.value.trim().toLowerCase();
  const sessions = state.sessions.filter((session) => {
    const haystack = `${session.label} ${session.key} ${session.subtitle}`.toLowerCase();
    return !term || haystack.includes(term);
  });
  els.sessionCount.textContent = String(state.sessions.length);
  els.sessionList.innerHTML = sessions.map((session) => {
    const selected = session.key === state.selectedSession?.key ? "selected" : "";
    const delivery = session.delivery?.available ? "reply ready" : "local only";
    const simpleHelp = `${session.label}: choose this chat if this is where the agent should listen.`;
    const detailedHelp = `${session.label}. Session key: ${session.key}. Delivery: ${delivery}. Selecting it sets --session-key and prefills reply routing when OpenClaw exposes a target.`;
    return `
      <button class="session-card ${selected}" data-session-key="${escapeHtml(session.key)}" data-help-key="sessionCard" data-help-title="${escapeHtml(session.label)}" data-help-simple="${escapeHtml(simpleHelp)}" data-help-detailed="${escapeHtml(detailedHelp)}">
        <strong>${escapeHtml(session.label)}</strong>
        <span>${escapeHtml(session.subtitle)}</span>
        <small>${escapeHtml(delivery)} / ${escapeHtml(shortKey(session.key))}</small>
      </button>
    `;
  }).join("") || `<div class="empty">No sessions found</div>`;
}

function renderPresets() {
  const presets = state.bootstrap?.presets || [];
  els.presetRow.innerHTML = presets.map((preset) => `
    <button class="preset" data-preset="${escapeHtml(preset.id)}" data-help-key="preset">${escapeHtml(preset.title)}</button>
  `).join("");
}

function jobScheduleLabel(job) {
  const schedule = job.schedule || {};
  if (typeof schedule === "string") return schedule;
  if (schedule.kind === "cron") return `Cron ${schedule.expr || ""}`.trim();
  if (schedule.kind === "every") return `Every ${schedule.every || schedule.interval || ""}`.trim();
  if (schedule.kind === "at") return `At ${schedule.at || schedule.when || ""}`.trim();
  return job.cron || job.every || job.nextRunAt || "scheduled";
}

function renderJobs() {
  els.jobCount.textContent = String(state.jobs.length);
  els.jobsList.innerHTML = state.jobs.map((job) => `
    <div class="job-row" data-help-key="jobRow">
      <strong>${escapeHtml(job.name || job.id || "OpenClaw job")}</strong>
      <span>${escapeHtml(jobScheduleLabel(job))}</span>
      <small>${escapeHtml([job.status, job.delivery?.mode, job.sessionTarget, job.wakeMode].filter(Boolean).join(" / "))}</small>
    </div>
  `).join("") || `<div class="empty">No cron jobs yet</div>`;
}

function renderChecks() {
  const checks = state.bootstrap?.checks || {};
  const rows = Object.entries(checks).map(([name, value]) => `
    <div class="check-row ${value.ok ? "ok" : "bad"}" data-help-key="checkRow">
      <span>${escapeHtml(name)}</span>
      <strong>${value.ok ? "ok" : "check"}</strong>
    </div>
  `);
  els.checkList.innerHTML = rows.join("");
}

function currentSchedulePresetId() {
  const mode = els.scheduleMode.value;
  return Object.entries(schedulePresets).find(([, preset]) => {
    if (preset.mode !== mode) return false;
    if (mode === "at") return (preset.at || "") === els.atInput.value.trim();
    if (mode === "every") return (preset.every || "") === els.everyInput.value.trim();
    if (mode === "cron") return (preset.cron || "") === els.cronInput.value.trim();
    return true;
  })?.[0] || "";
}

function scheduleSummary() {
  const preset = schedulePresets[currentSchedulePresetId()];
  if (preset) return preset.label;
  const mode = els.scheduleMode.value;
  if (mode === "at") return `Once: ${els.atInput.value.trim() || "unset"}`;
  if (mode === "every") return `Every ${els.everyInput.value.trim() || "unset"}`;
  if (mode === "cron") return `Cron ${els.cronInput.value.trim() || "unset"}`;
  if (mode === "event") return "System event";
  return "Now";
}

function modeForScheduleMode(mode) {
  if (mode === "at") return "later";
  if (mode === "every" || mode === "cron") return "daily";
  if (mode === "event") return "advanced";
  return "now";
}

function setActiveModeTile(mode) {
  state.mode = mode;
  document.querySelectorAll(".mode-tile").forEach((tile) => {
    tile.classList.toggle("active", tile.dataset.mode === mode);
  });
}

function setSchedulePreset(id) {
  const preset = schedulePresets[id];
  if (!preset) return;
  els.scheduleMode.value = preset.mode;
  if (preset.at) els.atInput.value = preset.at;
  if (preset.every) els.everyInput.value = preset.every;
  if (preset.cron) els.cronInput.value = preset.cron;
  setActiveModeTile(modeForScheduleMode(preset.mode));
  updateScheduleControls();
  updatePreview();
}

function setDeliveryMode(mode) {
  const clean = deliveryPresets[mode] ? mode : "notify";
  els.deliveryModeInput.value = clean;
  els.deliverToggle.checked = clean === "notify";
  document.querySelectorAll("[data-delivery-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.deliveryMode === clean);
  });
  els.deliverySummary.textContent = deliveryPresets[clean].label;
  updateDeliveryControls();
  updatePreview();
}

function updateDeliveryControls() {
  const mode = els.deliveryModeInput.value || "notify";
  document.querySelectorAll(".delivery-control").forEach((control) => {
    const modes = (control.dataset.delivery || "").split(/\s+/);
    control.hidden = !modes.includes(mode);
  });
}

function updateScheduleControls() {
  const mode = els.scheduleMode.value;
  document.querySelectorAll(".schedule-control").forEach((control) => {
    const modes = (control.dataset.schedule || "").split(/\s+/);
    control.hidden = !modes.includes(mode);
  });
  const presetId = currentSchedulePresetId();
  document.querySelectorAll("[data-schedule-preset]").forEach((button) => {
    button.classList.toggle("active", button.dataset.schedulePreset === presetId);
  });
  const title = {
    now: "Tell agent now",
    at: "Remind me later",
    every: "Repeat a check",
    cron: "Scheduled automation",
    event: "System event",
  }[mode] || "Build flow";
  els.composerTitle.textContent = title;
  els.primaryAction.textContent = mode === "now" || mode === "event" ? "Run now" : "Create job";
  els.scheduleSummary.textContent = scheduleSummary();
}

function setMode(mode) {
  setActiveModeTile(mode);
  if (mode === "now") {
    setSchedulePreset("now");
  } else if (mode === "later") {
    setSchedulePreset("in30");
  } else if (mode === "daily") {
    setSchedulePreset("every2h");
  } else if (mode === "advanced") {
    $("advancedBox").open = true;
    setHelpMode("detailed");
    updateScheduleControls();
    updatePreview();
  }
}

function applyPreset(preset) {
  if (!preset) return;
  els.messageInput.value = preset.message || "";
  if (preset.schedule?.mode === "cron") {
    els.scheduleMode.value = "cron";
    els.cronInput.value = preset.schedule.cron || "0 9 * * *";
    els.timezoneInput.value = preset.schedule.timezone || els.timezoneInput.value;
  } else if (preset.schedule?.mode === "every") {
    els.scheduleMode.value = "every";
    els.everyInput.value = preset.schedule.every || "2h";
  } else if (preset.schedule?.mode === "at") {
    els.scheduleMode.value = "at";
    els.atInput.value = preset.schedule.at || "+30m";
  } else {
    els.scheduleMode.value = "now";
  }
  setActiveModeTile(modeForScheduleMode(els.scheduleMode.value));
  updateScheduleControls();
  updatePreview();
}

function collectPayload(kindOverride = null) {
  const scheduleMode = els.scheduleMode.value;
  const deliveryMode = els.deliveryModeInput.value || "notify";
  const wantsDelivery = deliveryMode === "notify";
  const enabled = els.enabledToggle.checked;
  const jobMode = els.jobModeInput.value;
  const effectiveMessage = effectiveMessageText(scheduleMode, jobMode);
  const payload = {
    kind: kindOverride || (scheduleMode === "event" ? "event" : scheduleMode === "now" ? "agent" : "cron"),
    sessionKey: selectedSessionKey(),
    message: effectiveMessage,
    baseMessage: els.messageInput.value.trim(),
    text: effectiveMessage,
    name: els.jobNameInput.value.trim() || `${state.selectedSession?.label || "OpenClaw"} automation`,
    description: els.descriptionInput.value.trim(),
    enabled,
    disabled: !enabled,
    deliveryMode,
    deliver: wantsDelivery && els.deliverToggle.checked,
    announce: wantsDelivery && els.deliverToggle.checked,
    noDeliver: !wantsDelivery,
    webhook: els.webhookInput.value.trim(),
    bestEffortDelivery: els.bestEffortDeliveryToggle.checked,
    expectFinal: els.expectFinalToggle.checked,
    lightContext: els.lightContextToggle.checked,
    deleteAfterRun: els.deleteAfterRunToggle.checked,
    exactTiming: els.exactTimingToggle.checked,
    replyChannel: els.replyChannelInput.value.trim(),
    replyTo: els.replyToInput.value.trim(),
    channel: els.replyChannelInput.value.trim(),
    to: els.replyToInput.value.trim(),
    agent: els.agentInput.value.trim(),
    model: els.modelInput.value.trim(),
    thinking: els.thinkingInput.value,
    timeoutSeconds: Number(els.timeoutInput.value || 600),
    scheduleMode,
    at: els.atInput.value.trim(),
    every: els.everyInput.value.trim(),
    cron: els.cronInput.value.trim(),
    timezone: els.timezoneInput.value.trim(),
    tools: els.toolsInput.value.trim(),
    stagger: els.staggerInput.value.trim(),
    wake: els.wakeInput.value,
    jobMode,
    sessionTarget: els.sessionTargetInput.value,
    workflowStateAttached: shouldAttachWorkflowState(scheduleMode, jobMode),
    workflow: workflowFields(),
  };
  return payload;
}

function scheduleLabelForPayload(payload) {
  if (payload.scheduleMode === "now") return "Ask Now";
  if (payload.scheduleMode === "at") return `Once later at ${payload.at || "unset"}`;
  if (payload.scheduleMode === "every") return `Repeat every ${payload.every || "unset"}`;
  if (payload.scheduleMode === "cron") return `Cron ${payload.cron || "unset"}${payload.timezone ? ` in ${payload.timezone}` : ""}`;
  if (payload.scheduleMode === "event") return "System event now";
  return payload.scheduleMode || "unknown";
}

const safetyCaseLookup = {
  notReady: {
    agent: "No agent run is ready yet because there is no complete prompt and route.",
    user: "You still need to choose the chat and write the message before this can do anything.",
    why: "The app cannot reason about routing until it has both a context session and prompt.",
    fix: "Pick a chat and write the message first.",
  },
  contextOverride: {
    agent: "The model will read the session from Session key override, not necessarily the chat card that is visually selected.",
    user: "You may expect the selected chat to be used, but the override wins.",
    why: "This is useful for intentional cross-session work, but dangerous when the override was accidental.",
    fix: "If this was accidental, clear Session key override by selecting the intended chat again.",
  },
  agentOverride: {
    agent: "The requested agent can differ from the agent encoded in the session key.",
    user: "The chat name may look right while a different agent is actually asked to run.",
    why: "Agent mismatch can change memory, tools, model defaults, and routing behavior.",
    fix: "Leave Agent ID empty unless you deliberately want a different agent.",
  },
  replyMissing: {
    agent: "The model can run, but the app does not have a concrete chat recipient for the final answer.",
    user: "You may create work that finishes silently or fails delivery.",
    why: "Message me requires a Reply to / delivery target.",
    fix: "Pick a Telegram chat with reply ready, fill Reply to, or choose Quiet run.",
  },
  telegramMismatch: {
    agent: "The model reads one Telegram session but sends the answer to a different Telegram target.",
    user: "The answer can appear in a chat that is not the chat whose history/model context was read.",
    why: "Cross-routing is powerful, but it can make later conversation history misleading.",
    fix: "Keep it only if intentional; otherwise select the intended Telegram chat again.",
  },
  nonTelegramNotify: {
    agent: "The model reads a local/non-Telegram session and sends the answer out through a delivery channel.",
    user: "The final reply appears outside the session that supplied context.",
    why: "This is common for heartbeat/status jobs, but should be visible every time.",
    fix: "Use Quiet run if the output should stay internal, or keep Message me if you want the push notification.",
  },
  webhook: {
    agent: "The model reads the configured session, then OpenClaw posts the finished payload to a webhook.",
    user: "You will not see a normal chat reply unless the webhook system forwards it somewhere.",
    why: "Webhook delivery leaves the chat surface and may trigger external automation.",
    fix: "Use Message me for chat delivery, or verify the webhook URL before creating the job.",
  },
  quiet: {
    agent: "The model reads and works, but the runner is told not to deliver a final answer.",
    user: "You should inspect Gateway history/logs for results instead of expecting a chat message.",
    why: "Quiet run is good for internal maintenance, but confusing for user-visible reminders.",
    fix: "Choose Message me if you want a visible final answer.",
  },
  isolatedCron: {
    agent: "The cron job starts from the configured session but runs in a dedicated isolated agent turn.",
    user: "Repeated work is less likely to pollute the selected chat's main timeline.",
    why: "Isolated is the safest default for repeated tasks.",
    fix: "Keep isolated unless the job must post into the main timeline.",
  },
  mainCron: {
    agent: "The scheduled agent work writes directly into the main target session.",
    user: "Repeated runs can add context/messages into the session users may later chat in.",
    why: "Main is useful for timeline-style automations, but it can make chat context grow quickly.",
    fix: "Use isolated for ordinary repeated tasks.",
  },
  systemEventIsolated: {
    agent: "A system event is configured away from main, which can make its lifecycle harder to follow.",
    user: "The event may not show where you expect when reviewing the main session.",
    why: "System events naturally belong in main-style session flow.",
    fix: "Use Cron session main for system-event jobs unless you have a specific reason.",
  },
  disabled: {
    agent: "The job definition is saved but the runner will skip it until enabled.",
    user: "You will see the job in cron lists, but it will not run automatically.",
    why: "Disabled jobs are good drafts; they are not active automation.",
    fix: "Turn Enabled on when you are ready for scheduled execution.",
  },
  immediateWebhook: {
    agent: "Ask Now does not route webhook delivery through this app.",
    user: "The Run button is blocked because the configured delivery mode cannot work for immediate runs here.",
    why: "Webhook is implemented for cron jobs via --webhook.",
    fix: "Pick a schedule, or change Answer to Message me or Quiet run.",
  },
  adaptiveWorkflow: {
    agent: "The scheduled prompt includes a compact workflow-state block as current-step source of truth.",
    user: "Each cron run starts with the precise step and next action you wrote here, instead of guessing from broad history.",
    why: "This reduces slow rediscovery and avoids reading large workflow-state files just to find the next step.",
    fix: "Keep the workflow fields short and update them when the real next step changes.",
  },
  ok: {
    agent: "The model reads and replies through the same selected route as closely as OpenClaw exposes it.",
    user: "This is the normal safe path.",
    why: "No conflicting advanced routing was detected.",
    fix: "Run or schedule when the prompt looks right.",
  },
};

function safetySettingsLine(payload, meta) {
  return [
    `selected chat=${meta.selectedLabel}`,
    `context=${meta.contextLabel}`,
    `schedule=${scheduleLabelForPayload(payload)}`,
    `cron session=${payload.kind === "cron" ? payload.sessionTarget : "not cron"}`,
    `job mode=${payload.jobMode}`,
    `delivery=${deliveryLabel(payload)}`,
    `agent override=${payload.agent || "none"}`,
    `model override=${payload.model || "none"}`,
    `adaptive workflow=${payload.workflowStateAttached ? "on" : "off"}`,
  ].join("; ");
}

function decorateSafetyItem(item, payload, meta) {
  const lookup = safetyCaseLookup[item.caseId] || safetyCaseLookup.ok;
  const detail = [
    `Current situation: ${item.text}`,
    `Configured settings: ${safetySettingsLine(payload, meta)}.`,
    `Agent perspective: ${lookup.agent}`,
    `User perspective: ${lookup.user}`,
    `Why it matters: ${lookup.why}`,
    `Safe interpretation: ${lookup.fix}`,
  ].join(" ");
  return {
    ...item,
    simple: item.text,
    detailed: detail,
  };
}

function buildSafetyItems(payload) {
  const items = [];
  const contextKey = payload.sessionKey;
  const selectedKey = state.selectedSession?.key || "";
  const contextParts = parseSessionKey(contextKey);
  const contextLabel = sessionLabelFromKey(contextKey);
  const selectedLabel = state.selectedSession?.label || "selected chat";
  const isCron = payload.kind === "cron";
  const isImmediateAgent = payload.kind === "agent";

  if (!contextKey || !payload.message) {
    items.push({
      caseId: "notReady",
      severity: "notice",
      title: "Not ready yet",
      text: "Pick a chat and write a message first.",
    });
    const meta = { contextLabel, selectedLabel };
    return items.map((item) => decorateSafetyItem(item, payload, meta));
  }

  if (selectedKey && contextKey !== selectedKey) {
    items.push({
      caseId: "contextOverride",
      severity: "warning",
      title: "Context was changed",
      text: `The selected chat is ${selectedLabel}, but the agent will read ${contextLabel}. This usually means Session key override was changed.`,
    });
  }

  if (payload.agent && payload.agent !== contextParts.agentId) {
    items.push({
      caseId: "agentOverride",
      severity: "warning",
      title: "Agent override",
      text: `Session key points at agent ${contextParts.agentId}, but Agent ID override is ${payload.agent}. The run may use a different agent than the chat suggests.`,
    });
  }

  if (payload.deliveryMode === "notify") {
    const delivery = deliveryLabel(payload);
    if (!payload.replyTo && !payload.to) {
      items.push({
        caseId: "replyMissing",
        severity: "danger",
        title: "Reply target missing",
        text: `The agent will read ${contextLabel}, but the app does not know who should receive the answer.`,
      });
    } else if (contextParts.surface === "telegram" && !selectedDeliveryMatchesContext(payload, contextParts)) {
      items.push({
        caseId: "telegramMismatch",
        severity: "warning",
        title: "Reads one chat, replies somewhere else",
        text: `The agent will read ${contextLabel}, but the answer will be sent to ${delivery}. This can be intentional, but it is easy to confuse later.`,
      });
    } else if (contextParts.surface !== "telegram") {
      items.push({
        caseId: "nonTelegramNotify",
        severity: "warning",
        title: "Reply leaves the context chat",
        text: `The agent will read ${contextLabel}, but the answer will be sent to ${delivery}. The reply will not land in the same place the model read from.`,
      });
    }
  }

  if (payload.deliveryMode === "webhook") {
    items.push({
      caseId: "webhook",
      severity: payload.webhook ? "warning" : "danger",
      title: payload.webhook ? "Reply goes to webhook" : "Webhook URL missing",
      text: payload.webhook
        ? `The agent will read ${contextLabel}, but the answer will be POSTed to ${payload.webhook}, not sent back to the chat.`
        : `The agent will read ${contextLabel}, but Webhook delivery needs a URL before this can work.`,
    });
  }

  if (payload.deliveryMode === "quiet") {
    items.push({
      caseId: "quiet",
      severity: "notice",
      title: "No chat reply",
      text: `The agent will read ${contextLabel}, but no final answer will be delivered back to a chat.`,
    });
  }

  if (isCron && payload.sessionTarget === "isolated") {
    items.push({
      caseId: "isolatedCron",
      severity: "notice",
      title: "Cron uses an isolated run",
      text: `The scheduled job is seeded from ${contextLabel}, then runs in its own isolated agent turn. That is usually safest for repeated jobs.`,
    });
  }

  if (isCron && payload.sessionTarget === "main" && payload.jobMode !== "system-event") {
    items.push({
      caseId: "mainCron",
      severity: "warning",
      title: "Cron writes into main session",
      text: `This agent job uses main instead of isolated. Repeated runs may add context directly to ${contextLabel}.`,
    });
  }

  if (isCron && payload.jobMode === "system-event" && payload.sessionTarget !== "main") {
    items.push({
      caseId: "systemEventIsolated",
      severity: "warning",
      title: "System event not on main",
      text: "System events normally belong on main. Using isolated can make the event harder to reason about.",
    });
  }

  if (isCron && !payload.enabled) {
    items.push({
      caseId: "disabled",
      severity: "notice",
      title: "Saved disabled",
      text: "This cron job will be saved but will not run until you enable it.",
    });
  }

  if (isImmediateAgent && payload.deliveryMode === "webhook") {
    items.push({
      caseId: "immediateWebhook",
      severity: "danger",
      title: "Webhook is cron-only here",
      text: "Ask Now does not use webhook delivery in this app. Pick a schedule or choose Message me/Quiet run.",
    });
  }

  if (payload.workflowStateAttached) {
    items.push({
      caseId: "adaptiveWorkflow",
      severity: "notice",
      title: "Adaptive workflow prompt",
      text: "This scheduled run will include your compact workflow state and next action inside the prompt.",
    });
  }

  if (!items.length) {
    items.push({
      caseId: "ok",
      severity: "ok",
      title: "Looks matched",
      text: `The agent reads ${contextLabel}, and the reply route matches the selected chat as closely as OpenClaw exposes it.`,
    });
  }

  const meta = { contextLabel, selectedLabel };
  return items.map((item) => decorateSafetyItem(item, payload, meta));
}

function renderSafety(items) {
  const rank = { ok: 0, notice: 1, warning: 2, danger: 3 };
  const worst = items.reduce((current, item) => Math.max(current, rank[item.severity] ?? 0), 0);
  const panelClass = worst >= 3 ? "danger" : worst >= 2 ? "warning" : "ok";
  const waiting = items.some((item) => item.title === "Not ready yet");
  state.safetyBlocks = worst >= 3;
  els.safetyPanel.className = `safety-panel ${panelClass}`;
  els.safetySummary.textContent = waiting ? "Waiting for message" : worst >= 3 ? "Needs fix" : worst >= 2 ? "Check routing" : worst >= 1 ? "Heads up" : "Looks safe";
  els.safetyList.innerHTML = items.map((item) => `
    <div class="safety-item ${escapeHtml(item.severity)}" data-help-key="safetyPanel" data-help-title="${escapeHtml(item.title)}" data-help-simple="${escapeHtml(item.simple || item.text)}" data-help-detailed="${escapeHtml(item.detailed || item.text)}">
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.text)}</span>
    </div>
  `).join("");
}

function updateSafety(payload = collectPayload()) {
  renderSafety(buildSafetyItems(payload));
}

function syncActionState() {
  const ready = Boolean(selectedSessionKey() && els.messageInput.value.trim());
  els.primaryAction.disabled = !ready || state.safetyBlocks;
  els.previewBtn.disabled = !ready;
}

async function updatePreview() {
  updateWorkflowSummary();
  const payload = collectPayload();
  updateSafety(payload);
  syncActionState();
  if (!payload.sessionKey || !payload.message) {
    els.commandPreview.textContent = "Select a chat and write a message.";
    return;
  }
  try {
    const preview = await api("/api/preview", { method: "POST", body: payload });
    els.commandPreview.textContent = preview.command;
  } catch (error) {
    els.commandPreview.textContent = error.message;
  }
}

async function runPrimary() {
  const payload = collectPayload();
  if (!payload.sessionKey) {
    setResult("Pick a chat first.", true);
    return;
  }
  if (!payload.message) {
    setResult("Write the message first.", true);
    return;
  }
  els.primaryAction.disabled = true;
  els.primaryAction.textContent = "Working";
  setResult("Starting...");
  try {
    const scheduleMode = els.scheduleMode.value;
    const endpoint = scheduleMode === "event"
      ? "/api/system/event"
      : scheduleMode === "now"
        ? "/api/agent/run"
        : "/api/cron/create";
    const result = await api(endpoint, { method: "POST", body: payload });
    setResult(result, !result.ok);
    await load();
  } catch (error) {
    setResult(error.message, true);
  } finally {
    updateScheduleControls();
    syncActionState();
  }
}

async function previewNow() {
  const payload = collectPayload();
  try {
    const preview = await api("/api/preview", { method: "POST", body: payload });
    setResult(preview);
  } catch (error) {
    setResult(error.message, true);
  }
}

async function load() {
  els.primaryAction.disabled = true;
  els.previewBtn.disabled = true;
  els.statusLine.textContent = "Reading OpenClaw sessions";
  const bootstrap = await api("/api/bootstrap");
  state.bootstrap = bootstrap;
  state.sessions = bootstrap.sessions || [];
  state.jobs = bootstrap.jobs || [];
  els.gatewayLink.href = bootstrap.app?.gatewayHttp || "http://127.0.0.1:18789/";
  els.cronLink.href = `${(bootstrap.app?.gatewayHttp || "http://127.0.0.1:18789/").replace(/\/$/, "")}/cron`;
  els.timezoneInput.value = bootstrap.settings?.defaultTimezone || els.timezoneInput.value;
  els.thinkingInput.value = bootstrap.settings?.defaultThinking || "xhigh";
  els.timeoutInput.value = bootstrap.settings?.defaultTimeoutSeconds || 600;
  els.backendBadge.textContent = bootstrap.checks?.gateway?.ok ? "Online" : "Check";
  els.statusLine.textContent = bootstrap.checks?.gateway?.ok
    ? "Gateway reachable / sessions ready"
    : "OpenClaw needs attention";
  const selected = state.sessions.find((session) => session.key === state.selectedSession?.key)
    || state.sessions.find((session) => session.key === bootstrap.selectedSessionKey)
    || state.sessions[0]
    || null;
  renderPresets();
  renderJobs();
  renderChecks();
  setDeliveryMode(els.deliveryModeInput.value || "notify");
  applySession(selected);
  updateScheduleControls();
}

document.addEventListener("click", (event) => {
  const helpChoice = event.target.closest(".help-choice[data-help-mode]");
  if (helpChoice) {
    setHelpMode(helpChoice.dataset.helpMode);
    return;
  }
  const sessionButton = event.target.closest("[data-session-key]");
  if (sessionButton) {
    const session = state.sessions.find((item) => item.key === sessionButton.dataset.sessionKey);
    applySession(session);
  }
  const presetButton = event.target.closest("[data-preset]");
  if (presetButton) {
    const preset = (state.bootstrap?.presets || []).find((item) => item.id === presetButton.dataset.preset);
    applyPreset(preset);
  }
  const schedulePresetButton = event.target.closest("[data-schedule-preset]");
  if (schedulePresetButton) {
    setSchedulePreset(schedulePresetButton.dataset.schedulePreset);
  }
  const deliveryPresetButton = event.target.closest("[data-delivery-mode]");
  if (deliveryPresetButton) {
    setDeliveryMode(deliveryPresetButton.dataset.deliveryMode);
  }
  const tile = event.target.closest(".mode-tile");
  if (tile) setMode(tile.dataset.mode);
});

function handleHelpEnter(event) {
  const target = event.target.closest("[data-help-key]");
  if (!target || !document.body.contains(target)) return;
  queueHelp(target, 5000);
}

function handleHelpLeave(event) {
  const target = event.target.closest("[data-help-key]");
  if (!target) return;
  const next = event.relatedTarget;
  if (next && target.contains(next)) return;
  if (next && els.helpBubble.contains(next)) return;
  cancelQueuedHelp(target);
}

function handleOutsidePointerDown(event) {
  if (els.helpBubble.hidden) return;
  if (els.helpBubble.contains(event.target)) return;
  if (state.helpVisibleTarget?.contains(event.target)) return;
  hideHelp();
}

document.addEventListener("pointerover", handleHelpEnter);
document.addEventListener("pointerout", handleHelpLeave);
document.addEventListener("mouseover", handleHelpEnter);
document.addEventListener("mouseout", handleHelpLeave);
document.addEventListener("pointerdown", handleOutsidePointerDown);

document.addEventListener("focusin", (event) => {
  const target = event.target.closest("[data-help-key]");
  if (target) queueHelp(target, 1200);
});

document.addEventListener("focus", (event) => {
  const target = event.target.closest("[data-help-key]");
  if (target) queueHelp(target, 1200);
}, true);

document.addEventListener("focusout", (event) => {
  const target = event.target.closest("[data-help-key]");
  if (target) cancelQueuedHelp(target);
});
document.addEventListener("blur", () => cancelQueuedHelp(), true);
els.helpBubble.addEventListener("mouseenter", () => clearTimeout(state.helpTimer));
els.helpCloseBtn.addEventListener("click", hideHelp);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") hideHelp();
});
window.addEventListener("scroll", refreshVisibleHelpPosition, true);
window.addEventListener("resize", refreshVisibleHelpPosition);

["input", "change"].forEach((eventName) => {
  [
    els.messageInput,
    els.scheduleMode,
    els.atInput,
    els.everyInput,
    els.cronInput,
    els.timezoneInput,
    els.enabledToggle,
    els.deliverToggle,
    els.expectFinalToggle,
    els.lightContextToggle,
    els.deleteAfterRunToggle,
    els.exactTimingToggle,
    els.bestEffortDeliveryToggle,
    els.workflowAdaptiveToggle,
    els.workflowNameInput,
    els.workflowStepInput,
    els.workflowNextInput,
    els.workflowDoneInput,
    els.workflowNoteInput,
    els.jobNameInput,
    els.descriptionInput,
    els.sessionKeyInput,
    els.replyChannelInput,
    els.replyToInput,
    els.webhookInput,
    els.agentInput,
    els.modelInput,
    els.thinkingInput,
    els.timeoutInput,
    els.toolsInput,
    els.staggerInput,
    els.wakeInput,
    els.jobModeInput,
    els.sessionTargetInput,
  ].forEach((node) => node.addEventListener(eventName, () => {
    if (node === els.deliverToggle) {
      setDeliveryMode(els.deliverToggle.checked ? "notify" : "quiet");
      return;
    }
    if (node === els.scheduleMode) {
      setActiveModeTile(modeForScheduleMode(els.scheduleMode.value));
    }
    updateScheduleControls();
    updatePreview();
  }));
});

els.sessionSearch.addEventListener("input", renderSessions);
els.refreshBtn.addEventListener("click", () => load().catch((error) => setResult(error.message, true)));
els.primaryAction.addEventListener("click", runPrimary);
els.previewBtn.addEventListener("click", previewNow);

setHelpMode(state.helpMode);
load().catch((error) => {
  els.statusLine.textContent = "Could not load OpenClaw state";
  setResult(error.message, true);
});

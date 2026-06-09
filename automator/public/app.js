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
  scheduleSummary: $("scheduleSummary"),
  deliverySummary: $("deliverySummary"),
  deliveryModeInput: $("deliveryModeInput"),
  scheduleMode: $("scheduleMode"),
  atInput: $("atInput"),
  everyInput: $("everyInput"),
  cronInput: $("cronInput"),
  timezoneInput: $("timezoneInput"),
  deliverToggle: $("deliverToggle"),
  expectFinalToggle: $("expectFinalToggle"),
  lightContextToggle: $("lightContextToggle"),
  sessionKeyInput: $("sessionKeyInput"),
  replyChannelInput: $("replyChannelInput"),
  replyToInput: $("replyToInput"),
  thinkingInput: $("thinkingInput"),
  timeoutInput: $("timeoutInput"),
  toolsInput: $("toolsInput"),
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
    detailed: "Opens the full command surface: schedule fields, session key override, reply routing, cron session target, model thinking, timeout, tool allow-list, wake mode, and system-event mode. It also switches help labels to Detailed.",
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
  deliveryPresets: {
    title: "Answer",
    simple: "Choose whether the result should message you.",
    detailed: "Message me sends the final answer back to the selected chat. Quiet run explicitly uses --no-deliver for cron so isolated jobs do not fall back to announcing unexpectedly.",
  },
  deliveryPreset: {
    title: "Answer choice",
    simple: "Choose how visible the result should be.",
    detailed: "Message me maps to --deliver for Ask now and --announce for cron. Quiet run leaves immediate runs local and adds --no-deliver for cron jobs.",
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
  advancedSummary: {
    title: "Advanced settings",
    simple: "Extra controls live here.",
    detailed: "These fields map directly to OpenClaw CLI flags. They are for users who want to verify routing, delivery, model effort, timeout, tool access, and wake behavior before execution.",
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
  sessionTarget: {
    title: "Cron session",
    simple: "Where scheduled agent work runs.",
    detailed: "Passed as cron --session. isolated is the safe default for agent-turn cron jobs. current reuses the current cron session. main is only valid for system-event jobs.",
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
  "--channel": "https://docs.openclaw.ai/cli/cron#:~:text=Announce%20to%20a%20specific%20channel",
  "--cron": "https://docs.openclaw.ai/cli/cron#scheduling",
  "--deliver": "https://docs.openclaw.ai/cli/agent#:~:text=--deliver%3A%20send%20the%20reply%20back%20to%20the%20selected%20channel%2Ftarget",
  "--every": "https://docs.openclaw.ai/cli/cron#scheduling",
  "--expect-final": "https://docs.openclaw.ai/cli/system#:~:text=--expect-final",
  "--json": "https://docs.openclaw.ai/cli/agent#:~:text=--json%3A%20output%20JSON",
  "--light-context": "https://docs.openclaw.ai/cli/cron#:~:text=--light-context%20applies%20to%20isolated%20agent-turn%20jobs%20only",
  "--message": "https://docs.openclaw.ai/cli/agent#:~:text=-m%2C%20--message%20%3Ctext%3E%3A%20required%20message%20body",
  "--mode": "https://docs.openclaw.ai/cli/system#:~:text=--mode%20%3Cmode%3E%3A%20now%20or%20next-heartbeat",
  "--no-deliver": "https://docs.openclaw.ai/cli/cron#:~:text=--no-deliver%20disables%20that%20fallback",
  "--reply-account": "https://docs.openclaw.ai/cli/agent#:~:text=--reply-account%20%3Cid%3E%3A%20delivery%20account%20override",
  "--reply-channel": "https://docs.openclaw.ai/cli/agent#:~:text=--reply-channel%20%3Cchannel%3E%3A%20delivery%20channel%20override",
  "--reply-to": "https://docs.openclaw.ai/cli/agent#:~:text=--reply-to%20%3Ctarget%3E%3A%20delivery%20target%20override",
  "--session": "https://docs.openclaw.ai/cli/cron#sessions",
  "--session-id": "https://docs.openclaw.ai/cli/agent#:~:text=--session-id%20%3Cid%3E%3A%20explicit%20session%20id",
  "--session-key": "https://docs.openclaw.ai/cli/agent#:~:text=--session-key%20%3Ckey%3E%3A%20explicit%20session%20key",
  "--system-event": "https://docs.openclaw.ai/cli/cron#:~:text=--system-event",
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

function renderJobs() {
  els.jobCount.textContent = String(state.jobs.length);
  els.jobsList.innerHTML = state.jobs.map((job) => `
    <div class="job-row" data-help-key="jobRow">
      <strong>${escapeHtml(job.name || job.id || "OpenClaw job")}</strong>
      <span>${escapeHtml(job.schedule || job.cron || job.every || job.nextRunAt || "scheduled")}</span>
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
  updatePreview();
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
  const payload = {
    kind: kindOverride || (scheduleMode === "event" ? "event" : scheduleMode === "now" ? "agent" : "cron"),
    sessionKey: selectedSessionKey(),
    message: els.messageInput.value.trim(),
    text: els.messageInput.value.trim(),
    deliveryMode,
    deliver: wantsDelivery && els.deliverToggle.checked,
    announce: wantsDelivery && els.deliverToggle.checked,
    noDeliver: !wantsDelivery,
    expectFinal: els.expectFinalToggle.checked,
    lightContext: els.lightContextToggle.checked,
    replyChannel: els.replyChannelInput.value.trim(),
    replyTo: els.replyToInput.value.trim(),
    channel: els.replyChannelInput.value.trim(),
    to: els.replyToInput.value.trim(),
    thinking: els.thinkingInput.value,
    timeoutSeconds: Number(els.timeoutInput.value || 600),
    scheduleMode,
    name: `${state.selectedSession?.label || "OpenClaw"} automation`,
    at: els.atInput.value.trim(),
    every: els.everyInput.value.trim(),
    cron: els.cronInput.value.trim(),
    timezone: els.timezoneInput.value.trim(),
    tools: els.toolsInput.value.trim(),
    wake: els.wakeInput.value,
    jobMode: els.jobModeInput.value,
    sessionTarget: els.sessionTargetInput.value,
  };
  return payload;
}

function syncActionState() {
  const ready = Boolean(selectedSessionKey() && els.messageInput.value.trim());
  els.primaryAction.disabled = !ready;
  els.previewBtn.disabled = !ready;
}

async function updatePreview() {
  const payload = collectPayload();
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
    els.deliverToggle,
    els.expectFinalToggle,
    els.lightContextToggle,
    els.sessionKeyInput,
    els.replyChannelInput,
    els.replyToInput,
    els.thinkingInput,
    els.timeoutInput,
    els.toolsInput,
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

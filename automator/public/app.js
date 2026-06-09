const state = {
  bootstrap: null,
  sessions: [],
  jobs: [],
  selectedSession: null,
  mode: "now",
};

const $ = (id) => document.getElementById(id);

const els = {
  statusLine: $("statusLine"),
  refreshBtn: $("refreshBtn"),
  gatewayLink: $("gatewayLink"),
  sessionCount: $("sessionCount"),
  sessionSearch: $("sessionSearch"),
  sessionList: $("sessionList"),
  selectedBadge: $("selectedBadge"),
  composerTitle: $("composerTitle"),
  presetRow: $("presetRow"),
  messageInput: $("messageInput"),
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
  commandPreview: $("commandPreview"),
  primaryAction: $("primaryAction"),
  previewBtn: $("previewBtn"),
  resultBox: $("resultBox"),
  jobsList: $("jobsList"),
  jobCount: $("jobCount"),
  checkList: $("checkList"),
  backendBadge: $("backendBadge"),
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
  els.deliverToggle.checked = Boolean(session?.delivery?.available);
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
    return `
      <button class="session-card ${selected}" data-session-key="${escapeHtml(session.key)}">
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
    <button class="preset" data-preset="${escapeHtml(preset.id)}">${escapeHtml(preset.title)}</button>
  `).join("");
}

function renderJobs() {
  els.jobCount.textContent = String(state.jobs.length);
  els.jobsList.innerHTML = state.jobs.map((job) => `
    <div class="job-row">
      <strong>${escapeHtml(job.name || job.id || "OpenClaw job")}</strong>
      <span>${escapeHtml(job.schedule || job.cron || job.every || job.nextRunAt || "scheduled")}</span>
    </div>
  `).join("") || `<div class="empty">No cron jobs yet</div>`;
}

function renderChecks() {
  const checks = state.bootstrap?.checks || {};
  const rows = Object.entries(checks).map(([name, value]) => `
    <div class="check-row ${value.ok ? "ok" : "bad"}">
      <span>${escapeHtml(name)}</span>
      <strong>${value.ok ? "ok" : "check"}</strong>
    </div>
  `);
  els.checkList.innerHTML = rows.join("");
}

function updateScheduleControls() {
  const mode = els.scheduleMode.value;
  document.querySelectorAll(".schedule-control").forEach((control) => {
    const modes = (control.dataset.schedule || "").split(/\s+/);
    control.hidden = !modes.includes(mode);
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
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".mode-tile").forEach((tile) => {
    tile.classList.toggle("active", tile.dataset.mode === mode);
  });
  if (mode === "now") {
    els.scheduleMode.value = "now";
  } else if (mode === "later") {
    els.scheduleMode.value = "at";
    els.atInput.value = "+30m";
  } else if (mode === "daily") {
    els.scheduleMode.value = "cron";
    els.cronInput.value = "0 9 * * *";
  } else if (mode === "advanced") {
    $("advancedBox").open = true;
  }
  updateScheduleControls();
  updatePreview();
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
  updateScheduleControls();
  updatePreview();
}

function collectPayload(kindOverride = null) {
  const scheduleMode = els.scheduleMode.value;
  const payload = {
    kind: kindOverride || (scheduleMode === "event" ? "event" : scheduleMode === "now" ? "agent" : "cron"),
    sessionKey: selectedSessionKey(),
    message: els.messageInput.value.trim(),
    text: els.messageInput.value.trim(),
    deliver: els.deliverToggle.checked,
    announce: els.deliverToggle.checked,
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
  applySession(selected);
  updateScheduleControls();
}

document.addEventListener("click", (event) => {
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
  const tile = event.target.closest(".mode-tile");
  if (tile) setMode(tile.dataset.mode);
});

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
  ].forEach((node) => node.addEventListener(eventName, () => {
    updateScheduleControls();
    updatePreview();
  }));
});

els.sessionSearch.addEventListener("input", renderSessions);
els.refreshBtn.addEventListener("click", () => load().catch((error) => setResult(error.message, true)));
els.primaryAction.addEventListener("click", runPrimary);
els.previewBtn.addEventListener("click", previewNow);

load().catch((error) => {
  els.statusLine.textContent = "Could not load OpenClaw state";
  setResult(error.message, true);
});

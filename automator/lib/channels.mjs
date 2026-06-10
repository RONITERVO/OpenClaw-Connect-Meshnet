function normalizeChannelId(value) {
  return String(value || "").trim().toLowerCase();
}

function configuredChannelIds(settings) {
  return Array.isArray(settings.configuredChannels)
    ? settings.configuredChannels.map(normalizeChannelId).filter(Boolean)
    : [];
}

function cronNotifySupport(channel, settings) {
  const id = normalizeChannelId(channel);
  if (!id) return { ok: false, reason: "No delivery channel was selected." };
  if (["webchat", "dashboard", "browser", "control-ui", "main", "chat"].includes(id) || id.startsWith("agent:")) {
    return { ok: false, reason: `OpenClaw cron cannot announce directly to ${channel} sessions.` };
  }
  const configured = configuredChannelIds(settings);
  if (configured.length && id !== "last" && !configured.includes(id)) {
    return { ok: false, reason: `OpenClaw cron channel ${channel} is not configured on this Gateway.` };
  }
  return { ok: true, reason: "" };
}

function cronDeliveryWarning(channel, settings) {
  const configured = configuredChannelIds(settings);
  const suffix = configured.length
    ? ` Configured delivery channel${configured.length === 1 ? "" : "s"}: ${configured.join(", ")}.`
    : "";
  return `OpenClaw cron cannot notify channel '${channel || "unknown"}' from this Gateway. The workflow will be created with quiet delivery; inspect Cron/session history or choose a configured messaging channel for notifications.${suffix}`;
}


export {
  configuredChannelIds,
  cronDeliveryWarning,
  cronNotifySupport,
  normalizeChannelId,
};

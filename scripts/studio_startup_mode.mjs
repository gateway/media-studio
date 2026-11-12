const MODES = new Set(["verification", "live"]);

export function startupModeEnv(mode) {
  if (!mode) return {};
  if (!MODES.has(mode))
    throw new Error("--startup-mode must be verification or live.");
  const live = mode === "live" ? "1" : "0";
  return {
    MEDIA_ENABLE_LIVE_SUBMIT: live,
    MEDIA_BACKGROUND_POLL_ENABLED: live,
    MEDIA_STARTUP_RECOVERY_ENABLED: "0",
    MEDIA_PRICING_REFRESH_ON_STARTUP: "0",
  };
}

export function startupModeIssue(mode, health) {
  if (!mode) return null;
  if (!health) return "API health is unavailable.";
  const live = mode === "live";
  if (health.live_submit_enabled !== live) {
    return `Expected live submission ${live ? "enabled" : "disabled"}.`;
  }
  if (health.runner_active !== live) {
    return `Expected the media worker to be ${live ? "active" : "inactive"}.`;
  }
  if (!live) return null;
  if (health.kie_api_key_configured !== true)
    return "The KIE key is not configured.";
  if (health.queue_enabled !== true) return "Media queue processing is paused.";
  if (
    health.runner_health !== "healthy" ||
    !Number.isFinite(health.heartbeat_age_seconds) ||
    !Number.isFinite(health.heartbeat_max_age_seconds) ||
    health.heartbeat_age_seconds > health.heartbeat_max_age_seconds
  ) {
    return "The media worker has no fresh, healthy heartbeat.";
  }
  return null;
}

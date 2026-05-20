import type { ControlApiHealthData, MediaEnhancementConfig, PromptRecipeDraftingConfig } from "@/lib/types";

export type MediaStudioHealthSummary = Pick<
  ControlApiHealthData,
  | "kie_api_repo_connected"
  | "kie_api_key_configured"
  | "live_submit_enabled"
  | "openrouter_api_key_configured"
  | "local_openai_configured"
  | "local_openai_ready"
  | "codex_local_command_available"
  | "codex_local_login_configured"
  | "codex_local_ready"
>;

export function normalizeMediaStudioHealth(
  health: MediaStudioHealthSummary | ControlApiHealthData | null | undefined,
): MediaStudioHealthSummary {
  if (!health) {
    return {};
  }
  return {
    kie_api_repo_connected: Boolean(health.kie_api_repo_connected),
    kie_api_key_configured: Boolean(health.kie_api_key_configured),
    live_submit_enabled: Boolean(health.live_submit_enabled),
    openrouter_api_key_configured: Boolean(health.openrouter_api_key_configured),
    local_openai_configured: Boolean(health.local_openai_configured),
    local_openai_ready: Boolean(health.local_openai_ready),
    codex_local_command_available: Boolean(health.codex_local_command_available),
    codex_local_login_configured: Boolean(health.codex_local_login_configured),
    codex_local_ready: Boolean(health.codex_local_ready),
  };
}

export function providerReadinessFromHealth(healthInput: MediaStudioHealthSummary | ControlApiHealthData | null | undefined) {
  const health = normalizeMediaStudioHealth(healthInput);
  const openRouterConfigured = Boolean(health.openrouter_api_key_configured);
  const codexCommandAvailable = Boolean(health.codex_local_command_available);
  const codexLoginConfigured = Boolean(health.codex_local_login_configured);
  const codexReady = Boolean(health.codex_local_ready);
  const localOpenAiConfigured = Boolean(health.local_openai_configured);
  const localOpenAiReady = Boolean(health.local_openai_ready);

  return {
    health,
    codexLocal: {
      commandAvailable: codexCommandAvailable,
      loginConfigured: codexLoginConfigured,
      configured: codexCommandAvailable || codexLoginConfigured,
      ready: codexReady,
    },
    openRouter: {
      configured: openRouterConfigured,
      ready: openRouterConfigured,
    },
    localOpenAi: {
      configured: localOpenAiConfigured,
      ready: localOpenAiReady,
    },
  };
}

export function hasConfiguredLocalOpenAiProvider(
  enhancementConfigs: MediaEnhancementConfig[],
  promptRecipeDraftingConfig: PromptRecipeDraftingConfig | null,
) {
  return (
    enhancementConfigs.some(
      (config) =>
        config.provider_kind === "local_openai" &&
        Boolean(config.provider_base_url_configured || config.provider_model_id),
    ) ||
    promptRecipeDraftingConfig?.provider_kind === "local_openai" ||
    Boolean(promptRecipeDraftingConfig?.provider_base_url_configured)
  );
}

export function summarizeLlmProviderReadiness(
  healthInput: MediaStudioHealthSummary | ControlApiHealthData | null | undefined,
  enhancementConfigs: MediaEnhancementConfig[],
  promptRecipeDraftingConfig: PromptRecipeDraftingConfig | null,
) {
  const readiness = providerReadinessFromHealth(healthInput);
  const localOpenAiConfigured =
    readiness.localOpenAi.configured ||
    hasConfiguredLocalOpenAiProvider(enhancementConfigs, promptRecipeDraftingConfig);
  const localOpenAiReady = readiness.localOpenAi.ready;

  return {
    health: readiness.health,
    codexLocal: {
      ...readiness.codexLocal,
    },
    openRouter: {
      ...readiness.openRouter,
    },
    localOpenAi: {
      configured: localOpenAiConfigured,
      ready: localOpenAiReady,
    },
    promptWorkflowsAvailable: readiness.openRouter.ready || localOpenAiReady || readiness.codexLocal.ready,
  };
}

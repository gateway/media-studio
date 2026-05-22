import { hasSavedEnhancementSystemPrompt } from "@/lib/studio-enhancement";
import type { MediaEnhancePreviewResponse, MediaEnhancementConfig } from "@/lib/types";

export function deriveStudioEnhancementState({
  modelKey,
  enhancementConfigs,
  enhancePreview,
}: {
  modelKey: string;
  enhancementConfigs: MediaEnhancementConfig[];
  enhancePreview: MediaEnhancePreviewResponse | null;
}) {
  const globalEnhancementConfig =
    enhancementConfigs.find((config) => config.model_key === "__studio_enhancement__") ??
    enhancementConfigs.find(
      (config) => Boolean(config.provider_model_id || (config.provider_kind && config.provider_kind !== "builtin")),
    ) ??
    null;
  const currentModelEnhancementConfig =
    enhancementConfigs.find((config) => config.model_key === modelKey) ?? null;
  const activeEnhancementEngineConfig =
    currentModelEnhancementConfig &&
    (Boolean(currentModelEnhancementConfig.provider_model_id) ||
      (currentModelEnhancementConfig.provider_kind && currentModelEnhancementConfig.provider_kind !== "builtin"))
      ? currentModelEnhancementConfig
      : globalEnhancementConfig;
  const enhanceSupportsText =
    currentModelEnhancementConfig && "supports_text_enhancement" in currentModelEnhancementConfig
      ? Boolean(currentModelEnhancementConfig.supports_text_enhancement)
      : Boolean(globalEnhancementConfig?.supports_text_enhancement);
  const enhanceSupportsImage =
    currentModelEnhancementConfig && "supports_image_analysis" in currentModelEnhancementConfig
      ? Boolean(currentModelEnhancementConfig.supports_image_analysis)
      : Boolean(globalEnhancementConfig?.supports_image_analysis);
  const enhanceEnabledForModel = enhanceSupportsText || enhanceSupportsImage;
  const enhanceHasSavedSystemPrompt = hasSavedEnhancementSystemPrompt(
    currentModelEnhancementConfig,
    globalEnhancementConfig,
  );
  const enhanceProviderKind = activeEnhancementEngineConfig?.provider_kind ?? "builtin";
  const enhanceCredentialConfigured = Boolean(
    activeEnhancementEngineConfig?.provider_credential_source || activeEnhancementEngineConfig?.provider_api_key_configured,
  );
  const enhanceBaseUrlConfigured = Boolean(activeEnhancementEngineConfig?.provider_base_url_configured);
  const enhanceModelSelected = Boolean(activeEnhancementEngineConfig?.provider_model_id);
  const enhanceConfiguredForModel =
    enhanceEnabledForModel &&
    (enhanceProviderKind === "openrouter"
      ? enhanceCredentialConfigured
      : enhanceProviderKind === "codex_local"
        ? enhanceModelSelected
      : enhanceProviderKind === "local_openai"
        ? enhanceBaseUrlConfigured || enhanceCredentialConfigured || enhanceModelSelected
        : false);
  const enhanceProviderLabel =
    enhancePreview?.provider_label ??
    activeEnhancementEngineConfig?.provider_label ??
    (activeEnhancementEngineConfig?.provider_kind === "openrouter"
      ? "OpenRouter.ai"
      : activeEnhancementEngineConfig?.provider_kind === "codex_local"
        ? "Codex Local"
      : activeEnhancementEngineConfig?.provider_kind === "local_openai"
        ? "Local OpenAI-Compatible"
        : "Media Studio default");
  const enhanceProviderModelId =
    enhancePreview?.provider_model_id ??
    activeEnhancementEngineConfig?.provider_model_id ??
    (activeEnhancementEngineConfig?.provider_kind === "openrouter" ? "qwen/qwen3.5-35b-a3b" : null);
  const enhanceImageAnalysisText = enhancePreview?.image_analysis
    ? typeof enhancePreview.image_analysis === "string"
      ? enhancePreview.image_analysis
      : String(
          (enhancePreview.image_analysis as Record<string, unknown>).analysis ??
            (enhancePreview.image_analysis as Record<string, unknown>).warning ??
            "No image analysis output returned.",
        )
    : null;
  const enhanceImageAnalysisStatus = enhancePreview?.image_analysis
    ? typeof enhancePreview.image_analysis === "string"
      ? "available"
      : String((enhancePreview.image_analysis as Record<string, unknown>).status ?? "available")
    : "Not checked";
  const enhanceModeLabel = enhanceSupportsText && enhanceSupportsImage ? "Prompt + image guidance" : enhanceSupportsImage ? "Image-guided only" : "Prompt only";
  const enhanceReadinessLabel = !enhanceEnabledForModel
    ? "Enhancement unavailable for this model"
    : !enhanceHasSavedSystemPrompt
      ? "Save an enhancement prompt in Models"
    : enhanceConfiguredForModel
      ? `${enhanceProviderLabel} ready`
      : "Set up enhancement in Settings";
  const enhanceHelperText = !enhanceEnabledForModel
    ? "This model does not have prompt enhancement enabled."
    : !enhanceHasSavedSystemPrompt
      ? "Save an enhancement system prompt for this model in Models before using Enhance."
    : enhanceConfiguredForModel
      ? `${enhanceModeLabel} with ${enhanceProviderLabel}${enhanceProviderModelId ? ` · ${enhanceProviderModelId}` : ""}.`
      : "Enhancement is available for this model, but it still needs provider setup in Settings.";

  return {
    currentModelEnhancementConfig,
    activeEnhancementEngineConfig,
    enhanceSupportsText,
    enhanceSupportsImage,
    enhanceEnabledForModel,
    enhanceHasSavedSystemPrompt,
    enhanceConfiguredForModel,
    enhanceSetupHref: "/settings#prompt-enhancement",
    enhanceProviderLabel,
    enhanceProviderModelId,
    enhanceImageAnalysisText,
    enhanceImageAnalysisStatus,
    enhanceModeLabel,
    enhanceReadinessLabel,
    enhanceHelperText,
  };
}

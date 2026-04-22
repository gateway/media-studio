import type { MediaEnhancementConfig } from "@/lib/types";

export function hasSavedEnhancementSystemPrompt(
  modelConfig: Pick<MediaEnhancementConfig, "system_prompt"> | null | undefined,
  globalConfig: Pick<MediaEnhancementConfig, "system_prompt"> | null | undefined,
) {
  const modelPrompt = (modelConfig?.system_prompt ?? "").trim();
  const globalPrompt = (globalConfig?.system_prompt ?? "").trim();
  return Boolean(modelPrompt || globalPrompt);
}

import { STUDIO_NANO_MAX_OUTPUTS } from "@/lib/media-studio-helpers";
import type {
  MediaEnhancementConfig,
  MediaEnhancementProviderModel,
  MediaModelQueuePolicy,
  MediaQueueSettings,
} from "@/lib/types";

export function upsertEnhancementConfigEntry(list: MediaEnhancementConfig[], config: MediaEnhancementConfig) {
  const next = list.filter((item) => item.model_key !== config.model_key);
  next.push(config);
  next.sort((left, right) => left.model_key.localeCompare(right.model_key));
  return next;
}

export function upsertQueuePolicyEntry(list: MediaModelQueuePolicy[], policy: MediaModelQueuePolicy) {
  const next = list.filter((item) => item.model_key !== policy.model_key);
  next.push(policy);
  next.sort((left, right) => left.model_key.localeCompare(right.model_key));
  return next;
}

export function parseSavedEnhancementConfig(
  result: { ok?: boolean; error?: string; config?: MediaEnhancementConfig } | (MediaEnhancementConfig & { ok?: boolean; error?: string }),
) {
  if ("config" in result && result.config) {
    return result.config;
  }
  if ("model_key" in result && typeof result.model_key === "string") {
    return result as MediaEnhancementConfig;
  }
  return null;
}

export async function saveEnhancementConfigRequest(args: {
  endpoint: string;
  method: "POST" | "PATCH";
  payload: Record<string, unknown>;
}) {
  const response = await fetch(args.endpoint, {
    method: args.method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args.payload),
  });
  const result = (await response.json()) as
    | { ok?: boolean; error?: string; config?: MediaEnhancementConfig }
    | (MediaEnhancementConfig & { ok?: boolean; error?: string });
  return {
    ok: response.ok && result.ok !== false,
    error: result.error,
    config: parseSavedEnhancementConfig(result),
  };
}

export async function probeEnhancementProviderRequest(payload: {
  provider_kind: "openrouter" | "local_openai";
  model_key: string;
  api_key: string | null;
  base_url: string | null;
  selected_model_id: string | null;
  require_images: boolean;
}) {
  const response = await fetch("/api/control/media-enhancement-providers/probe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = (await response.json()) as {
    ok?: boolean;
    error?: string;
    provider?: string;
    credential_source?: string | null;
    selected_model?: MediaEnhancementProviderModel | null;
    available_models?: MediaEnhancementProviderModel[];
  };
  return {
    ok: response.ok && result.ok !== false,
    error: result.error,
    credentialSource: result.credential_source ?? null,
    selectedModel: result.selected_model ?? null,
    availableModels: result.available_models ?? [],
  };
}

export async function openMediaOutputsFolderRequest() {
  const response = await fetch("/api/control/media-output-folder", { method: "POST" });
  const result = (await response.json()) as { ok?: boolean; error?: string };
  return {
    ok: response.ok && result.ok !== false,
    error: result.error,
  };
}

export async function saveGlobalQueueSettingsRequest(settings: MediaQueueSettings) {
  const response = await fetch("/api/control/media-queue-settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      max_concurrent_jobs: Math.max(1, settings.max_concurrent_jobs),
      queue_enabled: settings.queue_enabled,
      default_poll_seconds: Math.max(1, Number(settings.default_poll_seconds) || 1),
      max_retry_attempts: Math.max(1, Number(settings.max_retry_attempts) || 1),
    }),
  });
  const result = (await response.json()) as { ok?: boolean; error?: string; settings?: MediaQueueSettings };
  return {
    ok: response.ok && result.ok !== false && Boolean(result.settings),
    error: result.error,
    settings: result.settings ?? null,
  };
}

export async function saveModelQueuePolicyRequest(modelKey: string, enabled: boolean, maxOutputsPerRun: number) {
  const response = await fetch(`/api/control/media-queue-policies/${modelKey}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      enabled,
      max_outputs_per_run: Math.min(Math.max(1, maxOutputsPerRun), STUDIO_NANO_MAX_OUTPUTS),
    }),
  });
  const result = (await response.json()) as { ok?: boolean; error?: string; policy?: MediaModelQueuePolicy };
  return {
    ok: response.ok && result.ok !== false && Boolean(result.policy),
    error: result.error,
    policy: result.policy ?? null,
  };
}

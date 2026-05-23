export type SharedLlmProviderKind = "openrouter" | "local_openai" | "codex_local";
export type EnhancementProviderKind = SharedLlmProviderKind | "builtin";

type LlmProviderDescriptor = {
  kind: EnhancementProviderKind;
  label: string;
  shortLabel: string;
  summary: string;
  billingLabel: string;
  credentialLabel: string;
  supportsConnectionSetup: boolean;
};

const LLM_PROVIDER_DESCRIPTORS: Record<EnhancementProviderKind, LlmProviderDescriptor> = {
  builtin: {
    kind: "builtin",
    label: "Enhance Helper",
    shortLabel: "Enhance Helper",
    summary: "Use the built-in Enhance helper without connecting another AI service.",
    billingLabel: "Local helper profile",
    credentialLabel: "No external credentials",
    supportsConnectionSetup: false,
  },
  codex_local: {
    kind: "codex_local",
    label: "Codex Local",
    shortLabel: "Codex Local",
    summary: "Use Codex on this machine with the Codex or ChatGPT login that is already signed in.",
    billingLabel: "Included with your Codex or ChatGPT plan",
    credentialLabel: "Uses local Codex login",
    supportsConnectionSetup: true,
  },
  openrouter: {
    kind: "openrouter",
    label: "OpenRouter",
    shortLabel: "OpenRouter",
    summary: "Use hosted models through OpenRouter.",
    billingLabel: "Metered cloud provider",
    credentialLabel: "Uses OpenRouter API key",
    supportsConnectionSetup: true,
  },
  local_openai: {
    kind: "local_openai",
    label: "Local OpenAI-Compatible",
    shortLabel: "Local OpenAI",
    summary: "Use your own local or self-hosted server if it supports the OpenAI-style API.",
    billingLabel: "Self-hosted endpoint",
    credentialLabel: "Uses local endpoint URL and optional API key",
    supportsConnectionSetup: true,
  },
};

export function getLlmProviderDescriptor(kind: EnhancementProviderKind): LlmProviderDescriptor {
  return LLM_PROVIDER_DESCRIPTORS[kind];
}

export function llmProviderLabel(kind: EnhancementProviderKind | string | null | undefined) {
  if (!kind) return "Unknown provider";
  return LLM_PROVIDER_DESCRIPTORS[kind as EnhancementProviderKind]?.label ?? kind;
}

export function llmProviderShortLabel(kind: EnhancementProviderKind | string | null | undefined) {
  if (!kind) return "Unknown";
  return LLM_PROVIDER_DESCRIPTORS[kind as EnhancementProviderKind]?.shortLabel ?? kind;
}

export function llmProviderSummary(kind: EnhancementProviderKind | string | null | undefined) {
  if (!kind) return "Provider details are not available.";
  return LLM_PROVIDER_DESCRIPTORS[kind as EnhancementProviderKind]?.summary ?? "Provider details are not available.";
}

export function llmProviderBillingLabel(kind: EnhancementProviderKind | string | null | undefined) {
  if (!kind) return "Billing model unknown";
  return LLM_PROVIDER_DESCRIPTORS[kind as EnhancementProviderKind]?.billingLabel ?? "Billing model unknown";
}

export function llmProviderCredentialLabel(kind: EnhancementProviderKind | string | null | undefined) {
  if (!kind) return "Credential source unknown";
  return LLM_PROVIDER_DESCRIPTORS[kind as EnhancementProviderKind]?.credentialLabel ?? "Credential source unknown";
}

export function llmCredentialSourceLabel(source: string | null | undefined) {
  if (!source) return "Not configured";
  if (source === "codex_local_login") return "Uses local Codex login";
  if (source === "env") return "Uses environment configuration";
  if (source === "stored") return "Uses saved server configuration";
  return source;
}

export const SETTINGS_LLM_ROUTE = "/settings/llms";

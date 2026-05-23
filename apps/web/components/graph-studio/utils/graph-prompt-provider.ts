import type { GraphNodeField } from "../types";

const PROMPT_NODE_TYPES = new Set(["prompt.llm", "prompt.recipe"]);
const EXPLICIT_PROVIDER_KINDS = new Set(["openrouter", "codex_local", "local_openai"]);

type RuntimeHelp = {
  helpText: string;
  placeholder: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringField(value: unknown) {
  return String(value ?? "").trim();
}

function booleanField(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}

function isPromptNodeType(nodeType: string) {
  return PROMPT_NODE_TYPES.has(nodeType);
}

export function graphPromptProviderLabel(providerKind: string) {
  if (providerKind === "openrouter") return "OpenRouter";
  if (providerKind === "codex_local") return "Codex Local";
  if (providerKind === "local_openai") return "Local OpenAI";
  return "Prompt Enhance Default";
}

export function graphPromptProviderCapabilities(fields: Record<string, unknown>) {
  const value = fields.provider_capabilities_json;
  if (typeof value === "string" && value.trim()) {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return asRecord(value);
}

function promptProviderMetadataProvider(fields: Record<string, unknown>) {
  return stringField(graphPromptProviderCapabilities(fields).provider);
}

function promptProviderMetadataModelId(fields: Record<string, unknown>) {
  return stringField(graphPromptProviderCapabilities(fields).model_id);
}

export function graphNormalizePromptProviderFields(nodeType: string, fields: Record<string, unknown>) {
  if (!isPromptNodeType(nodeType)) return fields;
  const providerKind = stringField(fields.provider || "studio_default") || "studio_default";
  const modelId = stringField(fields.model_id);
  const metadataProvider = promptProviderMetadataProvider(fields);
  const metadataModelId = promptProviderMetadataModelId(fields);

  if (providerKind === "studio_default" && modelId) {
    return {
      ...fields,
      model_id: "",
      provider_model_label: "",
      provider_supports_images: null,
      provider_capabilities_json: {},
      model_supports_images: null,
    };
  }

  if (!modelId) {
    if (
      stringField(fields.provider_model_label) ||
      fields.provider_supports_images !== undefined ||
      fields.model_supports_images !== undefined ||
      Object.keys(graphPromptProviderCapabilities(fields)).length
    ) {
      return {
        ...fields,
        model_id: "",
        provider_model_label: "",
        provider_supports_images: null,
        provider_capabilities_json: {},
        model_supports_images: null,
      };
    }
    return fields;
  }

  if (metadataProvider && EXPLICIT_PROVIDER_KINDS.has(providerKind) && metadataProvider !== providerKind) {
    return {
      ...fields,
      model_id: "",
      provider_model_label: "",
      provider_supports_images: null,
      provider_capabilities_json: {},
      model_supports_images: null,
    };
  }

  if (metadataModelId && metadataModelId !== modelId) {
    return {
      ...fields,
      provider_model_label: "",
      provider_supports_images: null,
      provider_capabilities_json: {},
      model_supports_images: null,
    };
  }

  return fields;
}

export function graphPromptSavedModelLabel(fields: Record<string, unknown>, providerKind: string, modelId: string) {
  const metadata = graphPromptProviderCapabilities(fields);
  const metadataProvider = stringField(metadata.provider);
  const metadataModelId = stringField(metadata.model_id);
  if (metadataProvider && EXPLICIT_PROVIDER_KINDS.has(providerKind) && metadataProvider !== providerKind) {
    return `Saved model (${modelId})`;
  }
  if (metadataModelId && metadataModelId !== modelId) {
    return `Saved model (${modelId})`;
  }
  const metadataLabel = stringField(metadata.model_label);
  if (metadataLabel) return metadataLabel;
  const savedLabel = stringField(fields.provider_model_label);
  if (savedLabel) return savedLabel;
  return `Saved model (${modelId})`;
}

export function graphPromptSupportsImages(fields: Record<string, unknown>) {
  const metadata = graphPromptProviderCapabilities(fields);
  const metadataValue = booleanField(metadata.supports_images ?? metadata.supports_image_input);
  if (metadataValue != null) return metadataValue;
  const providerValue = booleanField(fields.provider_supports_images);
  if (providerValue != null) return providerValue;
  return booleanField(fields.model_supports_images);
}

export function graphPromptNodeHeaderSummary(nodeType: string, fields: Record<string, unknown>) {
  if (!isPromptNodeType(nodeType)) return null;
  const providerKind = stringField(fields.provider || "studio_default") || "studio_default";
  const pieces = [graphPromptProviderLabel(providerKind)];
  const modelId = stringField(fields.model_id);
  if (providerKind === "studio_default") {
    pieces.push("AI Settings");
  } else if (modelId) {
    pieces.push(graphPromptSavedModelLabel(fields, providerKind, modelId));
    const supportsImages = graphPromptSupportsImages(fields);
    if (supportsImages === true) pieces.push("Vision");
    if (supportsImages === false) pieces.push("Text");
  } else {
    pieces.push("Select a model");
  }
  return pieces.join(" • ");
}

export function graphPromptAdvancedSummary(nodeType: string, fields: Record<string, unknown>) {
  if (!isPromptNodeType(nodeType)) return "Advanced configuration.";
  const providerKind = stringField(fields.provider || "studio_default") || "studio_default";
  if (providerKind === "codex_local") {
    return "Provider, model, and Codex-managed runtime defaults.";
  }
  if (nodeType === "prompt.recipe") {
    return "Provider, model, and optional runtime overrides. Leave overrides blank to use recipe defaults.";
  }
  if (providerKind === "studio_default") {
    return "Provider, model, and optional runtime overrides. Leave overrides blank to use the Prompt Enhance default model from AI Settings.";
  }
  return "Provider, model, and optional runtime overrides. Leave overrides blank to use provider defaults.";
}

export function graphPromptRuntimeFieldOverride(
  nodeType: string,
  fields: Record<string, unknown>,
  field: GraphNodeField,
): RuntimeHelp | null {
  if (!isPromptNodeType(nodeType) || (field.id !== "temperature" && field.id !== "max_tokens")) {
    return null;
  }
  const providerKind = stringField(fields.provider || "studio_default") || "studio_default";
  if (field.id === "temperature") {
    if (providerKind === "codex_local") {
      return {
        placeholder: "Codex-managed",
        helpText: "Optional override. Codex Local currently uses provider-managed runtime defaults and ignores this field.",
      };
    }
    if (nodeType === "prompt.recipe") {
      return {
        placeholder: "Recipe default",
        helpText: "Optional override. Leave blank to use the recipe defaults when present, otherwise the provider defaults.",
      };
    }
    return {
      placeholder: providerKind === "studio_default" ? "Prompt Enhance default" : "Provider default",
      helpText: "Optional override. Leave blank to use the provider defaults.",
    };
  }
  if (providerKind === "codex_local") {
    return {
      placeholder: "Codex-managed",
      helpText: "Optional override. Codex Local currently uses provider-managed runtime defaults and ignores this field.",
    };
  }
  if (nodeType === "prompt.recipe") {
    return {
      placeholder: "Recipe default",
      helpText: "Optional override. Leave blank to use the recipe defaults when present, otherwise the provider defaults.",
    };
  }
  return {
    placeholder: providerKind === "studio_default" ? "Prompt Enhance default" : "Provider default",
    helpText: "Optional override. Leave blank to use the provider defaults.",
  };
}

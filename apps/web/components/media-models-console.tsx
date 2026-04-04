"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  adminThemeLayoutClassName,
  adminThemeLayoutOverflowClassName,
} from "@/components/admin-theme";
import {
  AdminButton,
  AdminField,
  AdminInput,
  AdminPillSelect,
  AdminTextarea,
  AdminToggle,
} from "@/components/admin-controls";
import { AdminActionNotice } from "@/components/admin-action-notice";
import {
  Box,
  Clapperboard,
  Clock3,
  FolderOpen,
  Frame,
  Image as ImageIcon,
  KeyRound,
  Music4,
  ScanSearch,
  PlugZap,
  Server,
  SlidersHorizontal,
  Sparkles,
  Monitor,
  Video,
} from "lucide-react";

import { CollapsibleSubsection } from "@/components/collapsible-sections";
import { Panel, PanelHeader } from "@/components/panel";
import { StatusPill } from "@/components/status-pill";
import { presetThumbnailVisual } from "@/lib/media-studio-helpers";
import type {
  LlmPreset,
  MediaEnhancementConfig,
  MediaEnhancementProviderModel,
  MediaModelQueuePolicy,
  MediaModelSummary,
  MediaPreset,
  MediaQueueSettings,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type MediaModelsConsoleProps = {
  models: MediaModelSummary[];
  presets: MediaPreset[];
  enhancementConfigs: MediaEnhancementConfig[];
  llmPresets: LlmPreset[];
  queueSettings?: MediaQueueSettings | null;
  queuePolicies?: MediaModelQueuePolicy[];
  initialSelectedModelKey?: string;
  variant?: "default" | "studio";
  sections?: {
    queue?: boolean;
    enhancementProvider?: boolean;
    modelHelper?: boolean;
    studioSettings?: boolean;
    modelPanel?: boolean;
    presets?: boolean;
  };
};

type SettingsChoice = {
  value: string;
  label: string;
};

type EnhancementFormState = {
  label: string;
  status: string;
  helperProfile: string;
  providerKind: "builtin" | "openrouter" | "local_openai";
  providerLabel: string;
  providerModelId: string;
  providerApiKey: string;
  providerApiKeyConfigured: boolean;
  providerApiKeyTouched: boolean;
  providerBaseUrl: string;
  providerBaseUrlConfigured: boolean;
  providerBaseUrlTouched: boolean;
  providerSupportsImages: boolean;
  providerStatus: string;
  providerLastTestedAt: string;
  providerCapabilities: Record<string, unknown>;
  providerCredentialSource: string;
  systemPrompt: string;
  imageAnalysisPrompt: string;
  supportsTextEnhancement: boolean;
  supportsImageAnalysis: boolean;
  notes: string;
};

type EnhancementProfileFormState = {
  label: string;
  status: string;
  systemPrompt: string;
  imageAnalysisPrompt: string;
  supportsTextEnhancement: boolean;
  supportsImageAnalysis: boolean;
  notes: string;
};

function emptyEnhancementForm(modelKey: string): EnhancementFormState {
  return {
    label: modelKey === GLOBAL_ENHANCEMENT_CONFIG_KEY ? "Studio enhancement" : `${modelKey} enhancement`,
    status: "active",
    helperProfile: "midctx-64k-no-thinking-q3-prefill",
    providerKind: "builtin",
    providerLabel: "",
    providerModelId: "",
    providerApiKey: "",
    providerApiKeyConfigured: false,
    providerApiKeyTouched: false,
    providerBaseUrl: "",
    providerBaseUrlConfigured: false,
    providerBaseUrlTouched: false,
    providerSupportsImages: false,
    providerStatus: "",
    providerLastTestedAt: "",
    providerCapabilities: {},
    providerCredentialSource: "",
    systemPrompt: "",
    imageAnalysisPrompt: "",
    supportsTextEnhancement: true,
    supportsImageAnalysis: false,
    notes: "",
  };
}

function emptyEnhancementProfileForm(modelKey: string): EnhancementProfileFormState {
  return {
    label: `${modelKey} enhancement`,
    status: "active",
    systemPrompt: "",
    imageAnalysisPrompt: "",
    supportsTextEnhancement: true,
    supportsImageAnalysis: false,
    notes: "",
  };
}

function capabilityTone(enabled: boolean) {
  return enabled ? "healthy" : "warning";
}

function isNanoBananaModel(modelKey: string | null | undefined) {
  return modelKey === "nano-banana-2" || modelKey === "nano-banana-pro";
}

function isMobileControlDevice() {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return false;
  }
  return (
    window.matchMedia?.("(pointer: coarse)").matches ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "")
  );
}

function presetFieldKeyToken(key: string) {
  return `{{${key}}}`;
}

function presetSlotKeyToken(key: string) {
  return `[[${key}]]`;
}

const MEDIA_OUTPUTS_PATH =
  process.env.NEXT_PUBLIC_MEDIA_STUDIO_OUTPUTS_PATH ||
  "data/outputs";
const DEFAULT_OPENROUTER_ENHANCEMENT_MODEL = "qwen/qwen3.5-35b-a3b";
const GLOBAL_ENHANCEMENT_CONFIG_KEY = "__studio_enhancement__";

function modelInputPills(model: MediaModelSummary | null) {
  const patterns = new Set(model?.input_patterns ?? []);
  const pills: Array<{ key: string; label: string; icon: typeof ImageIcon }> = [];
  const imageMax = Number((model?.image_inputs as Record<string, unknown> | undefined)?.required_max ?? 0);
  const videoMax = Number((model?.video_inputs as Record<string, unknown> | undefined)?.required_max ?? 0);
  const audioMax = Number((model?.audio_inputs as Record<string, unknown> | undefined)?.required_max ?? 0);
  if (imageMax > 0 || patterns.has("single_image") || patterns.has("first_last_frames") || patterns.has("image_edit")) {
    pills.push({ key: "image", label: "Image", icon: ImageIcon });
  }
  if (videoMax > 0 || patterns.has("motion_control")) {
    pills.push({ key: "video", label: "Video", icon: Video });
  }
  if (audioMax > 0) {
    pills.push({ key: "audio", label: "Audio", icon: Music4 });
  }
  if (!pills.length) {
    pills.push({ key: "none", label: "No inputs", icon: Box });
  }
  return pills;
}

function modelTaskModePills(model: MediaModelSummary | null) {
  return (model?.task_modes ?? []).map((taskMode) => ({
    key: taskMode,
    label:
      taskMode === "image_to_video"
        ? "Image to video"
        : taskMode === "text_to_video"
          ? "Text to video"
          : taskMode === "image_edit"
            ? "Image edit"
            : taskMode === "image_generation"
              ? "Image generation"
              : taskMode.replaceAll("_", " "),
  }));
}

function modelOptionPills(model: MediaModelSummary | null) {
  return Object.entries(model?.options ?? {}).map(([key]) => ({
    key,
    label:
      key === "duration"
        ? "Duration"
        : key === "sound"
          ? "Sound"
          : key === "aspect_ratio"
            ? "Aspect ratio"
            : key === "resolution"
              ? "Resolution"
              : key === "format"
                ? "File format"
                : key === "negative_prompt"
                  ? "Negative prompt"
                  : key.replaceAll("_", " "),
  }));
}

function modelOptionIcon(key: string) {
  if (key === "duration") {
    return Clock3;
  }
  if (key === "sound") {
    return Music4;
  }
  if (key === "aspect_ratio") {
    return Frame;
  }
  if (key === "resolution" || key === "format") {
    return Monitor;
  }
  if (key === "negative_prompt") {
    return ScanSearch;
  }
  return SlidersHorizontal;
}

function firstPresentRecord(...values: Array<Record<string, unknown> | null | undefined>) {
  for (const value of values) {
    if (value && typeof value === "object") {
      return value;
    }
  }
  return null;
}

function formatAllowed(value: unknown) {
  if (!Array.isArray(value) || !value.length) {
    return null;
  }
  return value.map((item) => String(item)).join(", ");
}

function modelParameterRows(model: MediaModelSummary | null) {
  if (!model) {
    return [];
  }
  const rows: Array<{ name: string; required: string; description: string; icon?: typeof SlidersHorizontal }> = [];
  const imageInputs = firstPresentRecord(model.image_inputs);
  const videoInputs = firstPresentRecord(model.video_inputs);
  const audioInputs = firstPresentRecord(model.audio_inputs);
  const inputConstraints = firstPresentRecord(model.input_constraints);
  const options = firstPresentRecord(model.options);
  const prompt = firstPresentRecord(model.prompt);

  const imageRequiredMax = Number(imageInputs?.required_max ?? 0);
  const imageRequiredMin = Number(imageInputs?.required_min ?? 0);
  const videoRequiredMax = Number(videoInputs?.required_max ?? 0);
  const videoRequiredMin = Number(videoInputs?.required_min ?? 0);
  const audioRequiredMax = Number(audioInputs?.required_max ?? 0);
  const audioRequiredMin = Number(audioInputs?.required_min ?? 0);

  if (imageRequiredMax > 0 || imageRequiredMin > 0) {
    const imageFormats = formatAllowed(inputConstraints?.image_formats);
    const imageMaxMb = inputConstraints?.image_max_mb ? `${inputConstraints.image_max_mb}MB max` : null;
    rows.push({
      name: imageRequiredMax > 1 ? "images" : "image",
      required: "Yes",
      description: [
        imageRequiredMin === imageRequiredMax
          ? `${imageRequiredMax} required`
          : `${imageRequiredMin}-${imageRequiredMax} required`,
        imageFormats ? `formats: ${imageFormats}` : null,
        imageMaxMb,
      ]
        .filter(Boolean)
        .join(" · "),
      icon: ImageIcon,
    });
  }

  if (videoRequiredMax > 0 || videoRequiredMin > 0) {
    const videoFormats = formatAllowed(inputConstraints?.video_formats);
    const videoMaxMb = inputConstraints?.video_max_mb ? `${inputConstraints.video_max_mb}MB max` : null;
    rows.push({
      name: videoRequiredMax > 1 ? "videos" : "video",
      required: "Yes",
      description: [
        videoRequiredMin === videoRequiredMax
          ? `${videoRequiredMax} required`
          : `${videoRequiredMin}-${videoRequiredMax} required`,
        videoFormats ? `formats: ${videoFormats}` : null,
        videoMaxMb,
      ]
        .filter(Boolean)
        .join(" · "),
      icon: Video,
    });
  }

  if (audioRequiredMax > 0 || audioRequiredMin > 0) {
    rows.push({
      name: audioRequiredMax > 1 ? "audio files" : "audio",
      required: "Yes",
      description:
        audioRequiredMin === audioRequiredMax
          ? `${audioRequiredMax} required`
          : `${audioRequiredMin}-${audioRequiredMax} required`,
      icon: Music4,
    });
  }

  if (prompt && prompt.required) {
    rows.push({
      name: "prompt",
      required: "Yes",
      description: [
        prompt.max_chars ? `${prompt.max_chars} characters max` : null,
        prompt.enhancement_supported ? "Enhance supported" : null,
      ]
        .filter(Boolean)
        .join(" · "),
      icon: Sparkles,
    });
  }

  for (const [key, option] of Object.entries(options ?? {})) {
    const optionRecord = option as Record<string, unknown>;
    const allowed = formatAllowed(optionRecord.allowed);
    const range =
      optionRecord.min !== null && optionRecord.min !== undefined && optionRecord.max !== null && optionRecord.max !== undefined
        ? `${optionRecord.min}-${optionRecord.max}`
        : null;
    const defaultValue =
      optionRecord.default !== null && optionRecord.default !== undefined && optionRecord.default !== ""
        ? `default: ${String(optionRecord.default)}`
        : null;
    const optionIcon = modelOptionIcon(key);
    rows.push({
      name: key,
      required: optionRecord.required ? "Yes" : "No",
      description: [allowed, range ? `range: ${range}` : null, defaultValue]
        .filter(Boolean)
        .join(" · "),
      icon: optionIcon,
    });
  }

  return rows;
}

function upsertEnhancementConfigEntry(list: MediaEnhancementConfig[], config: MediaEnhancementConfig) {
  const next = list.filter((item) => item.model_key !== config.model_key);
  next.push(config);
  next.sort((left, right) => left.model_key.localeCompare(right.model_key));
  return next;
}

function parseSavedEnhancementConfig(
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

export function MediaModelsConsole({
  models,
  presets,
  enhancementConfigs,
  llmPresets,
  queueSettings,
  queuePolicies = [],
  initialSelectedModelKey,
  variant = "default",
  sections,
}: MediaModelsConsoleProps) {
  const router = useRouter();
  const [selectedModelKey, setSelectedModelKey] = useState(initialSelectedModelKey ?? models[0]?.key ?? "nano-banana-2");
  const [selectedEnhancementModelKey, setSelectedEnhancementModelKey] = useState(models[0]?.key ?? "nano-banana-2");
  const [localPresets, setLocalPresets] = useState<MediaPreset[]>(presets);
  const [localEnhancementConfigs, setLocalEnhancementConfigs] = useState<MediaEnhancementConfig[]>(enhancementConfigs);
  const [enhancementForm, setEnhancementForm] = useState<EnhancementFormState>(emptyEnhancementForm(models[0]?.key ?? "nano-banana-2"));
  const [enhancementProfileForm, setEnhancementProfileForm] = useState<EnhancementProfileFormState>(
    emptyEnhancementProfileForm(models[0]?.key ?? "nano-banana-2"),
  );
  const [expandedPresetId, setExpandedPresetId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isProbingProvider, setIsProbingProvider] = useState(false);
  const [mobileControlDevice, setMobileControlDevice] = useState(false);
  const [openPicker, setOpenPicker] = useState<string | null>(null);
  const [localQueueSettings, setLocalQueueSettings] = useState<MediaQueueSettings | null>(queueSettings ?? null);
  const [localQueuePolicies, setLocalQueuePolicies] = useState<MediaModelQueuePolicy[]>(queuePolicies);
  const [openRouterCatalog, setOpenRouterCatalog] = useState<MediaEnhancementProviderModel[]>([]);
  const [localProviderCatalog, setLocalProviderCatalog] = useState<MediaEnhancementProviderModel[]>([]);
  const [openRouterModelQuery, setOpenRouterModelQuery] = useState("");
  const [message, setMessage] = useState<{ tone: "healthy" | "danger"; text: string } | null>(null);
  const hasAutoProbedOpenRouterRef = useRef(false);
  const presetListRef = useRef<HTMLDivElement | null>(null);
  const presetsSignature = useMemo(() => JSON.stringify(presets), [presets]);
  const enhancementConfigsSignature = useMemo(() => JSON.stringify(enhancementConfigs), [enhancementConfigs]);
  const queueSettingsSignature = useMemo(() => JSON.stringify(queueSettings ?? null), [queueSettings]);
  const queuePoliciesSignature = useMemo(() => JSON.stringify(queuePolicies), [queuePolicies]);

  const selectedModel = models.find((model) => model.key === selectedModelKey) ?? models[0] ?? null;
  const globalEnhancementConfig =
    localEnhancementConfigs.find((config) => config.model_key === GLOBAL_ENHANCEMENT_CONFIG_KEY) ??
    localEnhancementConfigs.find(
      (config) =>
        (config.provider_model_id || (config.provider_kind && config.provider_kind !== "builtin")),
    ) ??
    null;
  const currentModelEnhancementConfig =
    localEnhancementConfigs.find((config) => config.model_key === selectedEnhancementModelKey) ?? null;
  const helperPreset = llmPresets.find((preset) => preset.profile === globalEnhancementConfig?.helper_profile) ?? null;
  const currentQueuePolicy = localQueuePolicies.find((policy) => policy.model_key === selectedModelKey) ?? null;
  const filteredOpenRouterCatalog = useMemo(() => {
    const query = openRouterModelQuery.trim().toLowerCase();
    const multimodalModels = openRouterCatalog.filter((model) => model.supports_images);
    if (!query) {
      return multimodalModels;
    }
    return multimodalModels.filter((model) => {
      const haystack = `${model.label} ${model.id}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [openRouterCatalog, openRouterModelQuery]);
  const modelPresets = useMemo(
    () =>
      localPresets.filter((preset) => {
        if (preset.source_kind === "builtin") {
          return false;
        }
        if (preset.applies_to_models?.length) {
          return preset.applies_to_models.includes(selectedModelKey);
        }
        return preset.model_key === selectedModelKey;
      }),
    [localPresets, selectedModelKey],
  );
  const presetsEnabledForModel = isNanoBananaModel(selectedModelKey);
  const isStudio = variant === "studio";
  const visibleSections = {
    queue: sections?.queue ?? true,
    enhancementProvider: sections?.enhancementProvider ?? true,
    modelHelper: sections?.modelHelper ?? true,
    studioSettings: sections?.studioSettings ?? true,
    modelPanel: sections?.modelPanel ?? true,
    presets: sections?.presets ?? true,
  };
  const acceptedInputs = useMemo(() => modelInputPills(selectedModel), [selectedModel]);
  const parameterRows = useMemo(() => modelParameterRows(selectedModel), [selectedModel]);
  const optionBadges = useMemo(() => modelOptionPills(selectedModel), [selectedModel]);
  const rootClassName = isStudio ? adminThemeLayoutOverflowClassName : adminThemeLayoutClassName;
  const modelPanelClassName = "border-white/10 bg-[linear-gradient(180deg,rgba(24,28,26,0.96),rgba(14,17,16,0.98))]";
  const surfaceCardClassName = "rounded-[22px] border border-white/8 bg-[rgba(11,14,13,0.92)] p-5";
  const accentCardClassName = "rounded-[24px] border border-white/10 bg-[rgba(11,14,13,0.94)] p-5";
  const softAccentCardClassName =
    "rounded-[22px] border border-white/10 bg-[rgba(255,255,255,0.05)] px-4 py-4 text-sm leading-7 text-[var(--muted-strong)]";
  const toggleOffClassName = "border-white/10 bg-[rgba(255,255,255,0.04)] text-white/68";
  const toggleOnClassName = "border-[rgba(208,255,72,0.28)] bg-[rgba(208,255,72,0.12)] text-[rgba(208,255,72,0.94)]";

  useEffect(() => {
    if (!initialSelectedModelKey) {
      return;
    }
    if (!models.some((model) => model.key === initialSelectedModelKey)) {
      return;
    }
    setSelectedModelKey(initialSelectedModelKey);
  }, [initialSelectedModelKey, models]);

  useEffect(() => {
    setSelectedEnhancementModelKey(selectedModelKey);
  }, [selectedModelKey]);

  useEffect(() => {
    setLocalPresets((current) => (JSON.stringify(current) === presetsSignature ? current : presets));
  }, [presets, presetsSignature]);

  useEffect(() => {
    setLocalEnhancementConfigs((current) =>
      JSON.stringify(current) === enhancementConfigsSignature ? current : enhancementConfigs,
    );
  }, [enhancementConfigs, enhancementConfigsSignature]);

  useEffect(() => {
    setLocalQueueSettings((current) =>
      JSON.stringify(current) === queueSettingsSignature ? current : (queueSettings ?? null),
    );
  }, [queueSettings, queueSettingsSignature]);

  useEffect(() => {
    setLocalQueuePolicies((current) => (JSON.stringify(current) === queuePoliciesSignature ? current : queuePolicies));
  }, [queuePolicies, queuePoliciesSignature]);

  useEffect(() => {
    setMobileControlDevice(isMobileControlDevice());
  }, []);

  useEffect(() => {
    if (globalEnhancementConfig) {
      setEnhancementForm({
        label: globalEnhancementConfig.label,
        status: globalEnhancementConfig.status,
        helperProfile: globalEnhancementConfig.helper_profile,
        providerKind: (globalEnhancementConfig.provider_kind as EnhancementFormState["providerKind"]) ?? "builtin",
        providerLabel: globalEnhancementConfig.provider_label ?? "",
        providerModelId: globalEnhancementConfig.provider_model_id ?? "",
        providerApiKey: "",
        providerApiKeyConfigured: Boolean(globalEnhancementConfig.provider_api_key_configured),
        providerApiKeyTouched: false,
        providerBaseUrl: "",
        providerBaseUrlConfigured: Boolean(globalEnhancementConfig.provider_base_url_configured),
        providerBaseUrlTouched: false,
        providerSupportsImages: globalEnhancementConfig.provider_supports_images ?? false,
        providerStatus: globalEnhancementConfig.provider_status ?? "",
        providerLastTestedAt: globalEnhancementConfig.provider_last_tested_at ?? "",
        providerCapabilities: globalEnhancementConfig.provider_capabilities_json ?? {},
        providerCredentialSource: globalEnhancementConfig.provider_credential_source ?? "",
        systemPrompt: globalEnhancementConfig.system_prompt,
        imageAnalysisPrompt: globalEnhancementConfig.image_analysis_prompt ?? "",
        supportsTextEnhancement: globalEnhancementConfig.supports_text_enhancement,
        supportsImageAnalysis: globalEnhancementConfig.supports_image_analysis,
        notes: globalEnhancementConfig.notes ?? "",
      });
    } else {
      setEnhancementForm(emptyEnhancementForm(GLOBAL_ENHANCEMENT_CONFIG_KEY));
    }
  }, [globalEnhancementConfig]);

  useEffect(() => {
    if (currentModelEnhancementConfig) {
      setEnhancementProfileForm({
        label: currentModelEnhancementConfig.label ?? `${selectedEnhancementModelKey} enhancement`,
        status: currentModelEnhancementConfig.status ?? "active",
        systemPrompt: currentModelEnhancementConfig.system_prompt ?? "",
        imageAnalysisPrompt: currentModelEnhancementConfig.image_analysis_prompt ?? "",
        supportsTextEnhancement: currentModelEnhancementConfig.supports_text_enhancement,
        supportsImageAnalysis: currentModelEnhancementConfig.supports_image_analysis,
        notes: currentModelEnhancementConfig.notes ?? "",
      });
    } else {
      setEnhancementProfileForm(emptyEnhancementProfileForm(selectedEnhancementModelKey));
    }
    setExpandedPresetId(null);
    setMessage(null);
  }, [currentModelEnhancementConfig, selectedEnhancementModelKey]);

  useEffect(() => {
    if (enhancementForm.providerKind !== "openrouter") {
      hasAutoProbedOpenRouterRef.current = false;
      return;
    }
    if (hasAutoProbedOpenRouterRef.current || isProbingProvider) {
      return;
    }
    if (openRouterCatalog.length && enhancementForm.providerModelId) {
      return;
    }
    hasAutoProbedOpenRouterRef.current = true;
    void probeEnhancementProvider("openrouter", true);
  }, [enhancementForm.providerKind, enhancementForm.providerModelId, isProbingProvider, openRouterCatalog.length]);

  useEffect(() => {
    if (!message) {
      return;
    }
    const timeoutId = window.setTimeout(() => setMessage(null), 2400);
    return () => window.clearTimeout(timeoutId);
  }, [message]);

  async function saveEnhancementConfig() {
    setIsSaving(true);
    const payload: Record<string, unknown> = {
      model_key: GLOBAL_ENHANCEMENT_CONFIG_KEY,
      label: enhancementForm.label,
      status: enhancementForm.status,
      helper_profile: enhancementForm.helperProfile,
      provider_kind: enhancementForm.providerKind,
      provider_label: enhancementForm.providerLabel || null,
      provider_model_id: enhancementForm.providerModelId || null,
      provider_supports_images: enhancementForm.providerSupportsImages,
      provider_status: enhancementForm.providerStatus || null,
      provider_last_tested_at: enhancementForm.providerLastTestedAt || null,
      provider_capabilities_json: enhancementForm.providerCapabilities,
      system_prompt: enhancementForm.systemPrompt,
      image_analysis_prompt: enhancementForm.imageAnalysisPrompt || null,
      supports_text_enhancement: enhancementForm.supportsTextEnhancement,
      supports_image_analysis: enhancementForm.supportsImageAnalysis,
      notes: enhancementForm.notes || null,
    };
    if (enhancementForm.providerApiKeyTouched) {
      payload.provider_api_key = enhancementForm.providerApiKey || null;
    }
    if (enhancementForm.providerBaseUrlTouched) {
      payload.provider_base_url = enhancementForm.providerBaseUrl || null;
    }
    const endpoint = globalEnhancementConfig
      ? `/api/control/media-enhancement-configs/${GLOBAL_ENHANCEMENT_CONFIG_KEY}`
      : "/api/control/media-enhancement-configs";
    const method = globalEnhancementConfig ? "PATCH" : "POST";
    const response = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json()) as { ok?: boolean; error?: string; config?: MediaEnhancementConfig } | (MediaEnhancementConfig & { ok?: boolean; error?: string });
    if (!response.ok || result.ok === false) {
      setIsSaving(false);
      setMessage({ tone: "danger", text: result.error ?? "Unable to save the enhancement config." });
      return;
    }
    const savedConfig = parseSavedEnhancementConfig(result);
    if (savedConfig) {
      setLocalEnhancementConfigs((current) => upsertEnhancementConfigEntry(current, savedConfig));
    }
    setIsSaving(false);
    setMessage({ tone: "healthy", text: "Provider settings saved." });
  }

  async function saveModelEnhancementProfile() {
    setIsSaving(true);
    const existingConfig = localEnhancementConfigs.find((config) => config.model_key === selectedEnhancementModelKey) ?? null;
    const payload = {
      model_key: selectedEnhancementModelKey,
      label: enhancementProfileForm.label || `${selectedEnhancementModelKey} enhancement`,
      status: enhancementProfileForm.status,
      helper_profile: existingConfig?.helper_profile ?? enhancementForm.helperProfile ?? "midctx-64k-no-thinking-q3-prefill",
      provider_kind: existingConfig?.provider_kind ?? "builtin",
      provider_label: existingConfig?.provider_label ?? null,
      provider_model_id: existingConfig?.provider_model_id ?? null,
      provider_supports_images: existingConfig?.provider_supports_images ?? false,
      provider_status: existingConfig?.provider_status ?? null,
      provider_last_tested_at: existingConfig?.provider_last_tested_at ?? null,
      provider_capabilities_json: existingConfig?.provider_capabilities_json ?? {},
      system_prompt: enhancementProfileForm.systemPrompt,
      image_analysis_prompt: enhancementProfileForm.imageAnalysisPrompt || null,
      supports_text_enhancement: enhancementProfileForm.supportsTextEnhancement,
      supports_image_analysis: enhancementProfileForm.supportsImageAnalysis,
      notes: enhancementProfileForm.notes || null,
    };
    const endpoint = existingConfig
      ? `/api/control/media-enhancement-configs/${selectedEnhancementModelKey}`
      : "/api/control/media-enhancement-configs";
    const method = existingConfig ? "PATCH" : "POST";
    const response = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json()) as { ok?: boolean; error?: string; config?: MediaEnhancementConfig } | (MediaEnhancementConfig & { ok?: boolean; error?: string });
    setIsSaving(false);
    const savedConfig = parseSavedEnhancementConfig(result);
    if (!response.ok || result.ok === false || !savedConfig) {
      setMessage({ tone: "danger", text: result.error ?? "Unable to save the model enhancement profile." });
      return;
    }
    setLocalEnhancementConfigs((current) => upsertEnhancementConfigEntry(current, savedConfig));
    setMessage({ tone: "healthy", text: `Model helper saved for ${selectedEnhancementModelKey}.` });
  }

  async function probeEnhancementProvider(providerKind: "openrouter" | "local_openai", silent = false) {
    setIsProbingProvider(true);
    if (!silent) {
      setMessage(null);
    }
    const payload = {
      provider_kind: providerKind,
      model_key: GLOBAL_ENHANCEMENT_CONFIG_KEY,
      api_key: enhancementForm.providerApiKey || null,
      base_url:
        providerKind === "local_openai"
          ? enhancementForm.providerBaseUrl || null
          : enhancementForm.providerBaseUrl || null,
      selected_model_id: enhancementForm.providerModelId || null,
      require_images: enhancementForm.supportsImageAnalysis,
    };
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
    setIsProbingProvider(false);
    if (!response.ok || result.ok === false) {
      if (!silent) {
        setMessage({ tone: "danger", text: result.error ?? "Unable to connect to the enhancement provider." });
      }
      return;
    }
    const catalog = result.available_models ?? [];
    if (providerKind === "openrouter") {
      setOpenRouterCatalog(catalog);
    } else {
      setLocalProviderCatalog(catalog);
    }
    const recommendedModel =
      result.selected_model ??
      (providerKind === "openrouter"
        ? catalog.find((item) => item.id === DEFAULT_OPENROUTER_ENHANCEMENT_MODEL) ?? null
        : null);
    setEnhancementForm((current) => ({
      ...current,
      providerKind,
      providerLabel: recommendedModel?.label ?? current.providerLabel,
      providerModelId: recommendedModel?.id ?? current.providerModelId,
      providerSupportsImages: recommendedModel?.supports_images ?? false,
      providerStatus: "connected",
      providerLastTestedAt: new Date().toISOString(),
      providerCapabilities: recommendedModel?.raw ?? {},
      providerCredentialSource: result.credential_source ?? "",
      providerApiKeyConfigured: current.providerApiKeyConfigured || Boolean(result.credential_source),
      providerBaseUrlConfigured: current.providerBaseUrlConfigured || Boolean(current.providerBaseUrl),
    }));
    if (!silent) {
      setMessage({
        tone: "healthy",
        text: result.selected_model
          ? `Connected to ${providerKind === "openrouter" ? "OpenRouter" : "the local provider"} using ${result.selected_model.label}.`
          : `Connected to ${providerKind === "openrouter" ? "OpenRouter" : "the local provider"}.`,
      });
    }
  }

  async function openMediaOutputsFolder() {
    setMessage(null);
    const response = await fetch("/api/control/media-output-folder", { method: "POST" });
    const result = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || result.ok === false) {
      setMessage({ tone: "danger", text: result.error ?? "Unable to open the media outputs folder." });
      return;
    }
    setMessage({ tone: "healthy", text: "Media output folder opened." });
  }

  async function saveGlobalQueueSettings(settings: MediaQueueSettings) {
    setIsSaving(true);
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
    setIsSaving(false);
    if (!response.ok || result.ok === false || !result.settings) {
      setMessage({ tone: "danger", text: result.error ?? "Unable to update the queue settings." });
      return;
    }
    setLocalQueueSettings(result.settings);
    setMessage({ tone: "healthy", text: "Queue settings saved." });
  }

  async function saveModelQueuePolicy(maxOutputsPerRun: number) {
    const clampedValue = Math.min(Math.max(1, maxOutputsPerRun), 3);
    setIsSaving(true);
    const response = await fetch(`/api/control/media-queue-policies/${selectedModelKey}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ max_outputs_per_run: clampedValue }),
    });
    const result = (await response.json()) as { ok?: boolean; error?: string; policy?: MediaModelQueuePolicy };
    setIsSaving(false);
    if (!response.ok || result.ok === false || !result.policy) {
      setMessage({ tone: "danger", text: result.error ?? "Unable to update the model queue policy." });
      return;
    }
    setLocalQueuePolicies((current) => {
      const next = current.filter((entry) => entry.model_key !== result.policy?.model_key);
      next.push(result.policy as MediaModelQueuePolicy);
      return next.sort((left, right) => left.model_key.localeCompare(right.model_key));
    });
    setMessage({ tone: "healthy", text: "Model settings saved." });
  }

  function renderSelect(
    pickerId: string,
    value: string,
    onChange: (value: string) => void,
    options: SettingsChoice[],
  ) {
    const isOpen = openPicker === pickerId;
    return (
      <AdminPillSelect
        open={isOpen}
        onToggle={() => setOpenPicker(isOpen ? null : pickerId)}
        value={value}
        choices={options}
        onSelect={(nextValue) => {
          onChange(nextValue);
          setOpenPicker(null);
        }}
      />
    );
  }

  return (
    <div className={rootClassName}>
      {message ? <AdminActionNotice tone={message.tone} text={message.text} /> : null}
      {message ? (
        <div
          className={cn(
            "sr-only rounded-[20px] border px-4 py-3 text-sm shadow-[var(--shadow-soft)]",
            message.tone === "healthy"
              ? "border-[rgba(81,136,111,0.18)] bg-[rgba(81,136,111,0.08)] text-[var(--success)]"
              : "border-[rgba(175,79,64,0.18)] bg-[rgba(175,79,64,0.08)] text-[var(--danger)]",
          )}
        >
          {message.text}
        </div>
      ) : null}

      {visibleSections.queue ? (
      <Panel>
        <PanelHeader
          eyebrow="Queue"
          title="Queue Settings"
          description="Control how many jobs Studio can run at once and how often it checks for updates."
        />
        <div className="mt-5 max-w-[980px]">
          <div className="rounded-[24px] border border-white/8 bg-[rgba(12,15,14,0.94)] px-5 py-5">
            <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[var(--muted-strong)]">
              <SlidersHorizontal className="size-3.5" />
              Job Runner
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StatusPill label={localQueueSettings?.queue_enabled ? "Running" : "Paused"} tone={localQueueSettings?.queue_enabled ? "healthy" : "warning"} />
            </div>
            <div className="mt-4 max-w-[760px] text-sm leading-7 text-[var(--muted-strong)]">
              Keep Studio processing queued generations in the background so new work starts automatically as space frees up.
            </div>
            <div className="mt-5 grid max-w-[760px] gap-3 border-t border-[var(--surface-border-soft)] pt-5">
              <label className="flex max-w-[280px] items-center justify-between gap-3 rounded-[16px] border border-white/10 bg-[rgba(11,14,13,0.94)] px-3 py-3 text-sm">
                <span className="font-medium text-[var(--foreground)]">Run jobs automatically</span>
                <AdminToggle
                  checked={localQueueSettings?.queue_enabled ?? true}
                  ariaLabel="Run jobs automatically"
                  onToggle={() =>
                    setLocalQueueSettings((current) => ({
                      max_concurrent_jobs: current?.max_concurrent_jobs ?? 10,
                      queue_enabled: !(current?.queue_enabled ?? true),
                      default_poll_seconds: current?.default_poll_seconds ?? 6,
                      max_retry_attempts: current?.max_retry_attempts ?? 3,
                      created_at: current?.created_at ?? null,
                      updated_at: current?.updated_at ?? null,
                    }))
                  }
                />
              </label>
              <div className="grid gap-3 lg:grid-cols-[minmax(0,280px)_minmax(0,220px)] lg:items-end">
                <AdminField label="Jobs running at once">
                  <AdminInput
                    type="number"
                    min={1}
                    step={1}
                    value={String(localQueueSettings?.max_concurrent_jobs ?? 10)}
                    onChange={(event) => setLocalQueueSettings((current) => ({
                      max_concurrent_jobs: Math.max(1, Number(event.target.value) || 1),
                      queue_enabled: current?.queue_enabled ?? true,
                      default_poll_seconds: current?.default_poll_seconds ?? 6,
                      max_retry_attempts: current?.max_retry_attempts ?? 3,
                      created_at: current?.created_at ?? null,
                      updated_at: current?.updated_at ?? null,
                    }))}
                    className=""
                  />
                </AdminField>
              </div>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,220px)_minmax(0,220px)]">
                <AdminField label="Check every">
                  <AdminInput
                    type="number"
                    min={1}
                    step={1}
                    value={String(Math.max(1, Number(localQueueSettings?.default_poll_seconds ?? 6)))}
                    onChange={(event) =>
                      setLocalQueueSettings((current) => ({
                        max_concurrent_jobs: current?.max_concurrent_jobs ?? 10,
                        queue_enabled: current?.queue_enabled ?? true,
                        default_poll_seconds: Math.max(1, Number(event.target.value) || 1),
                        max_retry_attempts: current?.max_retry_attempts ?? 3,
                        created_at: current?.created_at ?? null,
                        updated_at: current?.updated_at ?? null,
                      }))
                    }
                    className=""
                  />
                </AdminField>
                <AdminField label="Retry limit">
                  <AdminInput
                    type="number"
                    min={1}
                    step={1}
                    value={String(Math.max(1, Number(localQueueSettings?.max_retry_attempts ?? 3)))}
                    onChange={(event) =>
                      setLocalQueueSettings((current) => ({
                        max_concurrent_jobs: current?.max_concurrent_jobs ?? 10,
                        queue_enabled: current?.queue_enabled ?? true,
                        default_poll_seconds: current?.default_poll_seconds ?? 6,
                        max_retry_attempts: Math.max(1, Number(event.target.value) || 1),
                        created_at: current?.created_at ?? null,
                        updated_at: current?.updated_at ?? null,
                      }))
                    }
                    className=""
                  />
                </AdminField>
              </div>
              <div className="mt-1 flex flex-wrap gap-3">
                <AdminButton
                  onClick={() =>
                    void saveGlobalQueueSettings({
                      max_concurrent_jobs: localQueueSettings?.max_concurrent_jobs ?? 10,
                      queue_enabled: localQueueSettings?.queue_enabled ?? true,
                      default_poll_seconds: localQueueSettings?.default_poll_seconds ?? 6,
                      max_retry_attempts: localQueueSettings?.max_retry_attempts ?? 3,
                      created_at: localQueueSettings?.created_at ?? null,
                      updated_at: localQueueSettings?.updated_at ?? null,
                    })
                  }
                  disabled={isSaving}
                  size="compact"
                >
                  Save
                </AdminButton>
              </div>
            </div>
          </div>
        </div>
      </Panel>
      ) : null}

      {visibleSections.enhancementProvider ? (
      <Panel>
        <PanelHeader
          eyebrow="Enhancement Model"
          title="Prompt Enhancement"
          description="Choose the shared provider and model that powers Enhance across Studio."
        />
        <div className="mt-5 max-w-[980px]">
          <div className="grid gap-4">
            <CollapsibleSubsection
              title="Prompt Enhancement Provider"
              description="Pick the provider and model that powers prompt enhancement across Studio."
              tone="media"
              defaultOpen={false}
              className="px-5 py-5 border-white/8 bg-[rgba(12,15,14,0.94)]"
              summaryClassName="flex-col items-start gap-3 sm:flex-row sm:items-center"
              titleClassName="text-[0.78rem] tracking-[0.16em]"
              descriptionClassName="max-w-3xl"
              bodyClassName="border-t border-[var(--surface-border-soft)] pt-5"
            >
              <div className="max-w-[760px] text-sm leading-7 text-[var(--muted-strong)]">
                <div>
                  Current provider: <span className="font-medium text-[var(--foreground)]">{enhancementForm.providerKind === "openrouter" ? "OpenRouter" : enhancementForm.providerKind === "local_openai" ? "Local OpenAI-Compatible" : "Built-in helper"}</span>
                </div>
                <div className="mt-2">
                  {enhancementForm.providerKind === "openrouter"
                    ? "Use OpenRouter to choose a hosted model that can understand both text and images."
                    : enhancementForm.providerKind === "local_openai"
                      ? "Use a local OpenAI-compatible server if you want enhancement to run on your own machine or network."
                      : helperPreset
                        ? `${helperPreset.label} exposes prompt enhancement ${helperPreset.supports_prompt_enhancement ? "on" : "off"} and image support ${helperPreset.supports_images ? "on" : "off"}.`
                        : "Built-in helper mode is enabled. You can switch to OpenRouter or a local provider below."}
                </div>
              </div>
              <div className="mt-4 grid gap-3">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,280px)_minmax(0,320px)] lg:items-start">
                  <label className="flex items-center justify-between gap-3 rounded-[16px] border border-white/10 bg-[rgba(11,14,13,0.94)] px-3 py-3 text-sm">
                    <span>Enable Enhance</span>
                    <AdminToggle
                      checked={enhancementForm.status !== "inactive"}
                      ariaLabel="Enable Enhance"
                      onToggle={() =>
                        setEnhancementForm((current) => ({
                          ...current,
                          status: current.status === "inactive" ? "active" : "inactive",
                        }))
                      }
                    />
                  </label>
                  {renderSelect(
                    "enhancement-provider-kind",
                    enhancementForm.providerKind,
                    (value) =>
                      setEnhancementForm((current) => ({
                        ...current,
                        providerKind: value as EnhancementFormState["providerKind"],
                        providerStatus: "",
                      })),
                    [
                      { value: "openrouter", label: "OpenRouter.ai" },
                      { value: "local_openai", label: "Local OpenAI-Compatible" },
                    ],
                  )}
                </div>
                {enhancementForm.providerKind === "openrouter" ? (
                  <div className="grid gap-3">
                    <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[var(--muted-strong)]">
                      <KeyRound className="size-3.5" />
                      OpenRouter.ai
                    </div>
                    <div className="max-w-[760px] text-sm leading-6 text-[var(--muted-strong)]">
                      {enhancementForm.providerCredentialSource === "env"
                        ? "Using OPENROUTER_API_KEY from .env."
                        : enhancementForm.providerCredentialSource === "stored"
                          ? "Using the saved provider key on the server."
                          : "Add an OpenRouter API key here or in .env."}
                      {enhancementForm.providerModelId ? ` Selected model: ${enhancementForm.providerModelId}.` : ""}
                    </div>
                    {enhancementForm.providerApiKeyConfigured ? (
                      <div className="max-w-[760px] text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted-strong)]">
                        A provider key is already stored. Leave the field blank to keep it, or enter a new key to replace it.
                      </div>
                    ) : null}
                    <div className="grid max-w-[760px] gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                      <AdminInput
                        value={enhancementForm.providerApiKey}
                        onChange={(event) =>
                          setEnhancementForm((current) => ({
                            ...current,
                            providerApiKey: event.target.value,
                            providerApiKeyTouched: true,
                          }))
                        }
                        placeholder={
                          enhancementForm.providerCredentialSource === "env"
                            ? "Using OPENROUTER_API_KEY from .env"
                            : enhancementForm.providerApiKeyConfigured
                              ? "Stored on the server. Enter a new key to replace it."
                              : "OpenRouter API key"
                        }
                        className=""
                        type="password"
                      />
                      <AdminButton
                        onClick={() => void probeEnhancementProvider("openrouter")}
                        disabled={isProbingProvider}
                        variant="primary"
                        size="compact"
                        className="justify-self-start"
                      >
                        {isProbingProvider ? "Checking..." : "Connect"}
                      </AdminButton>
                    </div>
                    <div className="grid max-w-[760px] gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                      <AdminInput
                        value={enhancementForm.providerBaseUrl}
                        onChange={(event) =>
                          setEnhancementForm((current) => ({
                            ...current,
                            providerBaseUrl: event.target.value,
                            providerBaseUrlTouched: true,
                          }))
                        }
                        placeholder={
                          enhancementForm.providerBaseUrlConfigured
                            ? "Stored on the server. Enter a new base URL to replace it."
                            : "https://openrouter.ai/api/v1"
                        }
                        className=""
                      />
                      <AdminInput
                        value={openRouterModelQuery}
                        onChange={(event) => setOpenRouterModelQuery(event.target.value)}
                        placeholder="Search image-aware OpenRouter models"
                        className=""
                      />
                    </div>
                    <div className="grid max-w-[760px] gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                      {renderSelect(
                        "enhancement-openrouter-model",
                        enhancementForm.providerModelId,
                        (value) => {
                          const selected = openRouterCatalog.find((item) => item.id === value) ?? null;
                          setEnhancementForm((current) => ({
                            ...current,
                            providerModelId: value,
                            providerLabel: selected?.label ?? current.providerLabel,
                            providerSupportsImages: selected?.supports_images ?? false,
                            providerCapabilities: (selected?.raw as Record<string, unknown>) ?? current.providerCapabilities,
                          }));
                        },
                        [
                          { value: "", label: "Choose an OpenRouter model" },
                          ...filteredOpenRouterCatalog.map((model) => ({
                            value: model.id,
                            label: `${model.label}${model.supports_images ? " · multimodal" : ""}`,
                          })),
                        ],
                      )}
                      <div className="self-center text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted-strong)]">
                        {filteredOpenRouterCatalog.length} image-ready models
                      </div>
                    </div>
                  </div>
                ) : null}
                {enhancementForm.providerKind === "local_openai" ? (
                  <div className="grid gap-3">
                    <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[var(--muted-strong)]">
                      <Server className="size-3.5" />
                        Local OpenAI-Compatible
                      </div>
                    <div className="grid max-w-[760px] gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                      <AdminInput
                        value={enhancementForm.providerBaseUrl}
                        onChange={(event) =>
                          setEnhancementForm((current) => ({
                            ...current,
                            providerBaseUrl: event.target.value,
                            providerBaseUrlTouched: true,
                          }))
                        }
                        placeholder={
                          enhancementForm.providerBaseUrlConfigured
                            ? "Stored on the server. Enter a new base URL to replace it."
                            : "http://127.0.0.1:8080/v1"
                        }
                        className=""
                      />
                      <AdminInput
                        value={enhancementForm.providerApiKey}
                        onChange={(event) =>
                          setEnhancementForm((current) => ({
                            ...current,
                            providerApiKey: event.target.value,
                            providerApiKeyTouched: true,
                          }))
                        }
                        placeholder={
                          enhancementForm.providerApiKeyConfigured
                            ? "Stored on the server. Enter a new key to replace it."
                            : "Optional API key"
                        }
                        className=""
                      />
                      <AdminButton
                        onClick={() => void probeEnhancementProvider("local_openai")}
                        disabled={isProbingProvider}
                        variant="primary"
                        size="compact"
                        className="justify-self-start"
                      >
                        {isProbingProvider ? "Checking..." : "Test endpoint"}
                      </AdminButton>
                    </div>
                    <div className="grid max-w-[760px] gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                      {renderSelect(
                        "enhancement-local-model",
                        enhancementForm.providerModelId,
                        (value) => {
                          const selected = localProviderCatalog.find((item) => item.id === value) ?? null;
                          setEnhancementForm((current) => ({
                            ...current,
                            providerModelId: value,
                            providerLabel: selected?.label ?? current.providerLabel,
                            providerSupportsImages: selected?.supports_images ?? false,
                            providerCapabilities: (selected?.raw as Record<string, unknown>) ?? current.providerCapabilities,
                          }));
                        },
                        [
                          { value: "", label: "Choose a local model" },
                          ...localProviderCatalog.map((model) => ({
                            value: model.id,
                            label: `${model.label}${model.supports_images ? " · multimodal" : ""}`,
                          })),
                        ],
                      )}
                      <div className="self-center text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted-strong)]">
                        {enhancementForm.providerSupportsImages ? "Image-ready" : "Text only"}
                      </div>
                    </div>
                  </div>
                ) : null}
                {enhancementForm.providerKind === "builtin" ? (
                  <div className="grid max-w-[520px] gap-3">
                    <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[var(--muted-strong)]">
                      <PlugZap className="size-3.5" />
                      Built-in helper
                    </div>
                    <AdminInput
                      value={enhancementForm.helperProfile}
                      onChange={(event) => setEnhancementForm((current) => ({ ...current, helperProfile: event.target.value }))}
                      placeholder="Helper profile"
                      className=""
                    />
                  </div>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-3">
                  <AdminButton onClick={() => void saveEnhancementConfig()}>
                    Save provider settings
                  </AdminButton>
                </div>
              </div>
            </CollapsibleSubsection>
          </div>
        </div>
      </Panel>
      ) : null}
      {visibleSections.studioSettings ? (
      <Panel>
        <PanelHeader
          eyebrow="Studio Settings"
          title="Media Output Folder"
          description="Open the folder where Media Studio saves finished files on this machine."
        />
        <div className={cn(surfaceCardClassName, "mt-5")}>
          <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[var(--muted-strong)]">
            <FolderOpen className="size-3.5" />
            Media output folder
          </div>
          <div className="mt-3">
            <AdminInput value={MEDIA_OUTPUTS_PATH} readOnly className="text-white/72" />
          </div>
          <div className="mt-3 text-sm leading-6 text-[var(--muted-strong)]">
            This opens the local output folder on the current machine. It is useful while working locally and is not meant for mobile control.
          </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <AdminButton
                onClick={() => void openMediaOutputsFolder()}
                disabled={mobileControlDevice}
                size="compact"
                className="disabled:cursor-not-allowed disabled:opacity-55"
              >
                Open
              </AdminButton>
          </div>
        </div>
      </Panel>
      ) : null}

      {visibleSections.modelPanel ? (
      <Panel className={modelPanelClassName}>
        <PanelHeader
          eyebrow="Supported Models"
          title="Model Setup"
          description="Choose one model, then review what it accepts, how operators use it, and how Studio is configured for it."
        />
        <div className="mt-5 max-w-full sm:max-w-[340px]">
          <label className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted-strong)]">Model</span>
            {renderSelect(
              "supported-model",
              selectedModelKey,
              (value) => setSelectedModelKey(value),
              models.map((model) => ({ value: model.key, label: model.label })),
            )}
          </label>
        </div>
        <div className="mt-4 max-w-[780px] text-sm leading-7 text-[var(--muted-strong)]">
          Everything below belongs to <span className="font-medium text-[var(--foreground)]">{selectedModel?.label ?? selectedModelKey}</span>, so you can review the model, decide how many outputs it can create at once, and tune how Enhance rewrites prompts for it.
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] lg:items-start">
          <div>
            <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[var(--muted-strong)]">
              <Sparkles className="size-3.5 text-[rgba(208,255,72,0.94)]" />
              Parameters
            </div>
            <div className="mt-3 overflow-hidden">
              {parameterRows.length ? (
                <div className="grid">
                  <div className="grid grid-cols-[minmax(0,0.9fr)_80px_minmax(0,1.6fr)] gap-4 border-b border-white/8 px-3 py-3 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-[var(--muted-strong)]">
                    <div>Parameter</div>
                    <div>Required</div>
                    <div>Description</div>
                  </div>
                  {parameterRows.slice(0, 8).map((row) => {
                    const Icon = row.icon ?? SlidersHorizontal;
                    return (
                      <div
                        key={`${selectedModelKey}-parameter-${row.name}`}
                        className="grid grid-cols-[minmax(0,0.9fr)_80px_minmax(0,1.6fr)] gap-4 border-b border-white/8 px-3 py-3 text-sm last:border-b-0"
                      >
                        <div className="flex items-center gap-2 text-[var(--foreground)]">
                          <Icon className="size-3.5 shrink-0 text-[rgba(208,255,72,0.94)]" />
                          <span className="truncate font-medium">{row.name}</span>
                        </div>
                        <div className="text-white/82">{row.required}</div>
                        <div className="text-[var(--muted-strong)]">{row.description}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="px-3 py-3 text-sm leading-7 text-[var(--muted-strong)]">No published capability details.</div>
              )}
            </div>
          </div>
          <div className={surfaceCardClassName}>
            <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[var(--muted-strong)]">
              <Clapperboard className="size-3.5" />
              Output Limit
            </div>
            <div className="mt-3 text-sm leading-6 text-[var(--muted-strong)]">
              Set how many results this model can create in one run. Studio caps this at 3 so a single request cannot overload the queue.
            </div>
            <div className="mt-4 flex flex-nowrap items-end gap-3">
              <AdminField label="Outputs per run" className="w-[156px] shrink-0">
                <AdminInput
                  type="number"
                  min={1}
                  max={3}
                  step={1}
                  value={String(currentQueuePolicy?.max_outputs_per_run ?? (isNanoBananaModel(selectedModelKey) ? 3 : 1))}
                  onChange={(event) => {
                    const nextValue = Math.min(
                      Math.max(1, Number(event.target.value) || 1),
                      3,
                    );
                    setLocalQueuePolicies((current) => {
                      const next = current.filter((entry) => entry.model_key !== selectedModelKey);
                      next.push({
                        model_key: selectedModelKey,
                        enabled: true,
                        max_outputs_per_run: nextValue,
                        created_at: currentQueuePolicy?.created_at ?? null,
                        updated_at: currentQueuePolicy?.updated_at ?? null,
                      });
                      return next.sort((left, right) => left.model_key.localeCompare(right.model_key));
                    });
                  }}
                  className=""
                />
              </AdminField>
              <div className="shrink-0 pb-[1px]">
                <AdminButton
                  onClick={() => void saveModelQueuePolicy(currentQueuePolicy?.max_outputs_per_run ?? (isNanoBananaModel(selectedModelKey) ? 3 : 1))}
                  disabled={isSaving}
                  size="compact"
                >
                  Save
                </AdminButton>
              </div>
            </div>
          </div>
        </div>
      </Panel>
      ) : null}

      {visibleSections.modelHelper ? (
      <Panel>
        <PanelHeader
          eyebrow="System Prompt"
          title="System Prompt"
          description="Define how Enhance should rewrite prompts for the selected model."
        />
        <div className="mt-5">
          <CollapsibleSubsection
            title="Prompt Instructions"
            description="Use this section to teach Enhance how prompts should be rewritten for this model so the final prompt matches how the model performs best."
            tone="media"
            defaultOpen={false}
            className="px-5 py-5 border-white/8 bg-[rgba(12,15,14,0.94)]"
            summaryClassName="flex-col items-start gap-3 sm:flex-row sm:items-center"
            titleClassName="text-[0.78rem] tracking-[0.16em]"
            descriptionClassName="max-w-3xl"
            bodyClassName="border-t border-[var(--surface-border-soft)] pt-5"
          >
            <div className="grid max-w-[860px] gap-2">
              <div className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[var(--muted-strong)]">Prompt rewrite instructions</div>
              <div className="text-sm leading-6 text-[var(--muted-strong)]">
                Add the system prompt you want to use for this model, based on the model specs, research, and prompt guides you trust. Use <span className="font-medium text-[var(--foreground)]">{"{user_prompt}"}</span> anywhere you want Studio to inject the operator&apos;s prompt before it is sent to the LLM for prompt enhancement.
              </div>
              <AdminTextarea
                value={enhancementProfileForm.systemPrompt}
                onChange={(event) => setEnhancementProfileForm((current) => ({ ...current, systemPrompt: event.target.value }))}
                placeholder="Explain how prompts should be rewritten for this model."
                className="min-h-[160px]"
              />
            </div>
            <div className="mt-4 grid max-w-[860px] gap-2">
              <div className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[var(--muted-strong)]">Image understanding instructions</div>
              <div className="text-sm leading-6 text-[var(--muted-strong)]">
                Explain how an attached image should be read and combined with the written prompt when building the final prompt.
              </div>
              <AdminTextarea
                value={enhancementProfileForm.imageAnalysisPrompt}
                onChange={(event) => setEnhancementProfileForm((current) => ({ ...current, imageAnalysisPrompt: event.target.value }))}
                placeholder="Explain how the image should be interpreted for this model."
                className="min-h-[96px]"
              />
            </div>
            <div className="mt-4 grid max-w-[860px] gap-3 lg:grid-cols-2">
              <label className="flex items-center justify-between gap-3 rounded-[16px] border border-white/10 bg-[rgba(11,14,13,0.94)] px-3 py-3 text-sm">
                <span>Rewrite prompts for this model</span>
                <AdminToggle
                  checked={enhancementProfileForm.supportsTextEnhancement}
                  ariaLabel="Rewrite prompts for this model"
                  onToggle={() =>
                    setEnhancementProfileForm((current) => ({
                      ...current,
                      supportsTextEnhancement: !current.supportsTextEnhancement,
                    }))
                  }
                />
              </label>
              <label className="flex items-center justify-between gap-3 rounded-[16px] border border-white/10 bg-[rgba(11,14,13,0.94)] px-3 py-3 text-sm">
                <span>Use attached images to guide enhancement</span>
                <AdminToggle
                  checked={enhancementProfileForm.supportsImageAnalysis}
                  ariaLabel="Use attached images during enhancement"
                  onToggle={() =>
                    setEnhancementProfileForm((current) => ({
                      ...current,
                      supportsImageAnalysis: !current.supportsImageAnalysis,
                    }))
                  }
                />
              </label>
            </div>
            <div className="mt-4 max-w-[860px]">
              <AdminTextarea
                value={enhancementProfileForm.notes}
                onChange={(event) => setEnhancementProfileForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Optional notes for this model"
                className="min-h-[84px]"
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <AdminButton onClick={() => void saveModelEnhancementProfile()}>
                Save system prompt
              </AdminButton>
            </div>
          </CollapsibleSubsection>
        </div>
      </Panel>
      ) : null}


      {visibleSections.presets && presetsEnabledForModel ? (
      <Panel>
        <PanelHeader
          eyebrow="Presets"
          title="Structured Presets"
          description="These presets appear in the Studio composer for Nano Banana models and guide operators through a repeatable setup."
          action={(
            <AdminButton onClick={() => router.push(`/models/presets/new?model=${encodeURIComponent(selectedModelKey)}`)}>
              New Preset
            </AdminButton>
          )}
        />
        <div className="mt-5 grid gap-4">
          <div className={softAccentCardClassName}>
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">Prompt placeholder rules</div>
            <p className="mt-2">
              Use <span className="font-medium text-[var(--foreground)]">{"{{field_key}}"}</span> for text fields and{" "}
              <span className="font-medium text-[var(--foreground)]">{"[[image_slot_key]]"}</span> for image slots. A preset cannot save
              unless every configured field and slot appears in the prompt, and no unused fields remain.
            </p>
          </div>

          <div ref={presetListRef} className="grid gap-3">
            {modelPresets.length ? (
              modelPresets.map((preset) => (
                <CollapsibleSubsection
                  key={preset.preset_id}
                  title={preset.label}
                  description={preset.description ?? "Add a short description so operators know what this preset is for."}
                  tone="media"
                  defaultOpen={expandedPresetId === preset.preset_id}
                  open={expandedPresetId === preset.preset_id}
                  onOpenChange={(open) => setExpandedPresetId(open ? preset.preset_id : null)}
                  className="px-4 py-4 border-white/8 bg-[rgba(12,15,14,0.94)]"
                  summaryClassName="flex-col items-start gap-3 sm:flex-row sm:items-start"
                  titleClassName="text-[0.88rem] tracking-[0.06em] normal-case text-[var(--foreground)]"
                  descriptionClassName="max-w-3xl"
                  bodyClassName="border-t border-[var(--surface-border-soft)] pt-4"
                  badge={(
                    <AdminButton onClick={() => router.push(`/models/presets/${encodeURIComponent(preset.preset_id)}`)}>
                      Edit
                    </AdminButton>
                  )}
                >
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
                    <div className="grid gap-3">
                      {presetThumbnailVisual(preset) ? (
                        <div className="h-28 w-28 overflow-hidden rounded-[18px] border border-white/10 bg-[rgba(255,255,255,0.05)]">
                          <img src={presetThumbnailVisual(preset) ?? ""} alt={preset.label} className="h-full w-full object-cover" />
                        </div>
                      ) : null}
                      <div className="grid gap-2 text-sm leading-6">
                        <div>
                          <div className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-[var(--muted-strong)]">Preset key</div>
                          <div className="text-[var(--foreground)]">{preset.key}</div>
                        </div>
                        <div>
                          <div className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-[var(--muted-strong)]">Status</div>
                          <div className="text-[var(--foreground)]">{preset.status === "active" ? "Enabled" : "Disabled"}</div>
                        </div>
                        <div>
                          <div className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-[var(--muted-strong)]">Available in</div>
                          <div className="text-[var(--foreground)]">
                            {(preset.applies_to_models?.length ? preset.applies_to_models : (preset.model_key ? [preset.model_key] : []))
                              .map((value) => value === "nano-banana-pro" ? "Nano Banana Pro" : value === "nano-banana-2" ? "Nano Banana 2" : value)
                              .join(", ") || "No model scope"}
                          </div>
                        </div>
                        <div>
                          <div className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-[var(--muted-strong)]">Inputs</div>
                          <div className="text-[var(--foreground)]">
                            {`${preset.input_schema_json?.length ?? 0} text field${(preset.input_schema_json?.length ?? 0) === 1 ? "" : "s"} · ${preset.input_slots_json?.length ?? 0} image slot${(preset.input_slots_json?.length ?? 0) === 1 ? "" : "s"}`}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-4">
                      {preset.input_schema_json?.length ? (
                        <div className="grid gap-2">
                          <div className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[var(--muted-strong)]">Text fields</div>
                          <div className="grid gap-2">
                            {preset.input_schema_json.map((field, index) => {
                              const item = field as Record<string, unknown>;
                              return (
                                <div key={`${preset.preset_id}-field-${String(item.key ?? index)}`} className="rounded-[14px] border border-white/8 bg-[rgba(255,255,255,0.03)] px-3 py-2.5 text-sm leading-6">
                                  <div className="text-[var(--foreground)]">{String(item.label ?? item.key ?? `Field ${index + 1}`)}</div>
                                  <div className="text-[var(--muted-strong)]">{presetFieldKeyToken(String(item.key ?? ""))}</div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                      {preset.input_slots_json?.length ? (
                        <div className="grid gap-2">
                          <div className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[var(--muted-strong)]">Image slots</div>
                          <div className="grid gap-2">
                            {preset.input_slots_json.map((slot, index) => {
                              const item = slot as Record<string, unknown>;
                              return (
                                <div key={`${preset.preset_id}-slot-${String(item.key ?? index)}`} className="rounded-[14px] border border-white/8 bg-[rgba(255,255,255,0.03)] px-3 py-2.5 text-sm leading-6">
                                  <div className="text-[var(--foreground)]">{String(item.label ?? item.key ?? `Slot ${index + 1}`)}</div>
                                  <div className="text-[var(--muted-strong)]">{presetSlotKeyToken(String(item.key ?? ""))}</div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                      <div className="grid gap-2">
                        <div className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[var(--muted-strong)]">Prompt template</div>
                        <pre className="whitespace-pre-wrap rounded-[18px] border border-white/8 bg-[rgba(255,255,255,0.04)] px-3 py-3 text-xs leading-6 text-[var(--muted-strong)]">
                          {preset.prompt_template || "No prompt configured yet."}
                        </pre>
                      </div>
                    </div>
                  </div>
                </CollapsibleSubsection>
              ))
            ) : (
              <div className="rounded-[22px] border border-dashed border-white/10 bg-[rgba(255,255,255,0.03)] px-4 py-4 text-sm leading-7 text-[var(--muted-strong)]">
                No presets are associated with this model yet.
              </div>
            )}
          </div>

        </div>
      </Panel>
      ) : null}

      {isSaving ? <div className="text-xs uppercase tracking-[0.12em] text-[var(--muted-strong)]">Saving model media settings...</div> : null}
    </div>
  );
}

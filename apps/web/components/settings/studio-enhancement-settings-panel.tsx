"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KeyRound, PlugZap, Server, Sparkles } from "lucide-react";

import { AdminActionNotice } from "@/components/admin-action-notice";
import {
  AdminButton,
  AdminField,
  AdminInput,
  AdminSelect,
  AdminToggle,
} from "@/components/admin-controls";
import { Panel, PanelHeader } from "@/components/panel";
import { SharedLlmProviderIntroCard, SharedLlmProviderSection } from "@/components/shared-llm-provider-sections";
import { useAdminActionNotice } from "@/hooks/use-admin-action-notice";
import { useSharedProviderModelCatalog } from "@/hooks/use-shared-provider-model-catalog";
import {
  probeEnhancementProviderRequest,
  saveEnhancementConfigRequest,
  upsertEnhancementConfigEntry,
} from "@/lib/media-model-admin";
import type { MediaEnhancementConfig, MediaEnhancementProviderModel } from "@/lib/types";
import {
  filterProviderModels,
  providerCatalogSearchPlaceholder,
  providerModelCapabilities,
  providerModelChoices,
  providerModelFallback,
  resolveSelectedProviderModel,
  sharedProviderKindOptions,
} from "@/lib/llm-provider-models";
import {
  llmProviderBillingLabel,
  llmProviderLabel,
  llmProviderSummary,
  type EnhancementProviderKind,
  type SharedLlmProviderKind,
} from "@/lib/llm-provider-metadata";

const DEFAULT_OPENROUTER_ENHANCEMENT_MODEL = "qwen/qwen3.5-35b-a3b";
const GLOBAL_ENHANCEMENT_CONFIG_KEY = "__studio_enhancement__";
const DEFAULT_HELPER_PROFILE = "midctx-64k-no-thinking-q3-prefill";

type EnhancementFormState = {
  label: string;
  status: string;
  helperProfile: string;
  providerKind: EnhancementProviderKind;
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

function emptyEnhancementForm(): EnhancementFormState {
  return {
    label: "Studio enhancement",
    status: "active",
    helperProfile: DEFAULT_HELPER_PROFILE,
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

function formFromConfig(config: MediaEnhancementConfig | null): EnhancementFormState {
  if (!config) {
    return emptyEnhancementForm();
  }
  return {
    label: config.label,
    status: config.status,
    helperProfile: config.helper_profile,
    providerKind: (config.provider_kind as EnhancementProviderKind) ?? "builtin",
    providerLabel: config.provider_label ?? "",
    providerModelId: config.provider_model_id ?? "",
    providerApiKey: "",
    providerApiKeyConfigured: Boolean(config.provider_api_key_configured),
    providerApiKeyTouched: false,
    providerBaseUrl: "",
    providerBaseUrlConfigured: Boolean(config.provider_base_url_configured),
    providerBaseUrlTouched: false,
    providerSupportsImages: config.provider_supports_images ?? false,
    providerStatus: config.provider_status ?? "",
    providerLastTestedAt: config.provider_last_tested_at ?? "",
    providerCapabilities: config.provider_capabilities_json ?? {},
    providerCredentialSource: config.provider_credential_source ?? "",
    systemPrompt: config.system_prompt,
    imageAnalysisPrompt: config.image_analysis_prompt ?? "",
    supportsTextEnhancement: config.supports_text_enhancement,
    supportsImageAnalysis: config.supports_image_analysis,
    notes: config.notes ?? "",
  };
}

export function StudioEnhancementSettingsPanel({
  initialConfigs,
  embedded = false,
}: {
  initialConfigs: MediaEnhancementConfig[];
  embedded?: boolean;
}) {
  const [configs, setConfigs] = useState(initialConfigs);
  const [form, setForm] = useState<EnhancementFormState>(() => {
    const globalConfig =
      initialConfigs.find((config) => config.model_key === GLOBAL_ENHANCEMENT_CONFIG_KEY) ??
      initialConfigs.find((config) => (config.provider_model_id || (config.provider_kind && config.provider_kind !== "builtin"))) ??
      null;
    return formFromConfig(globalConfig);
  });
  const [isSaving, setIsSaving] = useState(false);
  const [manualProbeKind, setManualProbeKind] = useState<SharedLlmProviderKind | null>(null);
  const [openPicker, setOpenPicker] = useState<string | null>(null);
  const [openRouterModelQuery, setOpenRouterModelQuery] = useState("");
  const { notice, showNotice, clearNotice } = useAdminActionNotice();
  const probeSharedProviderCatalog = useCallback(
    (payload: {
      provider_kind: SharedLlmProviderKind;
      provider_model_id: string | null;
      provider_base_url: string | null;
      require_images: boolean;
    }) =>
      probeEnhancementProviderRequest({
        provider_kind: payload.provider_kind,
        model_key: GLOBAL_ENHANCEMENT_CONFIG_KEY,
        api_key: payload.provider_kind === "codex_local" ? null : (form.providerApiKey || null),
        base_url: payload.provider_kind === "codex_local" ? null : payload.provider_base_url,
        selected_model_id: payload.provider_model_id,
        require_images: payload.require_images,
      }),
    [form.providerApiKey],
  );
  const { catalogs, loadProviderCatalog } = useSharedProviderModelCatalog({
    probeRequest: probeSharedProviderCatalog,
  });
  const autoProbeSignatureRef = useRef<string | null>(null);
  const activeSharedProviderKind: SharedLlmProviderKind | null =
    form.providerKind === "openrouter" || form.providerKind === "codex_local" || form.providerKind === "local_openai"
      ? form.providerKind
      : null;
  const activeCatalogEntry = activeSharedProviderKind ? catalogs[activeSharedProviderKind] : undefined;
  const isAutoLoadingCatalog = activeCatalogEntry?.status === "loading" && manualProbeKind == null;

  const globalConfig = useMemo(
    () =>
      configs.find((config) => config.model_key === GLOBAL_ENHANCEMENT_CONFIG_KEY) ??
      configs.find((config) => (config.provider_model_id || (config.provider_kind && config.provider_kind !== "builtin"))) ??
      null,
    [configs],
  );

  useEffect(() => {
    setConfigs((current) => (JSON.stringify(current) === JSON.stringify(initialConfigs) ? current : initialConfigs));
  }, [initialConfigs]);

  useEffect(() => {
    setForm(formFromConfig(globalConfig));
  }, [globalConfig]);

  const filteredOpenRouterCatalog = useMemo(() => {
    return filterProviderModels("openrouter", catalogs.openrouter?.availableModels ?? [], openRouterModelQuery, {
      requireImages: true,
    });
  }, [catalogs.openrouter?.availableModels, openRouterModelQuery]);

  function catalogWithFallback(
    providerKind: SharedLlmProviderKind,
    models: MediaEnhancementProviderModel[],
  ) {
    const selectedModelId = String(form.providerModelId || "").trim();
    if (!selectedModelId || models.some((item) => item.id === selectedModelId)) {
      return models;
    }
    return [
      providerModelFallback({
        providerKind,
        modelId: selectedModelId,
        label: form.providerLabel || selectedModelId,
        supportsImages: Boolean(form.providerSupportsImages),
      }),
      ...models,
    ];
  }

  const visibleOpenRouterCatalog = useMemo(
    () => catalogWithFallback("openrouter", filteredOpenRouterCatalog),
    [filteredOpenRouterCatalog, form.providerLabel, form.providerModelId, form.providerSupportsImages],
  );
  const visibleCodexLocalCatalog = useMemo(
    () => catalogWithFallback("codex_local", catalogs.codex_local?.availableModels ?? []),
    [catalogs.codex_local?.availableModels, form.providerLabel, form.providerModelId, form.providerSupportsImages],
  );
  const visibleLocalOpenAiCatalog = useMemo(
    () => catalogWithFallback("local_openai", catalogs.local_openai?.availableModels ?? []),
    [catalogs.local_openai?.availableModels, form.providerLabel, form.providerModelId, form.providerSupportsImages],
  );

  useEffect(() => {
    if (form.providerKind === "builtin") {
      autoProbeSignatureRef.current = null;
      return;
    }
    if (isAutoLoadingCatalog || manualProbeKind) {
      return;
    }
    const autoProbeBaseUrl =
      form.providerKind === "local_openai"
        ? (form.providerBaseUrl.trim() || (form.providerBaseUrlConfigured ? "__stored__" : ""))
        : "";
    const canAutoProbe =
      form.providerKind === "openrouter" ||
      form.providerKind === "codex_local" ||
      (form.providerKind === "local_openai" && autoProbeBaseUrl.length > 0);
    if (!canAutoProbe) {
      autoProbeSignatureRef.current = null;
      return;
    }
    const nextSignature = JSON.stringify({
      providerKind: form.providerKind,
      baseUrl: autoProbeBaseUrl,
      requireImages: form.supportsImageAnalysis,
    });
    if (autoProbeSignatureRef.current === nextSignature) {
      return;
    }
    autoProbeSignatureRef.current = nextSignature;
    void probeProvider(form.providerKind as SharedLlmProviderKind, true);
  }, [
    form.providerBaseUrl,
    form.providerBaseUrlConfigured,
    form.providerKind,
    form.supportsImageAnalysis,
    isAutoLoadingCatalog,
    manualProbeKind,
  ]);

  function renderSelect(
    pickerId: string,
    value: string,
    onChange: (value: string) => void,
    choices: Array<{ value: string; label: string }>,
  ) {
    const isOpen = openPicker === pickerId;
    return (
      <AdminSelect
        pickerId={pickerId}
        open={isOpen}
        onToggle={() => setOpenPicker(isOpen ? null : pickerId)}
        value={value}
        choices={choices}
        onSelect={(nextValue) => {
          onChange(nextValue);
          setOpenPicker(null);
        }}
      />
    );
  }

  async function saveConfig() {
    setIsSaving(true);
    const payload: Record<string, unknown> = {
      model_key: GLOBAL_ENHANCEMENT_CONFIG_KEY,
      label: form.label,
      status: form.status,
      helper_profile: form.helperProfile,
      provider_kind: form.providerKind,
      provider_label: form.providerLabel || null,
      provider_model_id: form.providerModelId || null,
      provider_supports_images: form.providerSupportsImages,
      provider_status: form.providerStatus || null,
      provider_last_tested_at: form.providerLastTestedAt || null,
      provider_capabilities_json: form.providerCapabilities,
      system_prompt: form.systemPrompt,
      image_analysis_prompt: form.imageAnalysisPrompt || null,
      supports_text_enhancement: form.supportsTextEnhancement,
      supports_image_analysis: form.supportsImageAnalysis,
      notes: form.notes || null,
    };
    if (form.providerApiKeyTouched) {
      payload.provider_api_key = form.providerApiKey || null;
    }
    if (form.providerBaseUrlTouched) {
      payload.provider_base_url = form.providerBaseUrl || null;
    }
    const endpoint = globalConfig
      ? `/api/control/media-enhancement-configs/${GLOBAL_ENHANCEMENT_CONFIG_KEY}`
      : "/api/control/media-enhancement-configs";
    const method = globalConfig ? "PATCH" : "POST";
    const result = await saveEnhancementConfigRequest({ endpoint, method, payload });
    setIsSaving(false);
    if (!result.ok) {
      showNotice("danger", result.error ?? "Could not save your Enhance defaults.");
      return;
    }
    if (result.config) {
      const savedConfig = result.config;
      setConfigs((current) => upsertEnhancementConfigEntry(current, savedConfig));
    }
    showNotice("healthy", "Enhance defaults saved.");
  }

  async function probeProvider(providerKind: SharedLlmProviderKind, silent = false) {
    if (!silent) {
      setManualProbeKind(providerKind);
      clearNotice();
    }
    try {
      const result = await loadProviderCatalog(providerKind, {
        selectedModelId: form.providerModelId || null,
        providerBaseUrl: providerKind === "codex_local" ? null : (form.providerBaseUrl || null),
        requireImages: form.supportsImageAnalysis,
        force: !silent,
      });
      if (!result.ok) {
        if (!silent) {
          showNotice("danger", result.error ?? "Could not load models for this provider.");
        }
        return;
      }
      const catalog = result.availableModels ?? [];
      const selected = resolveSelectedProviderModel(providerKind, catalog, {
        selectedModel: result.selectedModel,
        selectedModelId: form.providerModelId || null,
        preferredModelId: providerKind === "openrouter" ? DEFAULT_OPENROUTER_ENHANCEMENT_MODEL : null,
      });
      setForm((current) => ({
        ...current,
        providerKind,
        providerLabel: selected?.label ?? current.providerLabel,
        providerModelId: selected?.id ?? current.providerModelId,
        providerSupportsImages: Boolean(selected?.supports_images),
        providerStatus: "connected",
        providerLastTestedAt: new Date().toISOString(),
        providerCapabilities: selected ? providerModelCapabilities(selected) : current.providerCapabilities,
        providerCredentialSource: result.credentialSource ?? "",
        providerApiKeyConfigured:
          providerKind === "codex_local"
            ? false
            : current.providerApiKeyConfigured || Boolean(result.credentialSource),
        providerBaseUrlConfigured:
          providerKind === "codex_local"
            ? false
            : current.providerBaseUrlConfigured || Boolean(current.providerBaseUrl),
      }));
      if (!silent) {
        showNotice(
          "healthy",
          selected
            ? `${llmProviderLabel(providerKind)} is ready. Using ${selected.label}.`
            : `${llmProviderLabel(providerKind)} is ready.`,
        );
      }
    } finally {
      if (!silent) {
        setManualProbeKind(null);
      }
    }
  }

  const providerChrome = (
    <div className="grid gap-4">
      {notice ? <AdminActionNotice tone={notice.tone} text={notice.text} /> : null}

      <SharedLlmProviderIntroCard
        accentLabel="Enhance default model"
        summaryLines={[
          (
            <>
              AI service:{" "}
              <span className="font-medium text-[var(--foreground)]">{llmProviderLabel(form.providerKind)}</span>
            </>
          ),
          llmProviderSummary(form.providerKind),
          llmProviderBillingLabel(form.providerKind),
        ]}
        leadingContent={
          <div className="grid gap-3 md:grid-cols-2">
            <AdminField label="Use images too">
              <label className="admin-toggle-row min-h-11">
                <span>Let Enhance read uploaded images</span>
                <AdminToggle
                  checked={form.supportsImageAnalysis}
                  ariaLabel="Let Enhance read uploaded images"
                  onToggle={() =>
                    setForm((current) => ({
                      ...current,
                      supportsImageAnalysis: !current.supportsImageAnalysis,
                    }))
                  }
                />
              </label>
            </AdminField>
          </div>
        }
        picker={
          <>
            <label className="admin-toggle-row text-sm">
              <span>Turn on Enhance</span>
              <AdminToggle
                checked={form.status !== "inactive"}
                ariaLabel="Turn on Enhance"
                onToggle={() =>
                  setForm((current) => ({
                    ...current,
                    status: current.status === "inactive" ? "active" : "inactive",
                  }))
                }
              />
            </label>
            {renderSelect(
              "enhancement-provider-kind",
              form.providerKind,
              (value) =>
                setForm((current) => ({
                  ...current,
                  providerKind: value as EnhancementProviderKind,
                  providerLabel: "",
                  providerModelId: "",
                  providerApiKey: "",
                  providerApiKeyTouched: false,
                  providerBaseUrl: "",
                  providerBaseUrlTouched: false,
                  providerSupportsImages: false,
                  providerCapabilities: {},
                  providerCredentialSource: "",
                  providerStatus: "",
                })),
              [
                { value: "builtin", label: "Media Studio default" },
                ...sharedProviderKindOptions(),
              ],
            )}
          </>
        }
      />

      {form.providerKind === "openrouter" ? (
          <SharedLlmProviderSection
            icon={KeyRound}
            title="OpenRouter setup"
            description={
              <>
                {form.providerCredentialSource === "env"
                  ? "Using OPENROUTER_API_KEY from .env."
                  : form.providerCredentialSource === "stored"
                    ? "Using the saved OpenRouter key on the server."
                    : "Add an OpenRouter API key here or in .env."}
                {form.providerModelId ? ` Current model: ${form.providerModelId}.` : ""}
              </>
            }
          >
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void probeProvider("openrouter");
            }}
          >
            {form.providerApiKeyConfigured ? (
              <div className="max-w-[760px] text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted-strong)]">
                A key is already saved. Leave this blank to keep it, or paste a new one to replace it.
              </div>
            ) : null}
            <div className="grid max-w-[760px] gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
              <AdminInput
                value={form.providerApiKey}
                onChange={(event) => setForm((current) => ({ ...current, providerApiKey: event.target.value, providerApiKeyTouched: true }))}
                placeholder={
                  form.providerCredentialSource === "env"
                    ? "Using OPENROUTER_API_KEY from .env"
                    : form.providerApiKeyConfigured
                      ? "Saved on the server. Enter a new key to replace it."
                      : "OpenRouter API key"
                }
                autoComplete="current-password"
                type="password"
              />
              <AdminButton type="submit" disabled={Boolean(manualProbeKind)} variant="primary" size="compact" className="justify-self-start">
                {manualProbeKind === "openrouter" ? "Refreshing..." : "Refresh models"}
              </AdminButton>
            </div>
            <div className="grid max-w-[760px] gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <AdminInput
                value={form.providerBaseUrl}
                onChange={(event) => setForm((current) => ({ ...current, providerBaseUrl: event.target.value, providerBaseUrlTouched: true }))}
                placeholder={form.providerBaseUrlConfigured ? "Saved on the server. Enter a new base URL to replace it." : "https://openrouter.ai/api/v1"}
              />
              <AdminInput
                value={openRouterModelQuery}
                onChange={(event) => setOpenRouterModelQuery(event.target.value)}
                placeholder={providerCatalogSearchPlaceholder("openrouter")}
              />
            </div>
            <div className="grid max-w-[760px] gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
              {renderSelect(
                "enhancement-openrouter-model",
                form.providerModelId,
                (value) => {
                  const selected = visibleOpenRouterCatalog.find((item) => item.id === value) ?? null;
                  setForm((current) => ({
                    ...current,
                    providerModelId: value,
                    providerLabel: selected?.label ?? current.providerLabel,
                    providerSupportsImages: Boolean(selected?.supports_images),
                    providerCapabilities: selected ? providerModelCapabilities(selected) : current.providerCapabilities,
                  }));
                },
                providerModelChoices("openrouter", visibleOpenRouterCatalog),
              )}
              <div className="self-center text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted-strong)]">
                {filteredOpenRouterCatalog.length} image-ready models
              </div>
            </div>
          </form>
          </SharedLlmProviderSection>
      ) : null}

      {form.providerKind === "local_openai" ? (
          <SharedLlmProviderSection icon={Server} title="Local OpenAI-Compatible">
            <div className="grid max-w-[760px] gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <AdminInput
                value={form.providerBaseUrl}
                onChange={(event) => setForm((current) => ({ ...current, providerBaseUrl: event.target.value, providerBaseUrlTouched: true }))}
                placeholder={form.providerBaseUrlConfigured ? "Saved on the server. Enter a new base URL to replace it." : "http://127.0.0.1:8080/v1"}
              />
              <AdminInput
                value={form.providerApiKey}
                onChange={(event) => setForm((current) => ({ ...current, providerApiKey: event.target.value, providerApiKeyTouched: true }))}
                placeholder={form.providerApiKeyConfigured ? "Stored on the server. Enter a new key to replace it." : "Optional API key"}
                type="password"
              />
              <AdminButton onClick={() => void probeProvider("local_openai")} disabled={Boolean(manualProbeKind)} variant="primary" size="compact" className="justify-self-start">
                {manualProbeKind === "local_openai" ? "Testing endpoint..." : "Test endpoint"}
              </AdminButton>
            </div>
            <div className="grid max-w-[760px] gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <AdminField label="Default model">
                <select
                  value={form.providerModelId}
                  onChange={(event) => {
                    const selected = visibleLocalOpenAiCatalog.find((item) => item.id === event.target.value) ?? null;
                    setForm((current) => ({
                      ...current,
                      providerModelId: event.target.value,
                      providerLabel: selected?.label ?? current.providerLabel,
                      providerSupportsImages: Boolean(selected?.supports_images),
                      providerCapabilities: selected ? providerModelCapabilities(selected) : current.providerCapabilities,
                    }));
                  }}
                  className="admin-input text-sm"
                >
                  {providerModelChoices("local_openai", visibleLocalOpenAiCatalog).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </AdminField>
              <div className="self-center text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted-strong)]">
                {manualProbeKind === "local_openai" || (isAutoLoadingCatalog && form.providerKind === "local_openai")
                  ? "Checking your local endpoint..."
                  : visibleLocalOpenAiCatalog.length
                  ? `Loaded ${visibleLocalOpenAiCatalog.length} local model${visibleLocalOpenAiCatalog.length === 1 ? "" : "s"}`
                  : "Use Test endpoint to see the models from your local server."}
              </div>
            </div>
          </SharedLlmProviderSection>
      ) : null}

      {form.providerKind === "codex_local" ? (
          <SharedLlmProviderSection
            icon={Sparkles}
            title="Codex Local"
            description="Uses Codex on this machine with the local Codex or ChatGPT sign-in that is already available."
          >
            <div className="grid max-w-[760px] gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <AdminField label="Default model">
                <select
                  value={form.providerModelId}
                  onChange={(event) => {
                    const selected = visibleCodexLocalCatalog.find((item) => item.id === event.target.value) ?? null;
                    setForm((current) => ({
                      ...current,
                      providerModelId: event.target.value,
                      providerLabel: selected?.label ?? current.providerLabel,
                      providerSupportsImages: Boolean(selected?.supports_images),
                      providerCapabilities: selected ? providerModelCapabilities(selected) : current.providerCapabilities,
                    }));
                  }}
                  className="admin-input text-sm"
                >
                  {providerModelChoices("codex_local", visibleCodexLocalCatalog).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </AdminField>
              <AdminButton onClick={() => void probeProvider("codex_local")} disabled={Boolean(manualProbeKind)} variant="primary" size="compact" className="justify-self-start">
                {manualProbeKind === "codex_local" ? "Refreshing..." : "Refresh models"}
              </AdminButton>
            </div>
            <div className="self-center text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted-strong)]">
              {manualProbeKind === "codex_local" || (isAutoLoadingCatalog && form.providerKind === "codex_local")
                ? "Checking local Codex models..."
                : visibleCodexLocalCatalog.length
                ? `Loaded ${visibleCodexLocalCatalog.length} Codex model${visibleCodexLocalCatalog.length === 1 ? "" : "s"} · included in plan`
                : `Refresh to see available models from local Codex. · included in plan`}
            </div>
          </SharedLlmProviderSection>
      ) : null}

      {form.providerKind === "builtin" ? (
          <SharedLlmProviderSection
            icon={PlugZap}
            title="Media Studio default"
            description="This keeps Enhance on Media Studio&apos;s default helper. Switch to another provider if you want hosted models, vision support, or Codex."
          >
            <AdminInput
              value={form.helperProfile}
              onChange={(event) => setForm((current) => ({ ...current, helperProfile: event.target.value }))}
              placeholder="Helper profile"
            />
          </SharedLlmProviderSection>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-3">
        <AdminButton onClick={() => void saveConfig()} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Enhance defaults"}
        </AdminButton>
      </div>
    </div>
  );

  if (embedded) {
    return providerChrome;
  }

  return (
    <Panel className="p-5 sm:p-6">
      <PanelHeader
        eyebrow="Studio Enhancement"
        title="Enhance default model"
        description="Choose the default AI service and model used by Enhance across Studio."
      />
      <div className="mt-5">{providerChrome}</div>
    </Panel>
  );
}

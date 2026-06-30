"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { KeyRound, Server, Sparkles } from "lucide-react";

import { AdminActionNotice } from "@/components/admin-action-notice";
import { AdminButton, AdminField, AdminInput, AdminSelect, AdminToggle } from "@/components/admin-controls";
import { Panel, PanelHeader } from "@/components/panel";
import { SharedLlmProviderIntroCard, SharedLlmProviderSection } from "@/components/shared-llm-provider-sections";
import { useAdminActionNotice } from "@/hooks/use-admin-action-notice";
import { useSharedProviderModelCatalog } from "@/hooks/use-shared-provider-model-catalog";
import { savePromptRecipeDraftingConfigRequest } from "@/lib/media-model-admin";
import {
  llmProviderBillingLabel,
  llmProviderLabel,
  llmProviderSummary,
  type SharedLlmProviderKind,
} from "@/lib/llm-provider-metadata";
import {
  filterProviderModels,
  providerCatalogSearchPlaceholder,
  providerModelCapabilities,
  providerModelChoices,
  providerModelFallback,
  resolveSelectedProviderModel,
} from "@/lib/llm-provider-models";
import type { PromptRecipeDraftingConfig } from "@/lib/types";

type PromptRecipeDraftingSettingsPanelProps = {
  initialConfig: PromptRecipeDraftingConfig | null;
  embedded?: boolean;
};

type DraftingFormState = {
  enabled: boolean;
  providerKind: SharedLlmProviderKind;
  providerLabel: string;
  providerModelId: string;
  providerBaseUrl: string;
  providerBaseUrlConfigured: boolean;
  providerBaseUrlTouched: boolean;
  providerSupportsImages: boolean;
  providerStatus: string;
  providerLastTestedAt: string;
  providerCapabilities: Record<string, unknown>;
  providerCredentialSource: string;
  temperature: number;
  maxTokens: number;
};

function formFromConfig(config: PromptRecipeDraftingConfig | null): DraftingFormState {
  return {
    enabled: config?.enabled !== false,
    providerKind: (config?.provider_kind as SharedLlmProviderKind) ?? "openrouter",
    providerLabel: config?.provider_label ?? "",
    providerModelId: config?.provider_model_id ?? "",
    providerBaseUrl: "",
    providerBaseUrlConfigured: Boolean(config?.provider_base_url_configured),
    providerBaseUrlTouched: false,
    providerSupportsImages: Boolean(config?.provider_supports_images),
    providerStatus: config?.provider_status ?? "",
    providerLastTestedAt: config?.provider_last_tested_at ?? "",
    providerCapabilities: config?.provider_capabilities_json ?? {},
    providerCredentialSource: config?.provider_credential_source ?? "",
    temperature: Number(config?.temperature ?? 0.2),
    maxTokens: Number(config?.max_tokens ?? 1800),
  };
}

function DraftingSettingsAccentCard({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="admin-surface-accent grid gap-4 p-4 sm:p-5">
      <div className="admin-label-accent">{label}</div>
      {children}
    </div>
  );
}

export function PromptRecipeDraftingSettingsPanel({
  initialConfig,
  embedded = false,
}: PromptRecipeDraftingSettingsPanelProps) {
  const [form, setForm] = useState<DraftingFormState>(() => formFromConfig(initialConfig));
  const [isSaving, setIsSaving] = useState(false);
  const [manualProbeKind, setManualProbeKind] = useState<SharedLlmProviderKind | null>(null);
  const [openPicker, setOpenPicker] = useState<string | null>(null);
  const [openRouterQuery, setOpenRouterQuery] = useState("");
  const { notice, showNotice, clearNotice } = useAdminActionNotice();
  const { catalogs, loadProviderCatalog } = useSharedProviderModelCatalog();
  const isAutoLoadingCatalog =
    catalogs[form.providerKind]?.status === "loading" && manualProbeKind == null;

  useEffect(() => {
    setForm(formFromConfig(initialConfig));
  }, [initialConfig]);

  const visibleOpenRouterCatalog = useMemo(() => {
    return filterProviderModels("openrouter", catalogs.openrouter?.availableModels ?? [], openRouterQuery);
  }, [catalogs.openrouter?.availableModels, openRouterQuery]);

  async function probeProvider(silent = false) {
    if (silent) {
      // loadProviderCatalog owns the loading state; this branch just suppresses notices.
    } else {
      setManualProbeKind(form.providerKind);
      clearNotice();
    }
    try {
      const result = await loadProviderCatalog(form.providerKind, {
        selectedModelId: form.providerModelId || null,
        providerBaseUrl: form.providerKind === "codex_local" ? null : (form.providerBaseUrl || null),
        requireImages: false,
        force: !silent,
      });
      if (!result.ok) {
        if (!silent) {
          showNotice("danger", result.error ?? "Could not load models for this provider.");
        }
        return;
      }
      const catalog = result.availableModels ?? [];
      const selected = resolveSelectedProviderModel(form.providerKind, catalog, {
        selectedModel: result.selectedModel,
        selectedModelId: form.providerModelId || null,
      });
      setForm((current) => ({
        ...current,
        providerLabel: selected?.label ?? current.providerLabel,
        providerModelId: selected?.id ?? current.providerModelId,
        providerSupportsImages: Boolean(selected?.supports_images),
        providerStatus: "connected",
        providerLastTestedAt: new Date().toISOString(),
        providerCapabilities: selected ? providerModelCapabilities(selected) : current.providerCapabilities,
        providerCredentialSource: result.credentialSource ?? current.providerCredentialSource,
        providerBaseUrlConfigured: current.providerBaseUrlConfigured || Boolean(current.providerBaseUrl),
      }));
      if (!silent) {
        showNotice(
          "healthy",
          selected
            ? `${llmProviderLabel(form.providerKind)} is ready. Using ${selected.label}.`
            : `${llmProviderLabel(form.providerKind)} is ready.`,
        );
      }
    } catch {
      if (!silent) {
        showNotice("danger", "Could not reach this provider right now.");
      }
    } finally {
      if (!silent) {
        setManualProbeKind(null);
      }
    }
  }

  async function saveConfig() {
    setIsSaving(true);
    clearNotice();
    try {
      const result = await savePromptRecipeDraftingConfigRequest({
        enabled: form.enabled,
        provider_kind: form.providerKind,
        provider_label: form.providerLabel || null,
        provider_model_id: form.providerModelId || null,
        provider_base_url: form.providerBaseUrlTouched ? (form.providerBaseUrl || null) : undefined,
        provider_supports_images: form.providerSupportsImages,
        provider_status: form.providerStatus || null,
        provider_last_tested_at: form.providerLastTestedAt || null,
        provider_capabilities_json: form.providerCapabilities,
        temperature: form.temperature,
        max_tokens: form.maxTokens,
      });
      if (!result.ok || !result.config) {
        showNotice("danger", result.error ?? "Could not save your recipe drafting defaults.");
        return;
      }
      setForm(formFromConfig(result.config));
      showNotice("healthy", "Recipe drafting defaults saved.");
    } catch {
      showNotice("danger", "Could not save your recipe drafting defaults right now.");
    } finally {
      setIsSaving(false);
    }
  }

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

  const activeCatalogBase =
    form.providerKind === "openrouter"
      ? visibleOpenRouterCatalog
      : catalogs[form.providerKind]?.availableModels ?? [];
  const activeCatalog =
    form.providerModelId &&
    !activeCatalogBase.some((item) => item.id === form.providerModelId)
      ? [
          providerModelFallback({
            providerKind: form.providerKind,
            modelId: form.providerModelId,
            label: form.providerLabel || form.providerModelId,
            supportsImages: Boolean(form.providerSupportsImages),
          }),
          ...activeCatalogBase,
        ]
      : activeCatalogBase;

  const content = (
    <div className="grid gap-4">
      {notice ? <AdminActionNotice tone={notice.tone} text={notice.text} /> : null}

      <SharedLlmProviderIntroCard
        accentLabel="Recipe draft model"
        summaryLines={[
          form.enabled ? "Recipe drafts are on." : "Recipe drafts are off.",
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
            <AdminField label="Turn on recipe drafts">
              <label className="admin-toggle-row min-h-11">
                <span>Let Media Studio draft recipes from an idea</span>
                <AdminToggle
                  checked={form.enabled}
                  ariaLabel="Let Media Studio draft recipes from an idea"
                  onToggle={() =>
                    setForm((current) => ({
                      ...current,
                      enabled: !current.enabled,
                    }))
                  }
                />
              </label>
            </AdminField>
          </div>
        }
        trailingContent={
          !form.enabled ? (
            <div className="admin-surface-inset p-3 text-sm leading-6 text-[var(--muted-strong)]">
              Recipe drafts will stay hidden in the Prompt Recipe editor until you turn this on.
              {!embedded ? null : (
                <>
                  {" "}
                  Open the Prompt Recipe editor after saving to use it.
                </>
              )}
            </div>
          ) : null
        }
      />

      {form.enabled && form.providerKind === "openrouter" ? (
          <SharedLlmProviderSection
            icon={KeyRound}
            title="OpenRouter setup"
            description={
              <>
                {form.providerCredentialSource === "env"
                  ? "Using OPENROUTER_API_KEY from .env."
                  : form.providerCredentialSource === "stored"
                    ? "Using the saved OpenRouter key on the server."
                    : "Add an OpenRouter API key in setup or in .env."}
                {form.providerModelId ? ` Current model: ${form.providerModelId}.` : ""}
              </>
            }
          >
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void probeProvider(false);
              }}
            >
            <div className="grid max-w-[760px] gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
              <AdminInput
                value={openRouterQuery}
                onChange={(event) => setOpenRouterQuery(event.target.value)}
                placeholder={providerCatalogSearchPlaceholder("openrouter")}
              />
              <AdminButton type="submit" disabled={Boolean(manualProbeKind)} variant="primary" size="compact" className="justify-self-start">
                {manualProbeKind === "openrouter" ? "Refreshing..." : "Refresh models"}
              </AdminButton>
            </div>
            <div className="grid max-w-[760px] gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
              {renderSelect(
                "drafting-openrouter-model",
                form.providerModelId,
                (value) => {
                  const selected = activeCatalog.find((item) => item.id === value) ?? null;
                  setForm((current) => ({
                    ...current,
                    providerModelId: value,
                    providerLabel: selected?.label ?? current.providerLabel,
                    providerSupportsImages: Boolean(selected?.supports_images),
                    providerCapabilities: selected ? providerModelCapabilities(selected) : current.providerCapabilities,
                  }));
                },
                providerModelChoices("openrouter", activeCatalog),
              )}
              <div className="self-center text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted-strong)]">
                {visibleOpenRouterCatalog.length} available models
              </div>
            </div>
            </form>
          </SharedLlmProviderSection>
      ) : null}

      {form.enabled && form.providerKind === "local_openai" ? (
          <SharedLlmProviderSection icon={Server} title="Local OpenAI-Compatible">
            <div className="grid max-w-[760px] gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
              <AdminInput
                value={form.providerBaseUrl}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    providerBaseUrl: event.target.value,
                    providerBaseUrlTouched: true,
                  }))
                }
                placeholder={form.providerBaseUrlConfigured ? "Saved on the server. Enter a new base URL to replace it." : "http://127.0.0.1:8080/v1"}
              />
              <AdminButton onClick={() => void probeProvider(false)} disabled={Boolean(manualProbeKind)} variant="primary" size="compact" className="justify-self-start">
                {manualProbeKind === "local_openai" ? "Testing endpoint..." : "Test endpoint"}
              </AdminButton>
            </div>
            <div className="grid max-w-[760px] gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <AdminField label="Default model">
                <select
                  value={form.providerModelId}
                  onChange={(event) => {
                    const selected = activeCatalog.find((item) => item.id === event.target.value) ?? null;
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
                  {providerModelChoices("local_openai", activeCatalog).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </AdminField>
              <div className="self-center text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted-strong)]">
                {manualProbeKind === "local_openai" || isAutoLoadingCatalog
                  ? "Checking your local endpoint..."
                  : activeCatalog.length
                    ? `Loaded ${activeCatalog.length} local model${activeCatalog.length === 1 ? "" : "s"}`
                  : "Use Test endpoint to see the models from your local server."}
              </div>
            </div>
          </SharedLlmProviderSection>
      ) : null}

      {form.enabled && form.providerKind === "codex_local" ? (
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
                    const selected = activeCatalog.find((item) => item.id === event.target.value) ?? null;
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
                  {providerModelChoices("codex_local", activeCatalog).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </AdminField>
              <AdminButton onClick={() => void probeProvider(false)} disabled={Boolean(manualProbeKind)} variant="primary" size="compact" className="justify-self-start">
                {manualProbeKind === "codex_local" ? "Refreshing..." : "Refresh models"}
              </AdminButton>
            </div>
            <div className="self-center text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted-strong)]">
              {manualProbeKind === "codex_local" || isAutoLoadingCatalog
                ? "Checking local Codex models..."
                : activeCatalog.length
                  ? `Loaded ${activeCatalog.length} Codex model${activeCatalog.length === 1 ? "" : "s"} · included in plan`
                  : "Refresh to see available models from local Codex. · included in plan"}
            </div>
          </SharedLlmProviderSection>
      ) : null}

      {form.enabled && form.providerKind === "codex_local" ? (
        <DraftingSettingsAccentCard label="How this behaves">
          <div className="text-sm leading-6 text-[var(--muted-strong)]">
            Codex Local manages its own drafting behavior. Media Studio saves the provider and model here, but it
            does not ask you to tune temperature or token limits for this option.
          </div>
        </DraftingSettingsAccentCard>
      ) : form.enabled ? (
        <DraftingSettingsAccentCard label="Optional tuning">
          <div className="grid gap-3 md:grid-cols-2">
            <AdminField label="Temperature">
              <AdminInput
                type="number"
                min={0}
                max={2}
                step={0.05}
                value={form.temperature}
                onChange={(event) => setForm((current) => ({ ...current, temperature: Number(event.target.value) }))}
              />
            </AdminField>
            <AdminField label="Max tokens">
              <AdminInput
                type="number"
                min={128}
                max={4000}
                value={form.maxTokens}
                onChange={(event) => setForm((current) => ({ ...current, maxTokens: Number(event.target.value) }))}
              />
            </AdminField>
          </div>
          <div className="text-sm leading-6 text-[var(--muted-strong)]">
            Most people should leave these alone. Recipe drafting still returns text-first output even when the
            provider can accept images.
          </div>
        </DraftingSettingsAccentCard>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-3">
        <AdminButton onClick={() => void saveConfig()} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save recipe defaults"}
        </AdminButton>
      </div>
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <Panel className="p-5 sm:p-6">
      <PanelHeader
        eyebrow="Prompt Recipe Drafting"
        title="Recipe draft model"
        description="Choose the default AI service and model used when Media Studio writes the first draft of a recipe."
      />
      <div className="mt-5">{content}</div>
    </Panel>
  );
}

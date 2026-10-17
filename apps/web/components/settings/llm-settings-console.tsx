"use client";

import Link from "next/link";
import { buildStudioScopedHref } from "@/lib/studio-navigation";
import type { ReactNode } from "react";
import { Cable, Coins, Image as ImageIcon } from "lucide-react";

import { adminButtonClassName, adminInsetPanelClassName } from "@/components/admin-controls";
import { SectionDisclosure } from "@/components/collapsible-sections";
import {
  adminMetricGridFourClassName,
  adminSectionStackClassName,
} from "@/components/admin-theme";
import { Panel, PanelHeader } from "@/components/panel";
import { PromptRecipeDraftingSettingsPanel } from "@/components/prompt-recipes/prompt-recipe-drafting-settings-panel";
import { StudioEnhancementSettingsPanel } from "@/components/settings/studio-enhancement-settings-panel";
import { StatusPill } from "@/components/status-pill";
import { SurfaceInset } from "@/components/ui/surface-primitives";
import { type MediaStudioHealthSummary } from "@/lib/llm-provider-health";
import {
  llmProviderLabel,
} from "@/lib/llm-provider-metadata";
import type {
  ControlApiHealthData,
  ExternalLlmUsageSummary,
  MediaAssistantConfig,
  MediaEnhancementConfig,
  PromptRecipeDraftingConfig,
} from "@/lib/types";
import { notSetUpStatus, readyStatus } from "@/lib/status-language";
import { formatUsdAmount } from "@/lib/utils";

function settingsMetricCard({
  label,
  value,
  detail,
  valueClassName = "mt-3 text-2xl font-semibold text-[var(--foreground)]",
}: {
  label: string;
  value: ReactNode;
  detail: string;
  valueClassName?: string;
}) {
  return (
    <SurfaceInset appearance="admin" className={adminInsetPanelClassName}>
      <div className="admin-label-muted">{label}</div>
      <div className={valueClassName}>{value}</div>
      <div className="mt-2 text-sm text-[var(--muted-strong)]">{detail}</div>
    </SurfaceInset>
  );
}

function settingsIconCard({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <SurfaceInset appearance="admin" className={adminInsetPanelClassName}>
      <div className="admin-icon-label-row admin-label-muted">
        {icon}
        {label}
      </div>
      {children}
    </SurfaceInset>
  );
}

export function LlmSettingsConsole({
  enhancementConfigs,
  mediaAssistantConfig,
  promptRecipeDraftingConfig,
  openRouterSpend,
  currentProjectId = null,
}: {
  currentProjectId?: string | null;
  enhancementConfigs: MediaEnhancementConfig[];
  mediaAssistantConfig: MediaAssistantConfig | null;
  promptRecipeDraftingConfig: PromptRecipeDraftingConfig | null;
  openRouterSpend: ExternalLlmUsageSummary | null;
  health: MediaStudioHealthSummary | ControlApiHealthData;
}) {
  const enhancementProvider = enhancementConfigs.find((config) => config.model_key === "__studio_enhancement__") ?? null;
  const draftingProviderLabel = llmProviderLabel(promptRecipeDraftingConfig?.provider_kind);
  const assistantProviderLabel = llmProviderLabel(mediaAssistantConfig?.provider_kind);
  const enhancementProviderLabel = llmProviderLabel(enhancementProvider?.provider_kind || "builtin");
  const enhancementDefaultsReady =
    enhancementProvider?.provider_kind === "builtin" ||
    Boolean(enhancementProvider?.provider_model_id || enhancementProvider?.provider_label);
  const enhancementStatus = enhancementDefaultsReady ? readyStatus() : notSetUpStatus();
  const draftingEnabled = promptRecipeDraftingConfig?.enabled !== false;
  const draftingDefaultsReady = draftingEnabled && Boolean(
    promptRecipeDraftingConfig?.provider_model_id || promptRecipeDraftingConfig?.provider_label,
  );
  const draftingStatus = draftingDefaultsReady ? readyStatus() : notSetUpStatus();
  const assistantDefaultsReady = Boolean(
    mediaAssistantConfig?.provider_model_id || mediaAssistantConfig?.provider_label,
  );
  const assistantStatus = assistantDefaultsReady ? readyStatus() : notSetUpStatus();
  const billingStatus = readyStatus();

  return (
    <div className={adminSectionStackClassName}>
      <div className="flex flex-wrap gap-4 text-sm text-[var(--accent-strong)]">
        <Link href={buildStudioScopedHref("/settings/connections", currentProjectId)}>Manage connections →</Link>
        <a href="/help/ai#models" target="_blank" rel="noreferrer">Select and test models ↗</a>
        <a href="/help/ai#enhancement" target="_blank" rel="noreferrer">Use Prompt Enhance ↗</a>
        <a href="/help/ai#recipes" target="_blank" rel="noreferrer">Draft and use recipes ↗</a>
      </div>

      <Panel className="admin-disclosure-list overflow-hidden p-0">
        <div className="p-5"><PanelHeader eyebrow="AI defaults" title="Default models" description="Open the task you want to change, select its AI provider, then select a model and save. Each task has its own default." /></div>
        <SectionDisclosure
          className="admin-disclosure-compact"
          title="Prompt Enhance default model"
          description="Choose the model Studio uses when Prompt Enhance rewrites a prompt."
          summary={`${enhancementProviderLabel} · ${enhancementProvider?.provider_label || enhancementProvider?.provider_model_id || "Default"}`}
          detail="Image access is separate. Graph prompt nodes still choose their own model."
          statusSlot={<StatusPill label={enhancementStatus.label} tone={enhancementStatus.tone} />}
          defaultOpen={false}
        >
          <StudioEnhancementSettingsPanel initialConfigs={enhancementConfigs} embedded />
        </SectionDisclosure>
        <SectionDisclosure
          className="admin-disclosure-compact"
          title="Recipe draft model"
          description="Choose the default model used when Media Studio writes the first draft of a Prompt Recipe."
          summary={draftingEnabled ? `${draftingProviderLabel} · ${promptRecipeDraftingConfig?.provider_label || promptRecipeDraftingConfig?.provider_model_id || "Not configured"}` : "Recipe drafts are off."}
          detail="This is only for first drafts. It does not control graph runs or save a recipe by itself."
          statusSlot={<StatusPill label={draftingStatus.label} tone={draftingStatus.tone} />}
          defaultOpen={false}
        >
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-soft)] px-5 py-4 sm:px-6">
            <div className="max-w-2xl text-sm leading-6 text-[var(--muted-strong)]">
              Create and edit Prompt Recipes from the Prompt Recipes admin page. Recipe fields can expose graph inputs as
              text handles or image handles; image handles use the recipe image settings below for analysis or direct
              reference behavior.
            </div>
            <Link href="/presets?tab=prompt-recipes" className={adminButtonClassName({ variant: "subtle", size: "compact" })}>
              Open Prompt Recipes
            </Link>
          </div>
          <PromptRecipeDraftingSettingsPanel initialConfig={promptRecipeDraftingConfig} embedded />
        </SectionDisclosure>
        <SectionDisclosure
          className="admin-disclosure-compact"
          title="Media Assistant model"
          description="Choose the conversation provider and image generation defaults for new Assistant work."
          summary={`${assistantProviderLabel} · ${mediaAssistantConfig?.provider_label || mediaAssistantConfig?.provider_model_id || "Not configured"}`}
          detail={
            mediaAssistantConfig?.supports_media_studio_tools === false
              ? "This provider is chat only. Switch to Codex Local for graph building and Studio actions."
              : "Codex Local runs with isolated, read-only filesystem access and the approved Studio tool surface."
          }
          statusSlot={<StatusPill label={assistantStatus.label} tone={assistantStatus.tone} />}
          defaultOpen={false}
        >
          <PromptRecipeDraftingSettingsPanel
            purpose="media_assistant"
            initialConfig={mediaAssistantConfig}
            embedded
          />
        </SectionDisclosure>
      </Panel>

      <Panel className="overflow-hidden p-0">
        <SectionDisclosure
          className="admin-disclosure-compact"
          title="Cost and usage"
          description="This shows what Media Studio tracks and what it leaves up to your own setup."
          summary="OpenRouter is usage-based. Codex Local uses your plan. Local OpenAI-compatible uses your own machine or server."
          detail="KIE image and video estimates live elsewhere."
          statusSlot={<StatusPill label={billingStatus.label} tone={billingStatus.tone} />}
          defaultOpen={false}
        >
          <p className="mb-4 text-sm text-[var(--muted-strong)]">Start with Codex Local if this machine already uses Codex or ChatGPT. Use OpenRouter for hosted, usage-based models. Use Local OpenAI-compatible only if you already run your own endpoint.</p>
          <div className={adminMetricGridFourClassName}>
            {settingsMetricCard({
              label: "Today",
              value: formatUsdAmount(openRouterSpend?.today.cost_usd ?? null) ?? "n/a",
              detail: "OpenRouter actual spend",
            })}
            {settingsMetricCard({
              label: "Last 7d",
              value: formatUsdAmount(openRouterSpend?.last_7d.cost_usd ?? null) ?? "n/a",
              detail: "OpenRouter actual spend",
            })}
            {settingsMetricCard({
              label: "Codex Local",
              value: "Included",
              detail: "Uses the local Codex or ChatGPT plan on this machine",
              valueClassName: "mt-3 text-lg font-semibold text-[var(--foreground)]",
            })}
            {settingsMetricCard({
              label: "Local OpenAI-Compatible",
              value: "Self-hosted",
              detail: "Media Studio does not estimate the real cost of your own endpoint",
              valueClassName: "mt-3 text-lg font-semibold text-[var(--foreground)]",
            })}
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-3">
            {settingsIconCard({
              icon: <Coins className="size-3.5" />,
              label: "OpenRouter",
              children: (
                <div className="mt-3 text-sm leading-6 text-[var(--muted-strong)]">
                  Hosted models. Media Studio tracks spend for these calls.
                </div>
              ),
            })}
            {settingsIconCard({
              icon: <Cable className="size-3.5" />,
              label: "Codex Local",
              children: (
                <div className="mt-3 text-sm leading-6 text-[var(--muted-strong)]">
                  Uses your existing Codex or ChatGPT plan. Media Studio does not show a made-up dollar estimate here.
                </div>
              ),
            })}
            {settingsIconCard({
              icon: <ImageIcon className="size-3.5" />,
              label: "Local OpenAI-Compatible",
              children: (
                <div className="mt-3 text-sm leading-6 text-[var(--muted-strong)]">
                  Your own local or self-hosted endpoint. You manage the cost and capacity for this path.
                </div>
              ),
            })}
          </div>
        </SectionDisclosure>
      </Panel>
    </div>
  );
}

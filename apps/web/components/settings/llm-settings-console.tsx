"use client";

import Link from "next/link";
import { BrainCircuit, Cable, Coins, Image as ImageIcon, Sparkles } from "lucide-react";

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
import { summarizeLlmProviderReadiness, type MediaStudioHealthSummary } from "@/lib/llm-provider-health";
import {
  getLlmProviderDescriptor,
  llmProviderLabel,
  type SharedLlmProviderKind,
} from "@/lib/llm-provider-metadata";
import type {
  ControlApiHealthData,
  ExternalLlmUsageSummary,
  MediaEnhancementConfig,
  PromptRecipeDraftingConfig,
} from "@/lib/types";
import { notSetUpStatus, readinessStatus, readyStatus } from "@/lib/status-language";
import { formatUsdAmount } from "@/lib/utils";

function providerSummaryCard({
  providerKind,
  ready,
  configured,
  detail,
  actionHref,
  actionLabel,
}: {
  providerKind: SharedLlmProviderKind;
  ready: boolean;
  configured: boolean;
  detail: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  const descriptor = getLlmProviderDescriptor(providerKind);
  return (
    <SurfaceInset appearance="admin" className={adminInsetPanelClassName}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="admin-label-muted">{descriptor.label}</div>
          <div className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">{descriptor.summary}</div>
        </div>
        <StatusPill label={readinessStatus(ready, configured).label} tone={readinessStatus(ready, configured).tone} />
      </div>
      <div className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted-strong)]">
        {descriptor.billingLabel}
      </div>
      <div className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">{detail}</div>
      {actionHref && actionLabel ? (
        <div className="mt-4">
          <Link href={actionHref} className={adminButtonClassName({ variant: "subtle", size: "compact" })}>
            {actionLabel}
          </Link>
        </div>
      ) : null}
    </SurfaceInset>
  );
}

export function LlmSettingsConsole({
  enhancementConfigs,
  promptRecipeDraftingConfig,
  openRouterSpend,
  health,
}: {
  enhancementConfigs: MediaEnhancementConfig[];
  promptRecipeDraftingConfig: PromptRecipeDraftingConfig | null;
  openRouterSpend: ExternalLlmUsageSummary | null;
  health: MediaStudioHealthSummary | ControlApiHealthData;
}) {
  const readiness = summarizeLlmProviderReadiness(
    health,
    enhancementConfigs,
    promptRecipeDraftingConfig,
  );
  const enhancementProvider = enhancementConfigs.find((config) => config.model_key === "__studio_enhancement__") ?? null;
  const draftingProviderLabel = llmProviderLabel(promptRecipeDraftingConfig?.provider_kind);
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
  const billingStatus = readyStatus();

  return (
    <div className={adminSectionStackClassName}>
      <Panel>
        <PanelHeader
          eyebrow="AI Settings"
          title="Set up default models"
          description="Choose the default model for the Enhance button and for recipe drafts. Graph workflows still choose their own models inside each node."
        />
        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          <SurfaceInset appearance="admin" className={adminInsetPanelClassName}>
            <div className="admin-icon-label-row admin-label-muted">
              <Sparkles className="size-3.5" />
              Enhance button
            </div>
            <div className="mt-3 text-sm leading-7 text-[var(--muted-strong)]">
              Default model: <span className="font-medium text-[var(--foreground)]">{enhancementProviderLabel}</span>
            </div>
          </SurfaceInset>
          <SurfaceInset appearance="admin" className={adminInsetPanelClassName}>
            <div className="admin-icon-label-row admin-label-muted">
              <BrainCircuit className="size-3.5" />
              Recipe drafts
            </div>
            <div className="mt-3 text-sm leading-7 text-[var(--muted-strong)]">
              Default model:{" "}
              <span className="font-medium text-[var(--foreground)]">{draftingEnabled ? draftingProviderLabel : "Off"}</span>
            </div>
            <div className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">
              Only used when Media Studio writes the first draft of a Prompt Recipe.
            </div>
          </SurfaceInset>
          <SurfaceInset appearance="admin" className={adminInsetPanelClassName}>
            <div className="admin-icon-label-row admin-label-muted">
              <Cable className="size-3.5" />
              Graph workflows
            </div>
            <div className="mt-3 text-sm leading-6 text-[var(--muted-strong)]">
              Graph prompt nodes choose their own provider and model inside each workflow. They do not use the recipe
              draft default from this page.
            </div>
          </SurfaceInset>
        </div>
        <div className="mt-5 border-t border-[var(--border-subtle)] pt-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="admin-label-muted">Connected AI services</div>
              <div className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">
                Start with Codex Local if this machine already uses Codex or ChatGPT. Use OpenRouter for hosted,
                usage-based models. Use Local OpenAI-compatible only if you already run your own endpoint.
              </div>
            </div>
            <Link href="/setup" className={adminButtonClassName({ variant: "subtle", size: "compact" })}>
              Open setup
            </Link>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {providerSummaryCard({
              providerKind: "codex_local",
              ready: readiness.codexLocal.ready,
              configured: readiness.codexLocal.configured,
              detail: readiness.codexLocal.ready
                ? "Codex is installed and signed in on this machine."
                : readiness.codexLocal.commandAvailable
                  ? "Codex is installed, but this machine is not signed in yet."
                  : "Codex is not installed on this machine yet.",
              actionHref: readiness.codexLocal.ready ? undefined : "/setup",
              actionLabel: readiness.codexLocal.ready ? undefined : "Set up Codex",
            })}
            {providerSummaryCard({
              providerKind: "openrouter",
              ready: readiness.openRouter.ready,
              configured: readiness.openRouter.configured,
              detail: readiness.openRouter.configured
                ? "An OpenRouter API key is already saved for this Studio install."
                : "No OpenRouter API key has been added yet.",
            })}
            {providerSummaryCard({
              providerKind: "local_openai",
              ready: readiness.localOpenAi.ready,
              configured: readiness.localOpenAi.configured,
              detail: readiness.localOpenAi.configured
                ? "A local endpoint is saved. Use Test endpoint below to make sure it responds."
                : "No local endpoint has been added yet.",
            })}
          </div>
        </div>
      </Panel>

      <Panel className="overflow-hidden p-0">
        <SectionDisclosure
          title="Enhance default model"
          description="Choose the default model used by the Enhance button in Studio."
          summary={`Using: ${enhancementProviderLabel}`}
          detail="This only controls Enhance. Graph nodes can still pick something else."
          statusSlot={<StatusPill label={enhancementStatus.label} tone={enhancementStatus.tone} />}
          defaultOpen={false}
        >
          <StudioEnhancementSettingsPanel initialConfigs={enhancementConfigs} embedded />
        </SectionDisclosure>
      </Panel>

      <Panel className="overflow-hidden p-0">
        <SectionDisclosure
          title="Recipe draft model"
          description="Choose the default model used when Media Studio writes the first draft of a Prompt Recipe."
          summary={draftingEnabled ? `Using: ${draftingProviderLabel}` : "Recipe drafts are off."}
          detail="This is only for first drafts. It does not control graph runs or save a recipe by itself."
          statusSlot={<StatusPill label={draftingStatus.label} tone={draftingStatus.tone} />}
          defaultOpen={false}
        >
          <PromptRecipeDraftingSettingsPanel initialConfig={promptRecipeDraftingConfig} embedded />
        </SectionDisclosure>
      </Panel>

      <Panel className="overflow-hidden p-0">
        <SectionDisclosure
          title="Cost and usage"
          description="This shows what Media Studio tracks and what it leaves up to your own setup."
          summary="OpenRouter is usage-based. Codex Local uses your plan. Local OpenAI-compatible uses your own machine or server."
          detail="KIE image and video estimates live elsewhere."
          statusSlot={<StatusPill label={billingStatus.label} tone={billingStatus.tone} />}
          defaultOpen={false}
        >
          <div className={adminMetricGridFourClassName}>
            <SurfaceInset appearance="admin" className={adminInsetPanelClassName}>
              <div className="admin-label-muted">Today</div>
              <div className="mt-3 text-2xl font-semibold text-[var(--foreground)]">
                {formatUsdAmount(openRouterSpend?.today.cost_usd ?? null) ?? "n/a"}
              </div>
              <div className="mt-2 text-sm text-[var(--muted-strong)]">OpenRouter actual spend</div>
            </SurfaceInset>
            <SurfaceInset appearance="admin" className={adminInsetPanelClassName}>
              <div className="admin-label-muted">Last 7d</div>
              <div className="mt-3 text-2xl font-semibold text-[var(--foreground)]">
                {formatUsdAmount(openRouterSpend?.last_7d.cost_usd ?? null) ?? "n/a"}
              </div>
              <div className="mt-2 text-sm text-[var(--muted-strong)]">OpenRouter actual spend</div>
            </SurfaceInset>
            <SurfaceInset appearance="admin" className={adminInsetPanelClassName}>
              <div className="admin-label-muted">Codex Local</div>
              <div className="mt-3 text-lg font-semibold text-[var(--foreground)]">Included</div>
              <div className="mt-2 text-sm text-[var(--muted-strong)]">Uses the local Codex or ChatGPT plan on this machine</div>
            </SurfaceInset>
            <SurfaceInset appearance="admin" className={adminInsetPanelClassName}>
              <div className="admin-label-muted">Local OpenAI-Compatible</div>
              <div className="mt-3 text-lg font-semibold text-[var(--foreground)]">Self-hosted</div>
              <div className="mt-2 text-sm text-[var(--muted-strong)]">Media Studio does not estimate the real cost of your own endpoint</div>
            </SurfaceInset>
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-3">
            <SurfaceInset appearance="admin" className={adminInsetPanelClassName}>
              <div className="admin-icon-label-row admin-label-muted">
                <Coins className="size-3.5" />
                OpenRouter
              </div>
              <div className="mt-3 text-sm leading-6 text-[var(--muted-strong)]">
                Hosted models. Media Studio tracks spend for these calls.
              </div>
            </SurfaceInset>
            <SurfaceInset appearance="admin" className={adminInsetPanelClassName}>
              <div className="admin-icon-label-row admin-label-muted">
                <Cable className="size-3.5" />
                Codex Local
              </div>
              <div className="mt-3 text-sm leading-6 text-[var(--muted-strong)]">
                Uses your existing Codex or ChatGPT plan. Media Studio does not show a made-up dollar estimate here.
              </div>
            </SurfaceInset>
            <SurfaceInset appearance="admin" className={adminInsetPanelClassName}>
              <div className="admin-icon-label-row admin-label-muted">
                <ImageIcon className="size-3.5" />
                Local OpenAI-Compatible
              </div>
              <div className="mt-3 text-sm leading-6 text-[var(--muted-strong)]">
                Your own local or self-hosted endpoint. You manage the cost and capacity for this path.
              </div>
            </SurfaceInset>
          </div>
        </SectionDisclosure>
      </Panel>
    </div>
  );
}

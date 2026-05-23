import Link from "next/link";
import { BrainCircuit, Cable, CheckCircle2, Image as ImageIcon, KeyRound, Sparkles, Workflow } from "lucide-react";
import type { ReactNode } from "react";

import { adminButtonClassName, adminInsetPanelClassName } from "@/components/admin-controls";
import { SectionDisclosure } from "@/components/collapsible-sections";
import { adminSurfaceCardClassName, adminThemeLayoutClassName } from "@/components/admin-theme";
import { StatusPill } from "@/components/status-pill";
import { StudioAdminShell } from "@/components/studio-admin-shell";
import { CalloutPanel, SurfaceInset } from "@/components/ui/surface-primitives";
import { getControlApiJson, getMediaDashboardSnapshot } from "@/lib/control-api";
import { summarizeLlmProviderReadiness } from "@/lib/llm-provider-health";
import { DEFAULT_LOCAL_OPENAI_BASE_URL, KIE_AFFILIATE_URL } from "@/lib/onboarding";
import { binaryReadinessStatus, connectingStatus, readinessStatus, readyStatus } from "@/lib/status-language";
import { buildStudioScopedHref } from "@/lib/studio-navigation";
import type { ControlApiHealthData, MediaCreditsResponse } from "@/lib/types";

function StatusRow({
  label,
  value,
  tone,
  detail,
}: {
  label: string;
  value: string;
  tone: "healthy" | "warning" | "danger" | "neutral";
  detail: string;
}) {
  return (
    <div className="admin-row-surface items-start">
      <div>
        <div className="text-sm font-semibold text-[var(--foreground)]">{label}</div>
        <div className="mt-1 text-sm leading-6 text-[var(--muted-strong)]">{detail}</div>
      </div>
      <StatusPill label={value} tone={tone} />
    </div>
  );
}

function SetupCapabilityCard({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <SurfaceInset appearance="admin" className={adminInsetPanelClassName}>
      <div className="admin-icon-label-row admin-label-muted">
        {icon}
        {title}
      </div>
      <div className="mt-3 text-sm leading-6 text-[var(--muted-strong)]">{description}</div>
    </SurfaceInset>
  );
}

function SetupConnectionCard({
  eyebrow,
  title,
  description,
  powers,
  statusLabel,
  statusTone,
  steps,
  note,
  actionHref,
  actionLabel,
  defaultOpen = false,
}: {
  eyebrow: string;
  title: string;
  description: string;
  powers: string;
  statusLabel: string;
  statusTone: "healthy" | "warning" | "danger" | "neutral";
  steps: ReactNode;
  note?: ReactNode;
  actionHref?: string;
  actionLabel?: string;
  defaultOpen?: boolean;
}) {
  return (
    <section className={`${adminSurfaceCardClassName} overflow-hidden p-0`}>
      <SectionDisclosure
        title={title}
        description={description}
        summary={`Powers: ${powers}`}
        detail={eyebrow}
        statusSlot={<StatusPill label={statusLabel} tone={statusTone} />}
        defaultOpen={defaultOpen}
      >
        <SurfaceInset appearance="admin" className="p-4">
          <div className="admin-label-muted">How to finish setup on this machine</div>
          <div className="mt-3 text-sm leading-7 text-[var(--muted-strong)]">{steps}</div>
        </SurfaceInset>
        {note ? (
          <CalloutPanel appearance="admin" tone="muted" className="mt-4 px-4 py-3 text-sm leading-6 text-[var(--muted-strong)]">
            {note}
          </CalloutPanel>
        ) : null}
        {actionHref && actionLabel ? (
          <div className="mt-4">
            <Link href={actionHref} className={adminButtonClassName({ variant: "subtle", size: "compact" })}>
              {actionLabel}
            </Link>
          </div>
        ) : null}
      </SectionDisclosure>
    </section>
  );
}

export default async function SetupPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = (searchParams ? await searchParams : {}) ?? {};
  const currentProjectId = typeof resolvedSearchParams.project === "string" ? resolvedSearchParams.project : null;
  const snapshot = await getMediaDashboardSnapshot();
  const credits = await getControlApiJson<MediaCreditsResponse>("/media/credits");
  const health: ControlApiHealthData = snapshot.status.data ?? {};
  const enhancementConfigs = snapshot.enhancementConfigs.data?.configs ?? [];
  const promptRecipeDraftingConfig = snapshot.promptRecipeDraftingConfig.data?.config ?? null;
  const providerReadiness = summarizeLlmProviderReadiness(health, enhancementConfigs, promptRecipeDraftingConfig);

  const kieRepoConnected = Boolean(health.kie_api_repo_connected);
  const kieKeyConfigured = Boolean(health.kie_api_key_configured);
  const liveSubmitEnabled = Boolean(health.live_submit_enabled);
  const codexLocalCommandAvailable = providerReadiness.codexLocal.commandAvailable;
  const codexLocalReady = providerReadiness.codexLocal.ready;
  const openRouterConfigured = providerReadiness.openRouter.configured;
  const localOpenAiConfigured = providerReadiness.localOpenAi.configured;
  const localOpenAiReady = providerReadiness.localOpenAi.ready;
  const creditsReason =
    typeof credits.data?.raw?.reason === "string" ? credits.data.raw.reason : "Credit balance becomes visible after you add a KIE API key.";

  const aiSettingsHref = buildStudioScopedHref("/settings/llms", currentProjectId);
  const studioHref = buildStudioScopedHref("/studio", currentProjectId);
  const graphHref = buildStudioScopedHref("/graph-studio", currentProjectId);
  const machineReady = kieRepoConnected && kieKeyConfigured && liveSubmitEnabled;
  const machineConfigured =
    kieRepoConnected ||
    kieKeyConfigured ||
    liveSubmitEnabled ||
    codexLocalCommandAvailable ||
    openRouterConfigured ||
    localOpenAiConfigured;
  const machineStatus = machineReady ? readyStatus() : readinessStatus(false, machineConfigured);

  return (
    <StudioAdminShell
      section="setup"
      currentProjectId={currentProjectId}
      eyebrow="Connections"
      title="Connect Services"
      description="Media Studio is already running on this machine. Use this page to connect KIE, Codex, OpenRouter, and Local OpenAI, confirm what is ready, and see which part of the app each service powers."
    >
      <div className={adminThemeLayoutClassName}>
        <section className={adminSurfaceCardClassName}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="admin-label-accent">Current machine status</div>
              <h2 className="mt-2 text-[1.15rem] font-semibold tracking-[-0.03em] text-[var(--foreground)]">This machine</h2>
            </div>
            <StatusPill label={machineStatus.label} tone={machineStatus.tone} />
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            <StatusRow
              label="Media generation backend"
              value={binaryReadinessStatus(kieRepoConnected).label}
              tone={binaryReadinessStatus(kieRepoConnected).tone}
              detail="Required. Media Studio uses the shared gateway/kie-api checkout and Python runtime."
            />
            <StatusRow
              label="KIE API key"
              value={binaryReadinessStatus(kieKeyConfigured).label}
              tone={binaryReadinessStatus(kieKeyConfigured).tone}
              detail={kieKeyConfigured ? "Required key is present." : creditsReason}
            />
            <StatusRow
              label="Live generation"
              value={binaryReadinessStatus(liveSubmitEnabled).label}
              tone={binaryReadinessStatus(liveSubmitEnabled).tone}
              detail="Required for real image and video submits from Studio and graph media nodes."
            />
            <StatusRow
              label="Codex Local"
              value={readinessStatus(codexLocalReady, codexLocalCommandAvailable).label}
              tone={readinessStatus(codexLocalReady, codexLocalCommandAvailable).tone}
              detail="Optional. Uses your local Codex sign-in and the Codex or ChatGPT plan on this machine."
            />
            <StatusRow
              label="OpenRouter"
              value={readinessStatus(openRouterConfigured, openRouterConfigured).label}
              tone={readinessStatus(openRouterConfigured, openRouterConfigured).tone}
              detail="Optional. Hosted text and vision models billed through OpenRouter."
            />
            <StatusRow
              label="Local OpenAI-compatible"
              value={readinessStatus(localOpenAiReady, localOpenAiConfigured).label}
              tone={readinessStatus(localOpenAiReady, localOpenAiConfigured).tone}
              detail="Optional. Your own OpenAI-style endpoint for local or self-hosted prompt work."
            />
          </div>
        </section>

        <section className={adminSurfaceCardClassName}>
          <div className="space-y-3">
            <h2 className="text-[1.5rem] font-semibold tracking-[-0.04em] text-[var(--foreground)]">What each connection powers</h2>
            <p className="max-w-3xl text-sm leading-7 text-[var(--muted-strong)]">
              Confirm which services are ready on this machine, then use AI Settings or each graph workflow to choose the right model for the job.
            </p>
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-3">
            <SetupCapabilityCard
              icon={<ImageIcon className="size-3.5" />}
              title="Studio renders"
              description="KIE powers image and video generation in Studio and in graph media model nodes. If KIE is not ready, real generation stays offline."
            />
            <SetupCapabilityCard
              icon={<BrainCircuit className="size-3.5" />}
              title="Prompt Enhance and recipe drafts"
              description="AI Settings chooses the default model for Prompt Enhance and for recipe draft generation. These are defaults, not global locks."
            />
            <SetupCapabilityCard
              icon={<Workflow className="size-3.5" />}
              title="Graph prompt nodes"
              description="Graph prompt nodes choose their own provider and model inside each workflow. They do not inherit the recipe draft default."
            />
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href={aiSettingsHref} className={adminButtonClassName({ variant: "subtle", size: "compact" })}>
              Open Settings
            </Link>
            <Link href={studioHref} className={adminButtonClassName({ variant: "subtle", size: "compact" })}>
              Open Studio
            </Link>
            <Link href={graphHref} className={adminButtonClassName({ variant: "subtle", size: "compact" })}>
              Open Graph Studio
            </Link>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <SetupConnectionCard
            eyebrow="Required service"
            title="Connect KIE"
            description="KIE is the media backend Media Studio uses for image and video generation."
            powers="Studio renders and graph image or video nodes."
            statusLabel={readinessStatus(liveSubmitEnabled, kieKeyConfigured).label}
            statusTone={readinessStatus(liveSubmitEnabled, kieKeyConfigured).tone}
            defaultOpen
            steps={
              <ul className="space-y-2">
                <li className="flex items-start gap-3"><CheckCircle2 className="mt-1 size-4 shrink-0 text-[var(--accent-strong)]" /><span>Add <code>KIE_API_KEY</code> to the <code>.env</code> file on this machine.</span></li>
                <li className="flex items-start gap-3"><CheckCircle2 className="mt-1 size-4 shrink-0 text-[var(--accent-strong)]" /><span>Restart Media Studio so the API picks up the key.</span></li>
                <li className="flex items-start gap-3"><CheckCircle2 className="mt-1 size-4 shrink-0 text-[var(--accent-strong)]" /><span>Return here and confirm <strong>Live generation</strong> changes to <strong>Ready</strong>.</span></li>
              </ul>
            }
            note={
              <>
                Need a key?{" "}
                <a href={KIE_AFFILIATE_URL} target="_blank" rel="noreferrer" className="text-[var(--accent-strong)] underline underline-offset-4">
                  Get one from kie.ai
                </a>
                . {kieKeyConfigured ? "This machine already has a KIE key." : creditsReason}
              </>
            }
          />

          <SetupConnectionCard
            eyebrow="Optional service"
            title="Connect Codex"
            description="Uses the Codex app or CLI on this machine and your existing Codex or ChatGPT plan."
            powers="Prompt Enhance, recipe drafts, graph prompt.llm, and graph prompt.recipe."
            statusLabel={readinessStatus(codexLocalReady, codexLocalCommandAvailable).label}
            statusTone={readinessStatus(codexLocalReady, codexLocalCommandAvailable).tone}
            defaultOpen={false}
            steps={
              <ul className="space-y-2">
                <li className="flex items-start gap-3"><CheckCircle2 className="mt-1 size-4 shrink-0 text-[var(--accent-strong)]" /><span>Make sure Codex is installed on this machine.</span></li>
                <li className="flex items-start gap-3"><CheckCircle2 className="mt-1 size-4 shrink-0 text-[var(--accent-strong)]" /><span>Run <code>codex login</code> and sign in.</span></li>
                <li className="flex items-start gap-3"><CheckCircle2 className="mt-1 size-4 shrink-0 text-[var(--accent-strong)]" /><span>Open AI Settings and choose Codex Local for Prompt Enhance, recipe drafts, or graph prompt nodes.</span></li>
              </ul>
            }
            note="Codex Local unlocks the Studio Prompt Enhance button, Prompt Recipe drafting, graph prompt.llm, and graph prompt.recipe without using metered OpenAI API calls."
            actionHref={aiSettingsHref}
            actionLabel="Choose Codex in AI Settings"
          />

          <SetupConnectionCard
            eyebrow="Optional service"
            title="Connect OpenRouter"
            description="Hosted text and vision models billed through OpenRouter."
            powers="Prompt Enhance, recipe drafts, and graph prompt nodes when you want hosted models."
            statusLabel={readinessStatus(openRouterConfigured, openRouterConfigured).label}
            statusTone={readinessStatus(openRouterConfigured, openRouterConfigured).tone}
            defaultOpen={false}
            steps={
              <ul className="space-y-2">
                <li className="flex items-start gap-3"><CheckCircle2 className="mt-1 size-4 shrink-0 text-[var(--accent-strong)]" /><span>Add <code>OPENROUTER_API_KEY</code> to the <code>.env</code> file on this machine.</span></li>
                <li className="flex items-start gap-3"><CheckCircle2 className="mt-1 size-4 shrink-0 text-[var(--accent-strong)]" /><span>Restart Media Studio.</span></li>
                <li className="flex items-start gap-3"><CheckCircle2 className="mt-1 size-4 shrink-0 text-[var(--accent-strong)]" /><span>Open AI Settings and choose OpenRouter when you want hosted models.</span></li>
              </ul>
            }
            note="Use OpenRouter when you want hosted provider coverage beyond Codex Local. Media Studio tracks actual OpenRouter spend separately from KIE estimates."
            actionHref={aiSettingsHref}
            actionLabel="Choose OpenRouter in AI Settings"
          />

          <SetupConnectionCard
            eyebrow="Optional service"
            title="Connect Local OpenAI"
            description="Use your own local or self-hosted server if it speaks the OpenAI-style API."
            powers="Prompt Enhance, recipe drafts, and graph prompt nodes through your own endpoint."
            statusLabel={readinessStatus(localOpenAiReady, localOpenAiConfigured).label}
            statusTone={readinessStatus(localOpenAiReady, localOpenAiConfigured).tone}
            defaultOpen={false}
            steps={
              <ul className="space-y-2">
                <li className="flex items-start gap-3"><CheckCircle2 className="mt-1 size-4 shrink-0 text-[var(--accent-strong)]" /><span>Add <code>MEDIA_LOCAL_OPENAI_BASE_URL</code> to <code>.env</code>.</span></li>
                <li className="flex items-start gap-3"><CheckCircle2 className="mt-1 size-4 shrink-0 text-[var(--accent-strong)]" /><span>Add <code>MEDIA_LOCAL_OPENAI_API_KEY</code> if your server requires one.</span></li>
                <li className="flex items-start gap-3"><CheckCircle2 className="mt-1 size-4 shrink-0 text-[var(--accent-strong)]" /><span>Restart Media Studio, then use <strong>Test endpoint</strong> in AI Settings.</span></li>
              </ul>
            }
            note={
              <>
                Default local endpoint pattern: <code>{DEFAULT_LOCAL_OPENAI_BASE_URL}</code>. Media Studio only marks this provider fully ready after the endpoint responds successfully.
              </>
            }
            actionHref={aiSettingsHref}
            actionLabel="Test endpoint in AI Settings"
          />
        </section>

        <section className={adminSurfaceCardClassName}>
          <h2 className="text-[1.1rem] font-semibold tracking-[-0.03em] text-[var(--foreground)]">What each model setting controls</h2>
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <SetupCapabilityCard
              icon={<Sparkles className="size-3.5" />}
              title="Prompt Enhance default model"
              description="Used when you click Prompt Enhance in Studio. Change it in AI Settings."
            />
            <SetupCapabilityCard
              icon={<Cable className="size-3.5" />}
              title="Recipe draft model"
              description="Used when Media Studio writes the first draft of a Prompt Recipe. Change it in AI Settings."
            />
            <SetupCapabilityCard
              icon={<KeyRound className="size-3.5" />}
              title="Graph node model"
              description="Each graph prompt node chooses its own provider and model. Change it inside the workflow."
            />
          </div>
        </section>
      </div>
    </StudioAdminShell>
  );
}

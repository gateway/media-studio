import { CheckCircle2, KeyRound, PlayCircle, Sparkles, TerminalSquare } from "lucide-react";
import type { ReactNode } from "react";

import {
  adminStatCardClassName,
  adminSurfaceCardClassName,
  adminThemeLayoutClassName,
} from "@/components/admin-theme";
import { StatusPill } from "@/components/status-pill";
import { StudioAdminShell } from "@/components/studio-admin-shell";
import { getControlApiJson, getMediaDashboardSnapshot } from "@/lib/control-api";
import { DEFAULT_LOCAL_OPENAI_BASE_URL, KIE_AFFILIATE_URL } from "@/lib/onboarding";

function boolTone(value: boolean) {
  return value ? "healthy" : "warning";
}

function StepCard({
  step,
  title,
  description,
  detail,
  icon,
}: {
  step: string;
  title: string;
  description: string;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <div className={adminSurfaceCardClassName}>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-3">
          <div className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">
            {step}
          </div>
          <div>
            <h2 className="text-[1.05rem] font-semibold tracking-[-0.03em] text-[var(--foreground)]">{title}</h2>
            <p className="mt-2 text-sm leading-7 text-[var(--muted-strong)]">{description}</p>
          </div>
        </div>
        <div className="rounded-full border border-[var(--surface-border-soft)] bg-[color:var(--surface-muted)]/82 p-3 text-[var(--accent-strong)]">
          {icon}
        </div>
      </div>
      <div className="mt-4 rounded-[20px] border border-dashed border-[var(--surface-border)] px-4 py-3 text-sm leading-6 text-[var(--muted-strong)]">
        {detail}
      </div>
    </div>
  );
}

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
    <div className="flex items-start justify-between gap-4 rounded-[18px] border border-[var(--surface-border-soft)] bg-[color:var(--surface-muted)]/82 px-4 py-4">
      <div>
        <div className="text-sm font-semibold text-[var(--foreground)]">{label}</div>
        <div className="mt-1 text-sm leading-6 text-[var(--muted-strong)]">{detail}</div>
      </div>
      <StatusPill label={value} tone={tone} />
    </div>
  );
}

export default async function SetupPage() {
  const snapshot = await getMediaDashboardSnapshot();
  const credits = await getControlApiJson<Record<string, any>>("/media/credits");
  const health = (snapshot.status.data ?? {}) as Record<string, any>;
  const availableCredits =
    typeof credits.data?.available_credits === "number" ? credits.data.available_credits : null;
  const enhancementConfigs = snapshot.enhancementConfigs.data?.configs ?? [];
  const openRouterConfigured = Boolean(health.openrouter_api_key_configured);
  const kieRepoConnected = Boolean(health.kie_api_repo_connected);
  const kieKeyConfigured = Boolean(health.kie_api_key_configured);
  const liveSubmitEnabled = Boolean(health.live_submit_enabled);
  const queueEnabled = Boolean(snapshot.queueSettings.data?.settings?.queue_enabled);
  const modelsCount = snapshot.models.data?.models?.length ?? 0;
  const presetsCount = snapshot.presets.data?.presets?.length ?? 0;
  const creditsReason =
    typeof credits.data?.raw?.reason === "string" ? credits.data.raw.reason : "Credit balance becomes visible after you add a KIE API key.";
  const runnerReady = Boolean(health.runner_active) || !queueEnabled;
  const hasLocalEnhancementBase = enhancementConfigs.some((config) =>
    config.provider_kind === "local_openai" &&
    Boolean(config.provider_base_url_configured),
  );

  return (
    <StudioAdminShell
      section="setup"
      eyebrow="Getting Started"
      title="Set Up Media Studio"
      description="Follow the steps below. Run one setup script, add your KIE API key, and start the API and web app."
    >
      <div className={adminThemeLayoutClassName}>
        <section className={adminSurfaceCardClassName}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-[var(--accent-strong)]">
                Current Readiness
              </div>
              <h2 className="mt-2 text-[1.15rem] font-semibold tracking-[-0.03em] text-[var(--foreground)]">
                This machine
              </h2>
            </div>
            <StatusPill
              label={kieRepoConnected && kieKeyConfigured && liveSubmitEnabled ? "ready" : "needs setup"}
              tone={kieRepoConnected && kieKeyConfigured && liveSubmitEnabled ? "healthy" : "warning"}
            />
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            <StatusRow
              label="KIE API dependency"
              value={kieRepoConnected ? "connected" : "missing"}
              tone={boolTone(kieRepoConnected)}
              detail="Required. Media Studio uses the shared gateway/kie-api checkout and virtualenv."
            />
            <StatusRow
              label="KIE API key"
              value={kieKeyConfigured ? "configured" : "missing"}
              tone={boolTone(kieKeyConfigured)}
              detail={kieKeyConfigured ? "Required key is present." : creditsReason}
            />
            <StatusRow
              label="Live generation"
              value={liveSubmitEnabled ? "enabled" : "offline"}
              tone={boolTone(liveSubmitEnabled)}
              detail="Required for real image and video submits."
            />
            <StatusRow
              label="Prompt enhancement"
              value={openRouterConfigured || hasLocalEnhancementBase ? "configured" : "optional"}
              tone={openRouterConfigured || hasLocalEnhancementBase ? "healthy" : "neutral"}
              detail="Optional. Use OpenRouter or a local OpenAI-compatible endpoint."
            />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className={adminStatCardClassName}>
              <div className="text-[0.72rem] uppercase tracking-[0.14em] text-[var(--muted-strong)]">Models</div>
              <div className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{modelsCount}</div>
            </div>
            <div className={adminStatCardClassName}>
              <div className="text-[0.72rem] uppercase tracking-[0.14em] text-[var(--muted-strong)]">Presets</div>
              <div className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{presetsCount}</div>
            </div>
            <div className={adminStatCardClassName}>
              <div className="text-[0.72rem] uppercase tracking-[0.14em] text-[var(--muted-strong)]">Credits</div>
              <div className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
                {availableCredits !== null ? availableCredits.toFixed(1) : "n/a"}
              </div>
            </div>
            <div className={adminStatCardClassName}>
              <div className="text-[0.72rem] uppercase tracking-[0.14em] text-[var(--muted-strong)]">Runner</div>
              <div className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{runnerReady ? "ready" : "check"}</div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-3">
          <div className={`${adminSurfaceCardClassName} lg:col-span-2`}>
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--surface-border-soft)] bg-[rgba(208,255,72,0.08)] px-3 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-[var(--accent-strong)]">
              <Sparkles className="size-4" />
              Quick Start
            </div>
            <div className="mt-4 space-y-3">
              <h2 className="text-[1.5rem] font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                Use one command for your platform.
              </h2>
              <p className="max-w-3xl text-sm leading-7 text-[var(--muted-strong)]">
                The setup script reuses a supported sibling KIE checkout when present, otherwise it clones the required KIE API repo,
                installs the shared Python runtime, creates `.env`, bootstraps the local database, and prompts for required and optional keys.
              </p>
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="rounded-[20px] border border-[var(--surface-border-soft)] bg-[color:var(--surface-muted)]/82 p-4">
                <div className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">macOS</div>
                <pre className="mt-3 overflow-x-auto rounded-[16px] border border-[var(--surface-border-soft)] bg-[#0b0e0d] p-4 text-sm leading-7 text-[var(--foreground)]">
{`git clone https://github.com/gateway/media-studio.git
cd media-studio
./scripts/onboard_mac.sh`}
                </pre>
              </div>
              <div className="rounded-[20px] border border-[var(--surface-border-soft)] bg-[color:var(--surface-muted)]/82 p-4">
                <div className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">Windows</div>
                <pre className="mt-3 overflow-x-auto rounded-[16px] border border-[var(--surface-border-soft)] bg-[#0b0e0d] p-4 text-sm leading-7 text-[var(--foreground)]">
{`git clone https://github.com/gateway/media-studio.git
cd media-studio
powershell -ExecutionPolicy Bypass -File .\\scripts\\onboard_windows.ps1`}
                </pre>
              </div>
            </div>
          </div>

          <div className={adminSurfaceCardClassName}>
            <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-[var(--accent-strong)]">
              Required and Optional
            </div>
            <div className="mt-4 space-y-4 text-sm leading-7 text-[var(--muted-strong)]">
              <div>
                <div className="font-semibold text-[var(--foreground)]">Required</div>
                <div>`KIE_API_KEY` for live generation.</div>
                <div className="mt-2">
                  Get a key here:{" "}
                  <a href={KIE_AFFILIATE_URL} target="_blank" rel="noreferrer" className="text-[var(--accent-strong)] underline underline-offset-4">
                    kie.ai
                  </a>
                </div>
              </div>
              <div>
                <div className="font-semibold text-[var(--foreground)]">Optional</div>
                <div>`OPENROUTER_API_KEY` for hosted prompt enhancement.</div>
                <div>
                  `MEDIA_LOCAL_OPENAI_BASE_URL` and `MEDIA_LOCAL_OPENAI_API_KEY` for a local OpenAI-compatible endpoint.
                </div>
                <div className="mt-2 font-mono text-[var(--foreground)]">{DEFAULT_LOCAL_OPENAI_BASE_URL}</div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 md:grid-cols-2 2xl:grid-cols-4">
          <StepCard
            step="Step 1"
            title="Run the onboarding script"
            description="Use the platform-specific bootstrap path so dependencies, `.env`, and the local database are created consistently."
            detail="Run `./scripts/onboard_mac.sh` on macOS or `powershell -ExecutionPolicy Bypass -File .\\scripts\\onboard_windows.ps1` on Windows."
            icon={<TerminalSquare className="size-5" />}
          />
          <StepCard
            step="Step 2"
            title="Add your KIE API key"
            description="Live image and video generation requires a real KIE API key. Without it, Media Studio stays in offline-safe mode."
            detail="The setup flow points new users to your affiliate URL, lets them paste the key directly into `.env`, and enables live submit only when a key is present."
            icon={<KeyRound className="size-5" />}
          />
          <StepCard
            step="Step 3"
            title="Choose prompt enhancement"
            description="Prompt enhancement is optional. Hosted OpenRouter and local OpenAI-compatible endpoints are both supported."
            detail="If users skip this step, they can still generate media. They just won’t get external prompt enhancement until they add `OPENROUTER_API_KEY` or a local endpoint."
            icon={<Sparkles className="size-5" />}
          />
          <StepCard
            step="Step 4"
            title="Start the app"
            description="The script can optionally open the API and web commands in macOS Terminal, or users can run them manually."
            detail="Manual commands stay simple: `npm run dev:api` and `npm run dev:web`. Once both are up, use Studio for generation and Settings for provider tuning."
            icon={<PlayCircle className="size-5" />}
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div className={adminSurfaceCardClassName}>
            <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-[var(--accent-strong)]">
              What the script covers
            </div>
            <div className="mt-4 space-y-3 text-sm leading-7 text-[var(--muted-strong)]">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-1 size-4 shrink-0 text-[var(--accent-strong)]" />
                <span>Reuses a sibling KIE checkout or clones `gateway/kie-api` when none exists.</span>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-1 size-4 shrink-0 text-[var(--accent-strong)]" />
                <span>Creates or reuses the shared Python virtualenv.</span>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-1 size-4 shrink-0 text-[var(--accent-strong)]" />
                <span>Creates `.env` and a clean local database.</span>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-1 size-4 shrink-0 text-[var(--accent-strong)]" />
                <span>Prompts for required and optional keys.</span>
              </div>
            </div>
          </div>

          <div className={adminSurfaceCardClassName}>
            <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-[var(--accent-strong)]">
              After setup
            </div>
            <div className="mt-4 text-sm leading-7 text-[var(--muted-strong)]">
              Start the app with:
            </div>
            <pre className="mt-3 overflow-x-auto rounded-[16px] border border-[var(--surface-border-soft)] bg-[#0b0e0d] p-4 text-sm leading-7 text-[var(--foreground)]">
{`npm run dev:api
npm run dev:web`}
            </pre>
            <div className="mt-4 text-sm leading-7 text-[var(--muted-strong)]">
              Then open:
            </div>
            <div className="mt-3 space-y-2 text-sm leading-7 text-[var(--foreground)]">
              <div>`http://127.0.0.1:3000/setup`</div>
              <div>`http://127.0.0.1:3000/studio`</div>
            </div>
          </div>
        </section>
      </div>
    </StudioAdminShell>
  );
}

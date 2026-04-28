import { MediaModelsConsole } from "@/components/media-models-console";
import { Panel, PanelHeader } from "@/components/panel";
import { StudioAdminShell } from "@/components/studio-admin-shell";
import { StudioDebugSettings } from "@/components/studio-debug-settings";
import { MEDIA_STUDIO_VERSION } from "@/lib/app-version";
import { getMediaDashboardSnapshot } from "@/lib/control-api";

export default async function StudioSettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ project?: string }>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const snapshot = await getMediaDashboardSnapshot();

  return (
    <StudioAdminShell
      section="settings"
      currentProjectId={resolvedSearchParams.project ?? null}
      eyebrow="Studio Admin"
      title="Settings"
      description="Manage the Studio scheduler, enhancement provider, output path, supported models, and presets from one system view."
    >
      <Panel className="mb-6">
        <PanelHeader
          eyebrow="Build"
          title="Version"
          description="Use this number to confirm which local build you are testing before or after an update."
        />
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-white/8 bg-white/[0.035] px-4 py-3">
          <span className="text-sm font-semibold text-[var(--foreground)]">Current Media Studio build</span>
          <span className="rounded-full border border-[rgba(176,235,44,0.28)] bg-[rgba(176,235,44,0.08)] px-3 py-1 text-sm font-semibold text-[var(--accent-strong)]">
            {MEDIA_STUDIO_VERSION}
          </span>
        </div>
      </Panel>
      <MediaModelsConsole
        models={snapshot.models.data?.models ?? []}
        presets={snapshot.presets.data?.presets ?? []}
        enhancementConfigs={snapshot.enhancementConfigs.data?.configs ?? []}
        llmPresets={snapshot.llmPresets.data?.presets ?? []}
        queueSettings={snapshot.queueSettings.data?.settings ?? null}
        queuePolicies={snapshot.queuePolicies.data?.policies ?? []}
        sections={{
          queue: true,
          enhancementProvider: true,
          modelHelper: false,
          studioSettings: true,
          modelPanel: false,
          presets: false,
        }}
      />
      <StudioDebugSettings />
    </StudioAdminShell>
  );
}

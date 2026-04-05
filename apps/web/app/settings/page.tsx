import { MediaModelsConsole } from "@/components/media-models-console";
import { StudioAdminShell } from "@/components/studio-admin-shell";
import { StudioDebugSettings } from "@/components/studio-debug-settings";
import { getMediaDashboardSnapshot } from "@/lib/control-api";

export default async function StudioSettingsPage() {
  const snapshot = await getMediaDashboardSnapshot();

  return (
    <StudioAdminShell
      section="settings"
      eyebrow="Studio Admin"
      title="Settings"
      description="Manage the Studio scheduler, enhancement provider, output path, supported models, and presets from one system view."
    >
      <StudioDebugSettings />
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
    </StudioAdminShell>
  );
}

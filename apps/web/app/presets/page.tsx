import { MediaModelsConsole } from "@/components/media-models-console";
import { StudioAdminShell } from "@/components/studio-admin-shell";
import { getMediaDashboardSnapshot } from "@/lib/control-api";

export default async function MediaPresetsPage() {
  const snapshot = await getMediaDashboardSnapshot();

  return (
    <StudioAdminShell
      section="presets"
      eyebrow="Studio Admin"
      title="Presets"
      description="Manage structured Studio presets in one place, then assign them to Nano Banana 2 and Nano Banana Pro as needed."
    >
      <MediaModelsConsole
        models={snapshot.models.data?.models ?? []}
        presets={snapshot.presets.data?.presets ?? []}
        enhancementConfigs={snapshot.enhancementConfigs.data?.configs ?? []}
        llmPresets={snapshot.llmPresets.data?.presets ?? []}
        queueSettings={snapshot.queueSettings.data?.settings ?? null}
        queuePolicies={snapshot.queuePolicies.data?.policies ?? []}
        sections={{
          queue: false,
          enhancementProvider: false,
          modelHelper: false,
          studioSettings: false,
          modelPanel: false,
          presets: true,
        }}
      />
    </StudioAdminShell>
  );
}

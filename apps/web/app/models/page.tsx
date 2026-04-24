import { MediaModelsConsole } from "@/components/media-models-console";
import { StudioAdminShell } from "@/components/studio-admin-shell";
import { getMediaDashboardSnapshot } from "@/lib/control-api";

export default async function MediaModelsPage({
  searchParams,
}: {
  searchParams?: Promise<{ model?: string; project?: string }>;
}) {
  const snapshot = await getMediaDashboardSnapshot();
  const resolvedSearchParams = (await searchParams) ?? {};

  return (
    <StudioAdminShell
      section="models"
      currentProjectId={resolvedSearchParams.project ?? null}
      eyebrow="Studio Admin"
      title="Models"
      description="Choose a Studio model, then manage everything tied to that model in one place: capabilities, output limits, and prompt helper instructions."
    >
      <MediaModelsConsole
        models={snapshot.models.data?.models ?? []}
        presets={snapshot.presets.data?.presets ?? []}
        enhancementConfigs={snapshot.enhancementConfigs.data?.configs ?? []}
        llmPresets={snapshot.llmPresets.data?.presets ?? []}
        queueSettings={snapshot.queueSettings.data?.settings ?? null}
        queuePolicies={snapshot.queuePolicies.data?.policies ?? []}
        initialSelectedModelKey={resolvedSearchParams.model}
        sections={{
          queue: false,
          enhancementProvider: false,
          modelHelper: true,
          studioSettings: false,
          modelPanel: true,
          presets: false,
        }}
      />
    </StudioAdminShell>
  );
}

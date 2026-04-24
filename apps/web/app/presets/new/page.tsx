import { MediaPresetEditorScreen } from "@/components/media-preset-editor-screen";
import { StudioAdminShell } from "@/components/studio-admin-shell";
import { getMediaDashboardSnapshot } from "@/lib/control-api";

export default async function NewMediaPresetPage({
  searchParams,
}: {
  searchParams?: Promise<{ model?: string; returnTo?: string; project?: string }>;
}) {
  const snapshot = await getMediaDashboardSnapshot();
  const resolvedSearchParams = (await searchParams) ?? {};

  return (
    <StudioAdminShell
      section="presets"
      currentProjectId={resolvedSearchParams.project ?? null}
      eyebrow="Studio Admin"
      title="New Preset"
      description="Create a reusable structured preset for Studio and assign which Nano Banana models it should appear in."
    >
      <MediaPresetEditorScreen
        models={snapshot.models.data?.models ?? []}
        presets={snapshot.presets.data?.presets ?? []}
        initialModelKey={resolvedSearchParams.model ?? "nano-banana-2"}
        initialReturnTo={resolvedSearchParams.returnTo ?? null}
      />
    </StudioAdminShell>
  );
}

import { MediaPresetEditorScreen } from "@/components/media-preset-editor-screen";
import { StudioAdminShell } from "@/components/studio-admin-shell";
import { getMediaDashboardSnapshot } from "@/lib/control-api";

export default async function NewMediaPresetPage({
  searchParams,
}: {
  searchParams?: Promise<{ model?: string }>;
}) {
  const snapshot = await getMediaDashboardSnapshot();
  const resolvedSearchParams = (await searchParams) ?? {};

  return (
    <StudioAdminShell
      section="models"
      eyebrow="Studio Admin"
      title="New Preset"
      description="Create a reusable structured preset using the same Models admin system as the rest of Studio."
    >
      <MediaPresetEditorScreen
        models={snapshot.models.data?.models ?? []}
        presets={snapshot.presets.data?.presets ?? []}
        initialModelKey={resolvedSearchParams.model ?? "nano-banana-2"}
      />
    </StudioAdminShell>
  );
}

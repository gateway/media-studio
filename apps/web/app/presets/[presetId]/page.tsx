import { notFound } from "next/navigation";

import { MediaPresetEditorScreen } from "@/components/media-preset-editor-screen";
import { StudioAdminShell } from "@/components/studio-admin-shell";
import { getMediaDashboardSnapshot } from "@/lib/control-api";

export default async function EditMediaPresetPage({
  params,
}: {
  params: Promise<{ presetId: string }>;
}) {
  const snapshot = await getMediaDashboardSnapshot();
  const resolvedParams = await params;
  const presets = snapshot.presets.data?.presets ?? [];
  const preset = presets.find((entry) => entry.preset_id === resolvedParams.presetId);
  if (!preset) {
    notFound();
  }

  return (
    <StudioAdminShell
      section="presets"
      eyebrow="Studio Admin"
      title="Edit Preset"
      description="Update preset scope, prompt structure, and inputs from the dedicated Presets admin route."
    >
      <MediaPresetEditorScreen
        models={snapshot.models.data?.models ?? []}
        presets={presets}
        initialPresetId={resolvedParams.presetId}
        initialModelKey={preset.model_key ?? "nano-banana-2"}
      />
    </StudioAdminShell>
  );
}

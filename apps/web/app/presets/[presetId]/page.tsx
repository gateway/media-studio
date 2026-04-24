import { notFound } from "next/navigation";

import { MediaPresetEditorScreen } from "@/components/media-preset-editor-screen";
import { StudioAdminShell } from "@/components/studio-admin-shell";
import { getMediaDashboardSnapshot } from "@/lib/control-api";

export default async function EditMediaPresetPage({
  params,
  searchParams,
}: {
  params: Promise<{ presetId: string }>;
  searchParams?: Promise<{ returnTo?: string; project?: string }>;
}) {
  const snapshot = await getMediaDashboardSnapshot();
  const resolvedParams = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const presets = snapshot.presets.data?.presets ?? [];
  const preset = presets.find((entry) => entry.preset_id === resolvedParams.presetId);
  if (!preset) {
    notFound();
  }

  return (
    <StudioAdminShell
      section="presets"
      currentProjectId={resolvedSearchParams.project ?? null}
      eyebrow="Studio Admin"
      title="Edit Preset"
      description="Update preset scope, prompt structure, and inputs from the dedicated Presets admin route."
    >
      <MediaPresetEditorScreen
        models={snapshot.models.data?.models ?? []}
        presets={presets}
        initialPresetId={resolvedParams.presetId}
        initialModelKey={preset.model_key ?? "nano-banana-2"}
        initialReturnTo={resolvedSearchParams.returnTo ?? null}
      />
    </StudioAdminShell>
  );
}

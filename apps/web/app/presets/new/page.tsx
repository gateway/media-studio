import { MediaPresetEditorScreen } from "@/components/media-preset-editor-screen";
import { StudioAdminShell } from "@/components/studio-admin-shell";
import { getControlPlaneSnapshot } from "@/lib/control-api";

export default async function NewMediaPresetPage({
  searchParams,
}: {
  searchParams?: Promise<{
    assistantDraft?: string;
    assistantMessage?: string;
    assistantSession?: string;
    model?: string;
    returnTo?: string;
    project?: string;
  }>;
}) {
  const snapshot = await getControlPlaneSnapshot();
  const resolvedSearchParams = (await searchParams) ?? {};

  return (
    <StudioAdminShell
      section="presets"
      currentProjectId={resolvedSearchParams.project ?? null}
      eyebrow="Studio Admin"
      title="New Preset"
      description="Create a reusable structured preset for Studio and assign which compatible image models it should appear in."
    >
      <MediaPresetEditorScreen
        models={snapshot.models.data?.models ?? []}
        presets={[]}
        initialModelKey={resolvedSearchParams.model ?? "nano-banana-2"}
        initialReturnTo={resolvedSearchParams.returnTo ?? null}
        initialAssistantDraftId={resolvedSearchParams.assistantDraft ?? null}
        initialAssistantSessionId={resolvedSearchParams.assistantSession ?? null}
        initialAssistantMessageId={resolvedSearchParams.assistantMessage ?? null}
      />
    </StudioAdminShell>
  );
}

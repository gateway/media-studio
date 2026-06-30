import { PromptRecipeEditorScreen } from "@/components/prompt-recipes/prompt-recipe-editor-screen";
import { StudioAdminShell } from "@/components/studio-admin-shell";
import { getMediaDashboardSnapshot } from "@/lib/control-api";

export default async function NewPromptRecipePage({
  searchParams,
}: {
  searchParams?: Promise<{
    assistantDraft?: string;
    assistantMessage?: string;
    assistantSession?: string;
    returnTo?: string;
    project?: string;
  }>;
}) {
  const snapshot = await getMediaDashboardSnapshot();
  const resolvedSearchParams = (await searchParams) ?? {};

  return (
    <StudioAdminShell
      section="presets"
      currentProjectId={resolvedSearchParams.project ?? null}
      eyebrow="Studio Admin"
      title="New Prompt Recipe"
      description="Create a reusable LLM director template for future Graph node ingestion."
    >
      <PromptRecipeEditorScreen
        recipes={snapshot.promptRecipes.data?.recipes ?? []}
        initialReturnTo={resolvedSearchParams.returnTo ?? "/presets?tab=prompt-recipes"}
        initialDraftingConfig={snapshot.promptRecipeDraftingConfig.data?.config ?? null}
        initialAssistantDraftId={resolvedSearchParams.assistantDraft ?? null}
        initialAssistantSessionId={resolvedSearchParams.assistantSession ?? null}
        initialAssistantMessageId={resolvedSearchParams.assistantMessage ?? null}
      />
    </StudioAdminShell>
  );
}

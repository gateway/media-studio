import { notFound } from "next/navigation";

import { PromptRecipeEditorScreen } from "@/components/prompt-recipes/prompt-recipe-editor-screen";
import { StudioAdminShell } from "@/components/studio-admin-shell";
import { getMediaDashboardSnapshot } from "@/lib/control-api";

export default async function EditPromptRecipePage({
  params,
  searchParams,
}: {
  params: Promise<{ recipeId: string }>;
  searchParams?: Promise<{ returnTo?: string; project?: string }>;
}) {
  const snapshot = await getMediaDashboardSnapshot();
  const resolvedParams = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const recipes = snapshot.promptRecipes.data?.recipes ?? [];
  const recipe = recipes.find((entry) => entry.recipe_id === resolvedParams.recipeId);
  if (!recipe) {
    notFound();
  }

  return (
    <StudioAdminShell
      section="presets"
      currentProjectId={resolvedSearchParams.project ?? null}
      eyebrow="Studio Admin"
      title="Edit Prompt Recipe"
      description="Update a saved LLM director template without touching Media Presets."
    >
      <PromptRecipeEditorScreen
        recipes={recipes}
        initialRecipeId={resolvedParams.recipeId}
        initialReturnTo={resolvedSearchParams.returnTo ?? "/presets?tab=prompt-recipes"}
      />
    </StudioAdminShell>
  );
}

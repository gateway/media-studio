import { PresetsTabs } from "@/components/prompt-recipes/presets-tabs";
import { StudioAdminShell } from "@/components/studio-admin-shell";
import { getMediaDashboardSnapshot } from "@/lib/control-api";

export default async function PresetsPage({
  searchParams,
}: {
  searchParams?: Promise<{ project?: string; tab?: string }>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const snapshot = await getMediaDashboardSnapshot();
  const activeTab = resolvedSearchParams.tab === "prompt-recipes" ? "prompt-recipes" : "media";

  return (
    <StudioAdminShell
      section="presets"
      currentProjectId={resolvedSearchParams.project ?? null}
      eyebrow="Studio Admin"
      title="Presets"
      description="Manage reusable Media Presets and Prompt Recipes from one admin area while keeping their data models separate."
    >
      <PresetsTabs
        activeTab={activeTab}
        models={snapshot.models.data?.models ?? []}
        presets={snapshot.presets.data?.presets ?? []}
        promptRecipes={snapshot.promptRecipes.data?.recipes ?? []}
        enhancementConfigs={snapshot.enhancementConfigs.data?.configs ?? []}
        queueSettings={snapshot.queueSettings.data?.settings ?? null}
        queuePolicies={snapshot.queuePolicies.data?.policies ?? []}
      />
    </StudioAdminShell>
  );
}

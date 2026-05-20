import { LlmSettingsConsole } from "@/components/settings/llm-settings-console";
import { SettingsSectionTabs } from "@/components/settings/settings-section-tabs";
import { StudioAdminShell } from "@/components/studio-admin-shell";
import { adminSectionStackClassName } from "@/components/admin-theme";
import { getMediaDashboardSnapshot } from "@/lib/control-api";

export default async function StudioLlmSettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ project?: string }>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const snapshot = await getMediaDashboardSnapshot();
  const currentProjectId = resolvedSearchParams.project ?? null;

  return (
    <StudioAdminShell
      section="settings"
      currentProjectId={currentProjectId}
      eyebrow="Studio Admin"
      title="AI Settings"
      description="Choose the default models for Enhance and recipe drafts. Graph workflows pick their own models inside each node."
    >
      <div className={adminSectionStackClassName}>
        <SettingsSectionTabs activeTab="llms" currentProjectId={currentProjectId} />
      </div>
      <LlmSettingsConsole
        enhancementConfigs={snapshot.enhancementConfigs.data?.configs ?? []}
        promptRecipeDraftingConfig={snapshot.promptRecipeDraftingConfig.data?.config ?? null}
        openRouterSpend={snapshot.externalLlmUsageSummary.data?.summary ?? null}
        health={snapshot.status.data ?? {}}
      />
    </StudioAdminShell>
  );
}

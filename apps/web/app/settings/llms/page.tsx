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
      title="AI Models"
      description="Open a task, choose a connected provider, select and test a model, then save. Manage credentials in Connections."
    >
      <div className={adminSectionStackClassName}>
        <SettingsSectionTabs activeTab="llms" currentProjectId={currentProjectId} />
      </div>
      <LlmSettingsConsole
        currentProjectId={currentProjectId}
        enhancementConfigs={snapshot.enhancementConfigs.data?.configs ?? []}
        mediaAssistantConfig={snapshot.mediaAssistantConfig.data?.config ?? null}
        promptRecipeDraftingConfig={snapshot.promptRecipeDraftingConfig.data?.config ?? null}
        openRouterSpend={snapshot.externalLlmUsageSummary.data?.summary ?? null}
      />
    </StudioAdminShell>
  );
}

import { MediaModelsConsole } from "@/components/media-models-console";
import { AdminNavButton } from "@/components/admin-nav-button";
import { SettingsSectionTabs } from "@/components/settings/settings-section-tabs";
import { StudioAdminShell } from "@/components/studio-admin-shell";
import { StudioDebugSettings } from "@/components/studio-debug-settings";
import { Panel, PanelHeader } from "@/components/panel";
import { adminSectionStackClassName } from "@/components/admin-theme";
import { getMediaDashboardSnapshot } from "@/lib/control-api";
import { buildStudioScopedHref } from "@/lib/studio-navigation";

export default async function StudioSettingsPage({
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
      title="Settings"
      description="Manage the Studio runtime, queue behavior, output path, and system-level controls. AI provider setup now lives under its own settings section."
    >
      <div className={adminSectionStackClassName}>
        <SettingsSectionTabs activeTab="general" currentProjectId={currentProjectId} />
      </div>
      <Panel>
        <PanelHeader
          eyebrow="AI Settings"
          title="AI setup moved into its own route"
          description="Use the dedicated AI settings surface for Codex Local, OpenRouter, Local OpenAI-compatible connections, Studio enhancement defaults, and recipe draft defaults."
          action={
            <AdminNavButton
              href={buildStudioScopedHref("/settings/llms", currentProjectId)}
              variant="subtle"
              size="compact"
            >
              Open AI Settings
            </AdminNavButton>
          }
        />
      </Panel>
      <MediaModelsConsole
        models={snapshot.models.data?.models ?? []}
        presets={snapshot.presets.data?.presets ?? []}
        enhancementConfigs={snapshot.enhancementConfigs.data?.configs ?? []}
        queueSettings={snapshot.queueSettings.data?.settings ?? null}
        queuePolicies={snapshot.queuePolicies.data?.policies ?? []}
        sections={{
          queue: true,
          enhancementProvider: false,
          modelHelper: false,
          studioSettings: true,
          modelPanel: false,
          presets: false,
        }}
      />
      <StudioDebugSettings />
    </StudioAdminShell>
  );
}

"use client";

import { AdminSectionTabs } from "@/components/admin-section-tabs";

const settingsTabs = [
  { key: "general", label: "General", href: "/settings" },
  { key: "connections", label: "Connections", href: "/settings/connections" },
  { key: "llms", label: "AI Models", href: "/settings/llms" },
] as const;

export function SettingsSectionTabs({
  activeTab,
  currentProjectId = null,
}: {
  activeTab: (typeof settingsTabs)[number]["key"];
  currentProjectId?: string | null;
}) {
  return (
    <AdminSectionTabs items={settingsTabs} activeKey={activeTab} currentProjectId={currentProjectId} />
  );
}

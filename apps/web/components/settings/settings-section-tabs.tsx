"use client";

import { AdminButton } from "@/components/admin-controls";
import { AdminNavButton } from "@/components/admin-nav-button";
import { adminCompactTabButtonClassName, adminTabsRowClassName } from "@/components/admin-theme";
import { buildStudioScopedHref } from "@/lib/studio-navigation";

const settingsTabs = [
  { key: "general", label: "General", href: "/settings" },
  { key: "llms", label: "AI", href: "/settings/llms" },
] as const;

export function SettingsSectionTabs({
  activeTab,
  currentProjectId = null,
}: {
  activeTab: (typeof settingsTabs)[number]["key"];
  currentProjectId?: string | null;
}) {
  return (
    <div className={adminTabsRowClassName}>
      {settingsTabs.map((item) =>
        item.key === activeTab ? (
          <AdminButton
            key={item.key}
            variant="primary"
            size="compact"
            className={adminCompactTabButtonClassName}
            aria-current="page"
            disabled
          >
            {item.label}
          </AdminButton>
        ) : (
          <AdminNavButton
            key={item.key}
            href={buildStudioScopedHref(item.href, currentProjectId)}
            variant="subtle"
            size="compact"
            className={adminCompactTabButtonClassName}
          >
            {item.label}
          </AdminNavButton>
        ),
      )}
    </div>
  );
}

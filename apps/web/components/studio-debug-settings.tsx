"use client";

import { useEffect, useState } from "react";

import { AdminToggle } from "@/components/admin-controls";
import { adminThemeVarsClassName } from "@/components/admin-theme";
import { Panel, PanelHeader } from "@/components/panel";
import { installStudioDebugConsole, isStudioDebugEnabled, setStudioDebugEnabled } from "@/lib/studio-debug";

export function StudioDebugSettings() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    installStudioDebugConsole();
    setEnabled(isStudioDebugEnabled());
  }, []);

  function toggleDebug() {
    const next = !enabled;
    setStudioDebugEnabled(next);
    setEnabled(next);
  }

  return (
    <Panel className={adminThemeVarsClassName}>
      <PanelHeader
        eyebrow="Diagnostics"
        title="Studio Debug Console"
        description="Mirror Studio operational messages to the browser console while keeping the normal composer status UI."
      />
      <div className="admin-surface-inset mt-5 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="grid gap-2">
          <div className="flex items-center gap-2">
            <span className="admin-label-muted">Browser Debug Logging</span>
          </div>
          <div className="text-sm leading-6 text-[var(--muted-strong)]">
            Uses local browser storage only. You can still control it manually with{" "}
            <code className="admin-inline-code">
              window.__mediaStudioDebug.enable()
            </code>{" "}
            and{" "}
            <code className="admin-inline-code">
              window.__mediaStudioDebug.disable()
            </code>.
          </div>
        </div>
          <AdminToggle checked={enabled} onToggle={toggleDebug} ariaLabel="Toggle Studio debug console logging" />
        </div>
      </div>
    </Panel>
  );
}

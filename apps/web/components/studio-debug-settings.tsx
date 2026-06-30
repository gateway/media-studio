"use client";

import { useEffect, useState } from "react";

import { AdminToggleRow } from "@/components/admin-controls";
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
        <AdminToggleRow
          title="Browser Debug Logging"
          description={
            <>
              Uses local browser storage only. You can still control it manually with{" "}
              <code className="admin-inline-code">
                window.__mediaStudioDebug.enable()
              </code>{" "}
              and{" "}
              <code className="admin-inline-code">
                window.__mediaStudioDebug.disable()
              </code>.
            </>
          }
          checked={enabled}
          onToggle={toggleDebug}
          ariaLabel="Toggle Studio debug console logging"
        />
      </div>
    </Panel>
  );
}

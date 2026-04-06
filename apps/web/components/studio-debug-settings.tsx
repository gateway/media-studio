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
      <div className="mt-5 rounded-[22px] border border-white/8 bg-[rgba(11,14,13,0.92)] p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="grid gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[var(--muted-strong)]">
              Browser Debug Logging
            </span>
          </div>
          <div className="text-sm leading-6 text-[var(--muted-strong)]">
            Uses local browser storage only. You can still control it manually with{" "}
            <code className="rounded-[10px] border border-[var(--surface-border-soft)] bg-[color:var(--surface-muted)]/82 px-2 py-1 text-[0.78rem] text-[var(--foreground)]">
              window.__mediaStudioDebug.enable()
            </code>{" "}
            and{" "}
            <code className="rounded-[10px] border border-[var(--surface-border-soft)] bg-[color:var(--surface-muted)]/82 px-2 py-1 text-[0.78rem] text-[var(--foreground)]">
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

"use client";

import { useEffect, useState } from "react";

import { AdminToggle, adminInsetPanelClassName } from "@/components/admin-controls";
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
    <section className={adminInsetPanelClassName}>
      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-2">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted-strong)]">
            Studio Debug Console
          </div>
          <div className="text-sm leading-6 text-white/72">
            Mirror Studio operational messages to the browser console while keeping the normal composer status UI.
          </div>
          <div className="text-xs leading-5 text-white/50">
            Uses local browser storage only. You can still control it manually with <code>window.__mediaStudioDebug.enable()</code> and <code>window.__mediaStudioDebug.disable()</code>.
          </div>
        </div>
        <AdminToggle checked={enabled} onToggle={toggleDebug} ariaLabel="Toggle Studio debug console logging" />
      </div>
    </section>
  );
}

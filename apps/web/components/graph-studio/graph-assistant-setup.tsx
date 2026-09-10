"use client";

import type { CSSProperties } from "react";
import { X } from "lucide-react";
import type { GraphAssistantAvailability } from "./hooks/use-graph-assistant-availability";

const SETUP_STATUS = {
  checking: ["Checking Media Assistant", "Checking this installation and its local Codex connection."],
  disabled: ["Media Assistant is not enabled", "Set NEXT_PUBLIC_MEDIA_STUDIO_ASSISTANT_DEBUG=1 in this installation’s environment before starting the API and web app, then restart both."],
  missing: ["Install Codex to use Media Assistant", "Codex was not found on the machine running Media Studio. Install it and sign in, then check again."],
  signed_out: ["Sign in to Codex", "Codex is installed, but no local sign-in was found. Run codex in a terminal on the machine running Media Studio and complete sign-in."],
  unready: ["Codex Local is not ready", "Media Studio could not confirm a working Codex connection. Review Codex Local in AI Settings, then check again."],
  error: ["Could not check Media Assistant", "The Media Studio health check failed. Confirm the app is running, then check again."],
} satisfies Record<Exclude<GraphAssistantAvailability, "ready">, readonly [string, string]>;

export function GraphAssistantSetup({ status, bottomOffset, onCheckAgain, onClose }: {
  status: Exclude<GraphAssistantAvailability, "ready">;
  bottomOffset: number;
  onCheckAgain: () => void;
  onClose: () => void;
}) {
  const [title, detail] = SETUP_STATUS[status];
  return (
    <aside className="graph-assistant-panel" aria-label="Media assistant setup" style={{
      "--graph-assistant-bottom": `${bottomOffset}px`,
      "--graph-assistant-width-max": "560px",
      "--graph-assistant-composer-height-min": "0px",
    } as CSSProperties}>
      <div className="graph-assistant-composer-shell">
        <header className="graph-assistant-header">
          <span>Media Assistant</span>
          <button type="button" aria-label="Close Media Assistant setup" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="graph-assistant-body">
          <div className="graph-assistant-readiness" role="status">
            <strong>{title}</strong>
            <span>{detail}</span>
            <span>Media Assistant requires Codex Local on the machine running Media Studio. Media Studio starts its runtime automatically once it is set up.</span>
            <a href="/setup">Open Setup</a>
            <a href="/settings/llms">AI Settings</a>
          </div>
        </div>
        <footer className="graph-assistant-footer">
          <button type="button" onClick={onCheckAgain} disabled={status === "checking"}>Check again</button>
        </footer>
      </div>
    </aside>
  );
}

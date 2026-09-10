"use client";

import { useCallback, useEffect, useState } from "react";
import { isGraphAssistantAvailable, isGraphAssistantDebugEnabled } from "@/lib/graph-assistant-debug";
import type { ControlApiHealthData } from "@/lib/types";

export type GraphAssistantAvailability = "checking" | "disabled" | "missing" | "signed_out" | "unready" | "error" | "ready";

export function useGraphAssistantAvailability() {
  const [status, setStatus] = useState<GraphAssistantAvailability>("checking");
  const [revision, setRevision] = useState(0);
  const checkAgain = useCallback(() => {
    setStatus("checking");
    setRevision((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!isGraphAssistantDebugEnabled()) {
      setStatus("disabled");
      return;
    }
    let cancelled = false;
    fetch("/api/control/health", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Health check returned ${response.status}.`);
        return (await response.json()) as ControlApiHealthData;
      })
      .then((health) => {
        if (cancelled) return;
        setStatus(
          isGraphAssistantAvailable(health) ? "ready"
            : health.media_assistant_enabled !== true ? "disabled"
              : health.codex_local_command_available === false ? "missing"
                : health.codex_local_login_configured === false ? "signed_out"
                  : "unready",
        );
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => { cancelled = true; };
  }, [revision]);

  return { status, checkAgain };
}

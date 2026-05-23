import { useCallback, useState } from "react";

import type { GraphArtifact, GraphRunHistoryItem } from "../types";
import { jsonFetch } from "../utils/graph-api";

export function useGraphRunHistory({
  workflowId,
  appendConsole,
}: {
  workflowId: string | null;
  appendConsole: (line: string) => void;
}) {
  const [runHistory, setRunHistory] = useState<GraphRunHistoryItem[]>([]);
  const [selectedHistoryRunId, setSelectedHistoryRunId] = useState<string | null>(null);
  const [selectedRunArtifacts, setSelectedRunArtifacts] = useState<GraphArtifact[]>([]);

  const refreshRunHistory = useCallback(async () => {
    if (!workflowId) {
      setRunHistory([]);
      setSelectedRunArtifacts([]);
      return;
    }
    const payload = await jsonFetch<{ items?: GraphRunHistoryItem[] }>(`/api/control/media/graph/workflows/${workflowId}/runs/summary?limit=15`);
    setRunHistory(payload.items ?? []);
  }, [workflowId]);

  const inspectRunArtifacts = useCallback(
    async (runId: string) => {
      setSelectedHistoryRunId(runId);
      const payload = await jsonFetch<{ items?: GraphArtifact[] }>(`/api/control/media/graph/runs/${runId}/artifacts`);
      setSelectedRunArtifacts(payload.items ?? []);
      appendConsole(`Loaded artifacts for ${runId}.`);
    },
    [appendConsole],
  );

  const clearRunHistory = useCallback(() => {
    setRunHistory([]);
    setSelectedHistoryRunId(null);
    setSelectedRunArtifacts([]);
  }, []);

  return {
    runHistory,
    selectedHistoryRunId,
    selectedRunArtifacts,
    refreshRunHistory,
    inspectRunArtifacts,
    clearRunHistory,
  };
}

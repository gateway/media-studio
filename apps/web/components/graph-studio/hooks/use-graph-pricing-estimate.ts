import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { GraphEstimateResponse, GraphWorkflowPayload, StudioEdge, StudioNode } from "../types";
import { jsonFetch } from "../utils/graph-api";
import { graphPricingNeedsConfirmation } from "../utils/graph-pricing";

type PricingConfirmationState = { estimate: GraphEstimateResponse; resolve: (confirmed: boolean) => void };

export function useGraphPricingEstimate({
  workflowId,
  workflowName,
  nodes,
  edges,
  availableCredits,
  workflowFromCanvas,
  appendConsole,
}: {
  workflowId: string | null;
  workflowName: string;
  nodes: StudioNode[];
  edges: StudioEdge[];
  availableCredits: number | null;
  workflowFromCanvas: (workflowId: string | null, workflowName: string, nodes: StudioNode[], edges: StudioEdge[]) => GraphWorkflowPayload;
  appendConsole: (line: string) => void;
}) {
  const [graphEstimate, setGraphEstimate] = useState<GraphEstimateResponse | null>(null);
  const [pricingConfirmation, setPricingConfirmation] = useState<PricingConfirmationState | null>(null);
  const latestRequest = useRef(0);

  const refreshGraphEstimate = useCallback(async () => {
    if (!nodes.length) {
      setGraphEstimate(null);
      return null;
    }
    const requestId = latestRequest.current + 1;
    latestRequest.current = requestId;
    const estimate = await jsonFetch<GraphEstimateResponse>("/api/control/media/graph/estimate", {
      method: "POST",
      body: JSON.stringify(workflowFromCanvas(workflowId, workflowName, nodes, edges)),
    });
    if (latestRequest.current === requestId) setGraphEstimate(estimate);
    return estimate;
  }, [edges, nodes, workflowFromCanvas, workflowId, workflowName]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      refreshGraphEstimate().catch((error) => appendConsole(`Graph estimate failed: ${(error as Error).message}`));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [appendConsole, refreshGraphEstimate]);

  const confirmPricingForRun = useCallback(async () => {
    const estimate = await refreshGraphEstimate();
    if (!graphPricingNeedsConfirmation(estimate, availableCredits)) return true;
    return new Promise<boolean>((resolve) => setPricingConfirmation({ estimate: estimate!, resolve }));
  }, [availableCredits, refreshGraphEstimate]);

  const answerPricingConfirmation = useCallback((confirmed: boolean) => {
    setPricingConfirmation((current) => {
      current?.resolve(confirmed);
      return null;
    });
  }, []);

  const pricingByNode = useMemo(() => graphEstimate?.nodes ?? {}, [graphEstimate]);

  return { graphEstimate, pricingByNode, refreshGraphEstimate, confirmPricingForRun, pricingConfirmation, answerPricingConfirmation };
}

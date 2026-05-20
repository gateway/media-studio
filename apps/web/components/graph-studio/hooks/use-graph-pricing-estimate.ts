import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { recordStudioRuntimeMetric } from "@/lib/studio-runtime-metrics";
import type { GraphEstimateResponse, GraphWorkflowPayload, StudioEdge, StudioNode } from "../types";
import { jsonFetch } from "../utils/graph-api";
import { readSkipGraphPricingConfirmationPreference, writeSkipGraphPricingConfirmationPreference } from "../utils/graph-pricing-preferences";
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
  const [skipPricingConfirmation, setSkipPricingConfirmation] = useState(() => readSkipGraphPricingConfirmationPreference());
  const latestRequest = useRef(0);
  const lastResolvedSignatureRef = useRef<string | null>(null);
  const inFlightSignatureRef = useRef<string | null>(null);
  const inFlightPromiseRef = useRef<Promise<GraphEstimateResponse | null> | null>(null);

  const workflowPayload = useMemo(
    () => (nodes.length ? workflowFromCanvas(workflowId, workflowName, nodes, edges) : null),
    [edges, nodes, workflowFromCanvas, workflowId, workflowName],
  );
  const pricingWorkflowPayload = useMemo(() => {
    if (!workflowPayload) {
      return null;
    }
    return {
      ...workflowPayload,
      nodes: workflowPayload.nodes.map((node) => {
        const execution = (node.metadata?.execution ?? {}) as { mode?: string };
        return {
          ...node,
          metadata: {
            ...node.metadata,
            execution: {
              mode: execution.mode ?? "enabled",
            },
          },
        };
      }),
    } satisfies GraphWorkflowPayload;
  }, [workflowPayload]);
  const workflowSignature = useMemo(
    () => (pricingWorkflowPayload ? JSON.stringify(pricingWorkflowPayload) : null),
    [pricingWorkflowPayload],
  );

  const refreshGraphEstimate = useCallback(async () => {
    if (!pricingWorkflowPayload || !workflowSignature) {
      setGraphEstimate(null);
      lastResolvedSignatureRef.current = null;
      return null;
    }
    if (lastResolvedSignatureRef.current === workflowSignature && graphEstimate) {
      recordStudioRuntimeMetric("graphEstimate.cacheHit");
      return graphEstimate;
    }
    if (inFlightSignatureRef.current === workflowSignature && inFlightPromiseRef.current) {
      recordStudioRuntimeMetric("graphEstimate.inFlightHit");
      return inFlightPromiseRef.current;
    }
    const requestId = latestRequest.current + 1;
    latestRequest.current = requestId;
    inFlightSignatureRef.current = workflowSignature;
    recordStudioRuntimeMetric("graphEstimate.networkRequest");
    inFlightPromiseRef.current = jsonFetch<GraphEstimateResponse>("/api/control/media/graph/estimate", {
      method: "POST",
      body: JSON.stringify(pricingWorkflowPayload),
    })
      .then((estimate) => {
        if (latestRequest.current === requestId) {
          setGraphEstimate(estimate);
          lastResolvedSignatureRef.current = workflowSignature;
        }
        return estimate;
      })
      .finally(() => {
        if (inFlightSignatureRef.current === workflowSignature) {
          inFlightSignatureRef.current = null;
          inFlightPromiseRef.current = null;
        }
      });
    return inFlightPromiseRef.current;
  }, [graphEstimate, pricingWorkflowPayload, workflowSignature]);

  useEffect(() => {
    if (!workflowSignature) return;
    if (lastResolvedSignatureRef.current === workflowSignature) return;
    const timer = window.setTimeout(() => {
      refreshGraphEstimate().catch((error) => appendConsole(`Graph estimate failed: ${(error as Error).message}`));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [appendConsole, refreshGraphEstimate, workflowSignature]);

  const confirmPricingForRun = useCallback(async () => {
    const estimate = await refreshGraphEstimate();
    if (!graphPricingNeedsConfirmation(estimate, availableCredits)) return true;
    if (skipPricingConfirmation) return true;
    return new Promise<boolean>((resolve) => setPricingConfirmation({ estimate: estimate!, resolve }));
  }, [availableCredits, refreshGraphEstimate, skipPricingConfirmation]);

  const answerPricingConfirmation = useCallback((confirmed: boolean, rememberChoice = false) => {
    if (confirmed && rememberChoice) {
      writeSkipGraphPricingConfirmationPreference(true);
      setSkipPricingConfirmation(true);
    }
    setPricingConfirmation((current) => {
      current?.resolve(confirmed);
      return null;
    });
  }, []);

  const pricingByNode = useMemo(() => graphEstimate?.nodes ?? {}, [graphEstimate]);

  return { graphEstimate, pricingByNode, refreshGraphEstimate, confirmPricingForRun, pricingConfirmation, answerPricingConfirmation };
}

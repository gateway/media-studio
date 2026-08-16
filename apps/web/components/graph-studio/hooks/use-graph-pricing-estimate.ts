import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { recordStudioRuntimeMetric } from "@/lib/studio-runtime-metrics";
import type { GraphEstimateResponse, GraphWorkflowPayload, StudioEdge, StudioNode } from "../types";
import { jsonFetch } from "../utils/graph-api";
import { readSkipGraphPricingConfirmationPreference, writeSkipGraphPricingConfirmationPreference } from "../utils/graph-pricing-preferences";
import { graphPricingNeedsConfirmation } from "../utils/graph-pricing";

type PricingConfirmationState = { estimate: GraphEstimateResponse; resolve: (confirmed: boolean) => void };

const EMPTY_GRAPH_ESTIMATE: GraphEstimateResponse = {
  pricing_summary: {
    total: { estimated_credits: 0, estimated_cost_usd: 0 },
    per_output: { estimated_credits: 0, estimated_cost_usd: 0 },
    has_numeric_estimate: true,
    has_unknown_pricing: false,
    is_authoritative: true,
    is_stale: false,
    output_count: 0,
  },
  nodes: {},
  warnings: [],
};

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
      latestRequest.current += 1;
      setGraphEstimate(null);
      lastResolvedSignatureRef.current = null;
      inFlightSignatureRef.current = null;
      inFlightPromiseRef.current = null;
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
    const requestPromise = jsonFetch<GraphEstimateResponse>("/api/control/media/graph/estimate", {
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
        if (inFlightPromiseRef.current === requestPromise) {
          inFlightSignatureRef.current = null;
          inFlightPromiseRef.current = null;
        }
      });
    inFlightPromiseRef.current = requestPromise;
    return requestPromise;
  }, [graphEstimate, pricingWorkflowPayload, workflowSignature]);

  useEffect(() => {
    if (!workflowSignature) {
      void refreshGraphEstimate();
      return;
    }
    if (lastResolvedSignatureRef.current === workflowSignature) return;
    latestRequest.current += 1;
    inFlightSignatureRef.current = null;
    inFlightPromiseRef.current = null;
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

  const currentGraphEstimate = !workflowSignature
    ? EMPTY_GRAPH_ESTIMATE
    : lastResolvedSignatureRef.current === workflowSignature
      ? graphEstimate
      : null;
  const pricingByNode = useMemo(() => currentGraphEstimate?.nodes ?? {}, [currentGraphEstimate]);

  return {
    graphEstimate: currentGraphEstimate,
    pricingByNode,
    refreshGraphEstimate,
    confirmPricingForRun,
    pricingConfirmation,
    answerPricingConfirmation,
  };
}

"use client";

import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { flushSync } from "react-dom";
import type { GraphNodeDefinition, GraphGroup, GraphWorkflowPayload, StudioEdge, StudioNode } from "../types";
import type { GraphNodeHandlers } from "../utils/graph-serialization";
import type { GraphHistorySnapshot } from "../utils/graph-history";
import { graphWorkflowNeedsFreshDefinitions } from "../utils/graph-dynamic-definitions";
import { graphWorkflowSnapshotSignature } from "../utils/graph-tabs";
import { hydrateGraphWorkflowForCanvas } from "../utils/graph-workflow-hydration";
import type { useAssistantLayout } from "./use-assistant-layout";
import type { useGraphAssistantHistory } from "./use-graph-assistant-history";

export function useGraphAssistantApplication({
  applyAssistantWorkflow, reloadNodeDefinitions, appendConsole, beginAssistantLayout,
  nodeHandlers, setNodes, setEdges, setGroups, activeTabIdRef, workspaceRestoreVersionRef, currentHistorySnapshotRef,
}: {
  applyAssistantWorkflow: ReturnType<typeof useGraphAssistantHistory>["applyAssistantWorkflow"];
  reloadNodeDefinitions: (force?: boolean) => Promise<GraphNodeDefinition[]>;
  appendConsole: (message: string) => void;
  beginAssistantLayout: ReturnType<typeof useAssistantLayout>["beginAssistantLayout"];
  nodeHandlers: GraphNodeHandlers;
  setNodes: Dispatch<SetStateAction<StudioNode[]>>;
  setEdges: Dispatch<SetStateAction<StudioEdge[]>>;
  setGroups: Dispatch<SetStateAction<GraphGroup[]>>;
  activeTabIdRef: MutableRefObject<string | null>;
  workspaceRestoreVersionRef: MutableRefObject<number>;
  currentHistorySnapshotRef: MutableRefObject<GraphHistorySnapshot | null>;
}) {
  const applyAssistantWorkflowRef = useRef(applyAssistantWorkflow);
  useEffect(() => {
    applyAssistantWorkflowRef.current = applyAssistantWorkflow;
  }, [applyAssistantWorkflow]);
  const applyAssistantWorkflowWithFreshDefinitions = useCallback(
    async (
      workflow: GraphWorkflowPayload,
      options?: {
        highlightNodeIds?: string[];
        baseWorkflow?: GraphWorkflowPayload;
        layoutOnly?: boolean;
      },
    ) => {
      const sourceTabId = activeTabIdRef.current;
      const sourceVersion = workspaceRestoreVersionRef.current;
      const sourceSignature = graphWorkflowSnapshotSignature(currentHistorySnapshotRef.current?.workflow);
      const ownsSource = () => activeTabIdRef.current === sourceTabId &&
        workspaceRestoreVersionRef.current === sourceVersion &&
        graphWorkflowSnapshotSignature(currentHistorySnapshotRef.current?.workflow) === sourceSignature;
      const assertSourceIsCurrent = () => {
        if (!ownsSource()) throw new Error("The source workflow changed while preparing the graph. Return to it and review again.");
      };
      let refreshedDefinitionsByType:
        | Map<string, GraphNodeDefinition>
        | undefined;
      if (!options?.layoutOnly && graphWorkflowNeedsFreshDefinitions(workflow)) {
        try {
          const refreshedDefinitions = await reloadNodeDefinitions(true);
          refreshedDefinitionsByType = new Map(
            refreshedDefinitions.map((definition) => [
              definition.type,
              definition,
            ]),
          );
        } catch (error) {
          assertSourceIsCurrent();
          appendConsole(
            `Could not refresh graph node definitions before applying assistant plan: ${(error as Error).message}`,
          );
        }
      }
      assertSourceIsCurrent();
      beginAssistantLayout(workflow, options?.baseWorkflow, undefined, options?.layoutOnly);
      applyAssistantWorkflowRef.current(workflow, {
        ...options,
        definitionsByType: refreshedDefinitionsByType,
      });
      if (refreshedDefinitionsByType) {
        // Applying advances the existing workspace version; deferred restoration owns that new version.
        const appliedVersion = workspaceRestoreVersionRef.current;
        const applyRefreshedCanvas = () => {
          if (activeTabIdRef.current !== sourceTabId || workspaceRestoreVersionRef.current !== appliedVersion) return;
          beginAssistantLayout(workflow, options?.baseWorkflow);
          const restored = hydrateGraphWorkflowForCanvas({
            workflow,
            definitionsByType: refreshedDefinitionsByType,
            handlers: nodeHandlers,
          });
          const highlightedNodeIds = new Set(options?.highlightNodeIds ?? []);
          setNodes(
            highlightedNodeIds.size
              ? restored.nodes.map((node) =>
                  highlightedNodeIds.has(node.id)
                    ? {
                        ...node,
                        selected: true,
                        data: {
                          ...(node.data as StudioNode["data"]),
                          activityLabel: "added",
                          activityDetail: "Created by Media Assistant",
                          activityTone: "success",
                        },
                      }
                    : { ...node, selected: false },
                )
              : restored.nodes,
          );
          setEdges(restored.edges);
          setGroups(restored.groups);
        };
        flushSync(applyRefreshedCanvas);
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            applyRefreshedCanvas();
          });
        });
      }
    },
    [activeTabIdRef, appendConsole, beginAssistantLayout, currentHistorySnapshotRef, nodeHandlers, reloadNodeDefinitions, setEdges, setGroups, setNodes, workspaceRestoreVersionRef],
  );

  return applyAssistantWorkflowWithFreshDefinitions;
}

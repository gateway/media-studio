"use client";

import { useCallback, useRef, useState } from "react";

import { readGraphNodeDefinitionsRevision } from "@/lib/graph-node-definitions-sync";

import type { GraphNodeDefinition, StudioNode } from "../types";
import { jsonFetch } from "../utils/graph-api";
import { graphPreviewHeaderFieldIds, graphVisibleFieldMetrics } from "../utils/graph-node-fields";
import { computeGraphNodeLayout } from "../utils/graph-node-layout";
import { visibleGraphInputPorts, visibleGraphOutputPorts } from "../utils/graph-node-ports";
import { graphPromptRecipeSelectionSummary } from "../utils/graph-prompt-recipe";

type SetNodes = (updater: (current: StudioNode[]) => StudioNode[]) => void;

export function useGraphDefinitionHydration({ setNodes }: { setNodes: SetNodes }) {
  const [definitions, setDefinitions] = useState<GraphNodeDefinition[]>([]);
  const definitionsLoadStarted = useRef(false);
  const canvasHydrated = useRef(false);
  const latestDefinitionsRevision = useRef<string | null>(null);

  const applyDefinitionRefresh = useCallback(
    (items: GraphNodeDefinition[]) => {
      setDefinitions(items);
      const byType = new Map(items.map((definition) => [definition.type, definition]));
      setNodes((current) =>
        current.map((node) => {
          const nextDefinition = byType.get((node.data as StudioNode["data"]).definition.type);
          if (!nextDefinition) {
            return node;
          }
          const data = node.data as StudioNode["data"];
          const previewHeaderFieldIds = graphPreviewHeaderFieldIds(nextDefinition);
          const metrics = graphVisibleFieldMetrics(nextDefinition, data.fields, data.connectedInputPorts ?? [], {
            advancedExpanded: Boolean(data.advancedExpanded),
            previewHeaderFieldIds,
            extraLayoutRows: nextDefinition.type === "prompt.recipe" && graphPromptRecipeSelectionSummary(nextDefinition, data.fields) ? 2 : 0,
          });
          const visibleInputPorts = visibleGraphInputPorts(nextDefinition, data.fields).filter(
            (port) => !nextDefinition.fields.some((field) => (field.connectable || field.port_type) && field.id === port.id),
          );
          const visibleOutputPorts = visibleGraphOutputPorts(nextDefinition, data.fields);
          const nextLayout = computeGraphNodeLayout(nextDefinition, undefined, {
            visibleFieldCount: metrics.layoutFieldCount,
            visiblePortCount: visibleInputPorts.length + visibleOutputPorts.length,
            textareaCount: metrics.textareaCount,
          });
          const currentHeight =
            typeof node.height === "number" ? node.height : typeof node.style?.height === "number" ? node.style.height : nextLayout.minHeight;
          return {
            ...node,
            style: {
              ...node.style,
              minHeight: nextLayout.minHeight,
              height: Math.max(currentHeight, nextLayout.minHeight),
            },
            data: {
              ...data,
              definition: nextDefinition,
            },
          };
        }),
      );
    },
    [setNodes],
  );

  const reloadNodeDefinitions = useCallback(
    async (refresh = false) => {
      const payload = refresh
        ? await jsonFetch<{ items: GraphNodeDefinition[] }>("/api/control/media/graph/node-definitions/refresh", { method: "POST" })
        : await jsonFetch<{ items: GraphNodeDefinition[] }>("/api/control/media/graph/node-definitions");
      applyDefinitionRefresh(payload.items);
      latestDefinitionsRevision.current = readGraphNodeDefinitionsRevision()?.changedAt ?? latestDefinitionsRevision.current;
      return payload.items;
    },
    [applyDefinitionRefresh],
  );

  return {
    definitions,
    definitionsLoadStarted,
    canvasHydrated,
    latestDefinitionsRevision,
    reloadNodeDefinitions,
  };
}

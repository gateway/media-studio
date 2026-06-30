"use client";

import { useCallback, useRef, useState } from "react";

import { readGraphNodeDefinitionsRevision } from "@/lib/graph-node-definitions-sync";

import type { GraphNodeDefinition, StudioNode } from "../types";
import { resolveGraphNodeDefinition } from "../utils/graph-effective-node-definition";
import { jsonFetch } from "../utils/graph-api";
import { graphExtraLayoutRows, graphPreviewHeaderFieldIds, graphVisibleFieldMetrics } from "../utils/graph-node-fields";
import { computeGraphNodeLayout } from "../utils/graph-node-layout";
import { visibleGraphInputPorts, visibleGraphOutputPorts } from "../utils/graph-node-ports";

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
          const effectiveDefinition = resolveGraphNodeDefinition(nextDefinition, data.fields);
          const previewHeaderFieldIds = graphPreviewHeaderFieldIds(effectiveDefinition);
          const metrics = graphVisibleFieldMetrics(effectiveDefinition, data.fields, data.connectedInputPorts ?? [], {
            advancedExpanded: Boolean(data.advancedExpanded),
            previewHeaderFieldIds,
            extraLayoutRows: graphExtraLayoutRows(effectiveDefinition, data.fields),
          });
          const visibleInputPorts = visibleGraphInputPorts(effectiveDefinition, data.fields).filter(
            (port) => !effectiveDefinition.fields.some((field) => (field.connectable || field.port_type) && field.id === port.id),
          );
          const visibleOutputPorts = visibleGraphOutputPorts(effectiveDefinition, data.fields);
          const nextLayout = computeGraphNodeLayout(effectiveDefinition, undefined, {
            visibleFieldCount: metrics.layoutFieldCount,
            visiblePortCount: visibleInputPorts.length + visibleOutputPorts.length,
            textareaCount: metrics.textareaCount,
          });
          const currentHeight =
            typeof node.height === "number" ? node.height : typeof node.style?.height === "number" ? node.style.height : nextLayout.minHeight;
          const nextHeight = Math.min(Math.max(currentHeight, nextLayout.minHeight), nextLayout.maxHeight);
          return {
            ...node,
            style: {
              ...node.style,
              minHeight: nextLayout.minHeight,
              height: nextHeight,
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

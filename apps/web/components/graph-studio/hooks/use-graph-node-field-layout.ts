import { useCallback, useEffect } from "react";

import type { StudioNode } from "../types";
import { resolveGraphNodeDefinition } from "../utils/graph-effective-node-definition";
import {
  graphExtraLayoutRows,
  graphPreviewHeaderFieldIds,
  graphVisibleFieldMetrics,
} from "../utils/graph-node-fields";
import {
  GRAPH_NODE_AUTO_HEIGHT_HARD_MAX,
  computeGraphNodeLayout,
  graphNodeUsesContentAutoHeight,
  resolveGraphContentAutoHeight,
  resolveGraphNodeCollapseStyle,
} from "../utils/graph-node-layout";
import {
  visibleGraphInputPorts,
  visibleGraphOutputPorts,
} from "../utils/graph-node-ports";

type SetNodes = (updater: (current: StudioNode[]) => StudioNode[]) => void;

function measuredLayout(node: StudioNode, fields: Record<string, unknown>, advancedExpanded: boolean) {
  const data = node.data as StudioNode["data"];
  const effectiveDefinition = resolveGraphNodeDefinition(data.definition, fields);
  const previewHeaderFieldIds = graphPreviewHeaderFieldIds(effectiveDefinition);
  const metrics = graphVisibleFieldMetrics(
    effectiveDefinition,
    fields,
    data.connectedInputPorts ?? [],
    {
      advancedExpanded,
      previewHeaderFieldIds,
      extraLayoutRows: graphExtraLayoutRows(effectiveDefinition, fields),
    },
  );
  const fieldBackedPortIds = new Set(
    effectiveDefinition.fields
      .filter((field) => field.connectable || field.port_type)
      .map((field) => field.id),
  );
  const visibleInputPorts = visibleGraphInputPorts(effectiveDefinition, fields).filter(
    (port) => !fieldBackedPortIds.has(port.id),
  );
  const visibleOutputPorts = visibleGraphOutputPorts(effectiveDefinition, fields);
  return computeGraphNodeLayout(effectiveDefinition, undefined, {
    visibleFieldCount: metrics.layoutFieldCount,
    visiblePortCount: visibleInputPorts.length + visibleOutputPorts.length,
    textareaCount: metrics.textareaCount,
  });
}

function currentNodeHeight(node: StudioNode, fallback: number) {
  return typeof node.height === "number"
    ? node.height
    : typeof node.style?.height === "number"
      ? node.style.height
      : fallback;
}

function nodeWithFields(node: StudioNode, fields: Record<string, unknown>) {
  const data = node.data as StudioNode["data"];
  const nextLayout = measuredLayout(node, fields, Boolean(data.advancedExpanded));
  const nextHeight = Math.min(
    Math.max(currentNodeHeight(node, nextLayout.minHeight), nextLayout.minHeight),
    nextLayout.maxHeight,
  );
  const nextAutoSizedHeight = graphNodeUsesContentAutoHeight(data.definition)
    ? nextHeight
    : (data.autoSizedHeight ?? null);
  return {
    ...node,
    style: {
      ...node.style,
      height: nextHeight,
      minHeight: nextLayout.minHeight,
    },
    data: {
      ...data,
      fields,
      autoSizedHeight: nextAutoSizedHeight,
    },
  };
}

export function useGraphNodeFieldLayout({
  nodes,
  setNodes,
}: {
  nodes: StudioNode[];
  setNodes: SetNodes;
}) {
  useEffect(() => {
    setNodes((currentNodes) => {
      let changed = false;
      const nextNodes = currentNodes.map((node) => {
        const data = node.data as StudioNode["data"];
        if (!graphNodeUsesContentAutoHeight(data.definition)) return node;
        const currentHeight =
          typeof node.style?.height === "number"
            ? node.style.height
            : typeof node.height === "number"
              ? node.height
              : null;
        const currentMinHeight =
          typeof node.style?.minHeight === "number" ? node.style.minHeight : null;
        if (currentHeight == null && currentMinHeight == null) return node;
        const nextLayout = measuredLayout(
          node,
          data.fields,
          Boolean(data.advancedExpanded),
        );
        const nextHeight =
          currentHeight != null && currentHeight > nextLayout.maxHeight && currentHeight > GRAPH_NODE_AUTO_HEIGHT_HARD_MAX
            ? nextLayout.maxHeight
            : currentHeight;
        const currentAutoHeight =
          typeof data.autoSizedHeight === "number" && Number.isFinite(data.autoSizedHeight)
            ? data.autoSizedHeight
            : null;
        const currentMinHeightIsAutoLock =
          currentMinHeight != null &&
          currentAutoHeight != null &&
          currentMinHeight > nextLayout.minHeight + 2 &&
          Math.abs(currentMinHeight - currentAutoHeight) <= 2;
        const nextMinHeight =
          currentMinHeight != null && currentMinHeight > nextLayout.maxHeight && currentMinHeight > GRAPH_NODE_AUTO_HEIGHT_HARD_MAX
            ? nextLayout.minHeight
            : currentMinHeightIsAutoLock
              ? nextLayout.minHeight
            : currentMinHeight;
        if (nextHeight === currentHeight && nextMinHeight === currentMinHeight) return node;
        changed = true;
        return {
          ...node,
          style: {
            ...node.style,
            ...(nextHeight != null ? { height: nextHeight } : {}),
            ...(nextMinHeight != null ? { minHeight: nextMinHeight } : {}),
          },
          data: {
            ...data,
            autoSizedHeight: nextHeight ?? data.autoSizedHeight ?? null,
          },
        };
      });
      return changed ? nextNodes : currentNodes;
    });
  }, [nodes, setNodes]);

  const onFieldChange = useCallback(
    (nodeId: string, fieldId: string, value: unknown) => {
      setNodes((current) =>
        current.map((node) => {
          if (node.id !== nodeId) return node;
          const data = node.data as StudioNode["data"];
          return nodeWithFields(node, {
            ...data.fields,
            [fieldId]: value,
          });
        }),
      );
    },
    [setNodes],
  );

  const setNodeFields = useCallback(
    (nodeId: string, fields: Record<string, unknown>) => {
      setNodes((current) =>
        current.map((node) => {
          if (node.id !== nodeId) return node;
          const data = node.data as StudioNode["data"];
          return nodeWithFields(node, {
            ...data.fields,
            ...fields,
          });
        }),
      );
    },
    [setNodes],
  );

  const toggleNodeCollapsed = useCallback(
    (nodeId: string) => {
      setNodes((current) =>
        current.map((node) => {
          if (node.id !== nodeId) return node;
          const data = node.data as StudioNode["data"];
          const nextCollapsed = !data.collapsed;
          const nextLayout = measuredLayout(
            node,
            data.fields,
            Boolean(data.advancedExpanded),
          );
          const nextCollapseStyle = resolveGraphNodeCollapseStyle({
            collapsed: nextCollapsed,
            autoSizedHeight: data.autoSizedHeight,
            minHeight: nextLayout.minHeight,
            maxHeight: nextLayout.maxHeight,
          });
          return {
            ...node,
            style: {
              ...node.style,
              height: nextCollapseStyle.height,
              minHeight: nextCollapseStyle.minHeight,
            },
            data: {
              ...data,
              collapsed: nextCollapsed,
            },
          };
        }),
      );
    },
    [setNodes],
  );

  const toggleNodeAdvancedExpanded = useCallback(
    (nodeId: string) => {
      setNodes((current) =>
        current.map((node) => {
          if (node.id !== nodeId) return node;
          const data = node.data as StudioNode["data"];
          const nextExpanded = !data.advancedExpanded;
          const nextLayout = measuredLayout(node, data.fields, nextExpanded);
          const nextWidth =
            typeof node.width === "number"
              ? node.width
              : typeof node.style?.width === "number"
                ? node.style.width
                : undefined;
          const currentHeight = currentNodeHeight(node, nextLayout.minHeight);
          const previousAutoHeight =
            typeof data.autoSizedHeight === "number" && Number.isFinite(data.autoSizedHeight)
              ? data.autoSizedHeight
              : null;
          const nextHeight = nextExpanded
            ? Math.max(currentHeight, previousAutoHeight ?? 0, nextLayout.minHeight)
            : nextLayout.minHeight;
          return {
            ...node,
            style: {
              ...node.style,
              ...(typeof nextWidth === "number" ? { width: nextWidth } : {}),
              height: nextHeight,
              minHeight: nextLayout.minHeight,
            },
            data: {
              ...data,
              advancedExpanded: nextExpanded,
              autoSizedHeight: nextExpanded
                ? Math.max(previousAutoHeight ?? 0, nextLayout.minHeight)
                : previousAutoHeight ?? nextLayout.minHeight,
            },
          };
        }),
      );
    },
    [setNodes],
  );

  const ensureNodeHeight = useCallback(
    (nodeId: string, requiredHeight: number) => {
      setNodes((current) => {
        let changed = false;
        const nextNodes = current.map((node) => {
          if (node.id !== nodeId) return node;
          const data = node.data as StudioNode["data"];
          const effectiveDefinition = resolveGraphNodeDefinition(data.definition, data.fields);
          const nextLayout = computeGraphNodeLayout(effectiveDefinition);
          const styleHeight =
            typeof node.style?.height === "number"
              ? node.style.height
              : typeof node.height === "number"
                ? node.height
                : 0;
          const nextAutoHeight = resolveGraphContentAutoHeight({
            requiredHeight,
            minHeight: nextLayout.minHeight,
            maxHeight: nextLayout.maxHeight,
            currentHeight: styleHeight,
            previousAutoHeight:
              typeof data.autoSizedHeight === "number"
                ? data.autoSizedHeight
                : null,
          });
          if (!nextAutoHeight) return node;
          const currentMinHeight =
            typeof node.style?.minHeight === "number" ? node.style.minHeight : 0;
          const currentAutoHeight =
            typeof data.autoSizedHeight === "number" ? data.autoSizedHeight : 0;
          if (
            Math.abs(currentMinHeight - nextAutoHeight.minHeight) <= 2 &&
            Math.abs(styleHeight - nextAutoHeight.height) <= 2 &&
            Math.abs(currentAutoHeight - nextAutoHeight.autoSizedHeight) <= 2
          ) {
            return node;
          }
          changed = true;
          return {
            ...node,
            style: {
              ...node.style,
              height: nextAutoHeight.height,
              minHeight: nextAutoHeight.minHeight,
            },
            data: {
              ...data,
              autoSizedHeight: nextAutoHeight.autoSizedHeight,
            },
          };
        });
        return changed ? nextNodes : current;
      });
    },
    [setNodes],
  );

  return {
    ensureNodeHeight,
    onFieldChange,
    setNodeFields,
    toggleNodeAdvancedExpanded,
    toggleNodeCollapsed,
  };
}

import { useCallback, useEffect, useRef, type MutableRefObject } from "react";

import type { GraphNodeColorChoice } from "../graph-node-context-menu";
import type { GraphGroup, StudioNode } from "../types";
import {
  applyExecutionModeToNodes,
  computeGraphGroupBounds,
  graphGroupsForCanvas,
  GRAPH_GROUP_MOVE_EVENT,
  GRAPH_GROUP_RENAME_EVENT,
  GRAPH_GROUP_RESIZE_EVENT,
  moveGraphGroupBounds,
  moveGraphGroupNodes,
  pruneGraphGroupMembership,
  resizeGraphGroupBounds,
  selectedNodeIdsForGroup,
  type GraphGroupMoveDetail,
  type GraphGroupRenameDetail,
  type GraphGroupResizeDetail,
} from "../utils/graph-groups";
import type { GraphExecutionMode } from "../utils/graph-node-execution";

type SetGroups = (updater: GraphGroup[] | ((current: GraphGroup[]) => GraphGroup[])) => void;
type SetNodes = (updater: (current: StudioNode[]) => StudioNode[]) => void;

export function useGraphGroups({
  manualNodeMoveRef,
  groups,
  nodes,
  setGroups,
  setNodes,
  appendConsole,
}: {
  manualNodeMoveRef: MutableRefObject<boolean>;
  groups: GraphGroup[];
  nodes: StudioNode[];
  setGroups: SetGroups;
  setNodes: SetNodes;
  appendConsole: (line: string) => void;
}) {
  const groupsRef = useRef(groups);
  const nodesRef = useRef(nodes);
  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    const onGroupMove = (event: Event) => {
      const detail = (event as CustomEvent<GraphGroupMoveDetail>).detail;
      if (!detail?.groupId) return;
      const group = groupsRef.current.find((item) => item.id === detail.groupId);
      if (!group) return;
      setNodes((current) => moveGraphGroupNodes(current, group, detail.delta));
      setGroups((current) => moveGraphGroupBounds(current, detail.groupId, detail.delta));
    };
    const onGroupRename = (event: Event) => {
      const detail = (event as CustomEvent<GraphGroupRenameDetail>).detail;
      if (!detail?.groupId) return;
      setGroups((current) => current.map((group) => (group.id === detail.groupId ? { ...group, title: detail.title.trim() || "Group" } : group)));
    };
    const onGroupResize = (event: Event) => {
      const detail = (event as CustomEvent<GraphGroupResizeDetail>).detail;
      if (!detail?.groupId) return;
      setGroups((current) => pruneGraphGroupMembership(resizeGraphGroupBounds(current, detail.groupId, detail.delta), nodesRef.current));
    };
    window.addEventListener(GRAPH_GROUP_MOVE_EVENT, onGroupMove);
    window.addEventListener(GRAPH_GROUP_RENAME_EVENT, onGroupRename);
    window.addEventListener(GRAPH_GROUP_RESIZE_EVENT, onGroupResize);
    return () => {
      window.removeEventListener(GRAPH_GROUP_MOVE_EVENT, onGroupMove);
      window.removeEventListener(GRAPH_GROUP_RENAME_EVENT, onGroupRename);
      window.removeEventListener(GRAPH_GROUP_RESIZE_EVENT, onGroupResize);
    };
  }, [setGroups, setNodes]);

  useEffect(() => {
    if (manualNodeMoveRef.current) { manualNodeMoveRef.current = false; return; }
    // Content growth and Assistant reflow retain membership and enlarge bounds.
    // Manual node movement and group resizing explicitly reconcile membership.
    setGroups((current) => graphGroupsForCanvas(current, nodes));
  }, [manualNodeMoveRef, nodes, setGroups]);

  const createGroupFromSelection = useCallback(() => {
    const nodeIds = selectedNodeIdsForGroup(nodes);
    if (nodeIds.length < 2) {
      appendConsole("Select at least two nodes to create a group.");
      return;
    }
    const nextGroup: GraphGroup = {
      id: `graphgroup-${crypto.randomUUID().slice(0, 8)}`,
      title: `Group ${groups.length + 1}`,
      color: "default",
      node_ids: nodeIds,
      bounds: computeGraphGroupBounds(nodes, nodeIds),
      execution: { mode: "enabled" },
    };
    setGroups((current) => [...current, nextGroup]);
    appendConsole(`Created group with ${nodeIds.length} nodes.`);
  }, [appendConsole, groups.length, nodes, setGroups]);

  const renameGroup = useCallback(
    (groupId: string, title: string) => {
      const nextTitle = title.trim() || "Group";
      setGroups((current) => current.map((group) => (group.id === groupId ? { ...group, title: nextTitle } : group)));
    },
    [setGroups],
  );

  const setGroupColor = useCallback(
    (groupId: string, color: GraphNodeColorChoice) => {
      setGroups((current) => current.map((group) => (group.id === groupId ? { ...group, color: color.id } : group)));
    },
    [setGroups],
  );

  const deleteGroup = useCallback(
    (groupId: string) => {
      setGroups((current) => current.filter((group) => group.id !== groupId));
      appendConsole("Removed group frame.");
    },
    [appendConsole, setGroups],
  );

  const setGroupExecutionMode = useCallback(
    (groupId: string, mode: GraphExecutionMode) => {
      const group = groups.find((item) => item.id === groupId);
      if (!group) return;
      setGroups((current) => current.map((item) => (item.id === groupId ? { ...item, execution: { mode } } : item)));
      setNodes((current) => applyExecutionModeToNodes(current, group.node_ids, mode));
      appendConsole(`Set ${group.title} to ${mode === "frozen" ? "muted" : mode}.`);
    },
    [appendConsole, groups, setGroups, setNodes],
  );

  return {
    createGroupFromSelection,
    renameGroup,
    setGroupColor,
    deleteGroup,
    setGroupExecutionMode,
  };
}

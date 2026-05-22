"use client";

import { useEffect, useState } from "react";

import type { GraphGroup } from "../types";

export type GraphNodeContextMenuState = {
  nodeIds: string[];
  anchorNodeId: string;
  x: number;
  y: number;
};

export type GraphGroupContextMenuState = {
  groupId: string;
  x: number;
  y: number;
};

export function useGraphContextMenus({ groups }: { groups: GraphGroup[] }) {
  const [nodeContextMenu, setNodeContextMenu] = useState<GraphNodeContextMenuState | null>(null);
  const [groupContextMenu, setGroupContextMenu] = useState<GraphGroupContextMenuState | null>(null);
  const [groupTitleDraft, setGroupTitleDraft] = useState("");

  useEffect(() => {
    const group = groupContextMenu ? groups.find((item) => item.id === groupContextMenu.groupId) : null;
    setGroupTitleDraft(group?.title ?? "");
  }, [groupContextMenu?.groupId, groups]);

  return {
    nodeContextMenu,
    setNodeContextMenu,
    groupContextMenu,
    setGroupContextMenu,
    groupTitleDraft,
    setGroupTitleDraft,
    closeNodeContextMenu: () => setNodeContextMenu(null),
    closeGroupContextMenu: () => setGroupContextMenu(null),
    closeContextMenus: () => {
      setNodeContextMenu(null);
      setGroupContextMenu(null);
    },
  };
}

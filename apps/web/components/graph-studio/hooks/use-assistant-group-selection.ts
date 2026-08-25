"use client";

import { useEffect, useState } from "react";

import type { GraphGroup } from "../types";

export function useAssistantGroupSelection(activeTabId: string | null, groups: GraphGroup[]) {
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);

  useEffect(() => {
    setSelectedGroupIds([]);
  }, [activeTabId]);

  useEffect(() => {
    const availableGroupIds = new Set(groups.map((group) => group.id));
    setSelectedGroupIds((current) => {
      const filtered = current.filter((id) => availableGroupIds.has(id));
      return filtered.length === current.length ? current : filtered;
    });
  }, [groups]);

  return { selectedGroupIds, setSelectedGroupIds };
}

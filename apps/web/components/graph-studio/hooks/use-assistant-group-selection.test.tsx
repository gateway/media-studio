// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useAssistantGroupSelection } from "./use-assistant-group-selection";
import type { GraphGroup } from "../types";

const repeatedGroup = {
  id: "assistant-group-processing",
  title: "Processing",
  color: "default",
  node_ids: [],
  bounds: { x: 0, y: 0, width: 640, height: 420 },
  execution: { mode: "enabled" },
} as GraphGroup;

describe("useAssistantGroupSelection", () => {
  it("does not carry a selected group into another tab with the same group id", async () => {
    const { result, rerender } = renderHook(
      ({ activeTabId, groups }) => useAssistantGroupSelection(activeTabId, groups),
      {
        initialProps: {
          activeTabId: "tab-one",
          groups: [repeatedGroup],
        },
      },
    );

    act(() => result.current.setSelectedGroupIds([repeatedGroup.id]));
    expect(result.current.selectedGroupIds).toEqual([repeatedGroup.id]);

    rerender({ activeTabId: "tab-two", groups: [repeatedGroup] });

    await waitFor(() => expect(result.current.selectedGroupIds).toEqual([]));
  });
});

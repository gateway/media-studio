// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GraphWorkflowPayload } from "../types";
import { restoreGraphLayout } from "../utils/graph-layout-recovery";
import { useGraphLayoutRecovery } from "./use-graph-layout-recovery";

vi.mock("../utils/graph-layout-recovery", () => ({ restoreGraphLayout: vi.fn() }));
const workflow: GraphWorkflowPayload = { schema_version: 1, workflow_id: "saved", name: "Draft", nodes: [], edges: [] };

describe("layout recovery ownership", () => {
  it.each(["tab", "content", "run"])("refuses an async restore after the %s changes", async (change) => {
    let finish!: (text: string) => void;
    const file = { text: () => new Promise<string>((resolve) => { finish = resolve; }) } as File;
    vi.mocked(restoreGraphLayout).mockResolvedValue({ workflow, changed: true });
    const owner = { activeTabId: "one", workflow, runActive: false, onRestore: vi.fn(), onMessage: vi.fn() };
    const { result, rerender } = renderHook((props) => useGraphLayoutRecovery(props), { initialProps: owner });
    let pending!: Promise<void>;
    act(() => { pending = result.current.restoreFile(file); });
    rerender({ ...owner, ...(change === "tab" ? { activeTabId: "two" } : change === "content" ? { workflow: { ...workflow, name: "Edited" } } : { runActive: true }) });
    await act(async () => { finish("backup"); await pending; });
    expect(owner.onRestore).not.toHaveBeenCalled();
    if (change === "tab") expect(owner.onMessage).not.toHaveBeenCalled();
    else expect(owner.onMessage).toHaveBeenCalledWith(expect.stringContaining("Nothing was restored"));
  });

  it("does not read a backup during a run and reports malformed files", async () => {
    const file = { text: vi.fn().mockResolvedValue("bad") } as unknown as File;
    const owner = { activeTabId: "one", workflow, runActive: true, onRestore: vi.fn(), onMessage: vi.fn() };
    const { result, rerender } = renderHook((props) => useGraphLayoutRecovery(props), { initialProps: owner });
    await act(() => result.current.restoreFile(file));
    expect(file.text).not.toHaveBeenCalled();
    rerender({ ...owner, runActive: false });
    vi.mocked(restoreGraphLayout).mockRejectedValue(new Error("Invalid backup"));
    await act(() => result.current.restoreFile(file));
    expect(owner.onRestore).not.toHaveBeenCalled();
    expect(owner.onMessage).toHaveBeenLastCalledWith("Could not restore layout: Invalid backup");
  });
});

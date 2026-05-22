import { describe, expect, it } from "vitest";

import { graphNodeStatusForExecutionMode } from "@/components/graph-studio/utils/graph-node-status";

describe("graphNodeStatusForExecutionMode", () => {
  it("does not let stale skipped run state make an enabled node look disabled", () => {
    expect(graphNodeStatusForExecutionMode("skipped", "enabled")).toBe("idle");
  });

  it("keeps skipped visible for currently muted nodes", () => {
    expect(graphNodeStatusForExecutionMode("skipped", "frozen")).toBe("skipped");
    expect(graphNodeStatusForExecutionMode("skipped", "muted")).toBe("skipped");
    expect(graphNodeStatusForExecutionMode("bypassed", "bypassed")).toBe("bypassed");
  });
});

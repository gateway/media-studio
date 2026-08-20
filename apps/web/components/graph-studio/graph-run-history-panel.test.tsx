// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GraphRunHistoryPanel } from "./graph-run-history-panel";

afterEach(cleanup);

describe("GraphRunHistoryPanel", () => {
  it("shows provider-reported credits instead of a zero-dollar cost", () => {
    render(
      <GraphRunHistoryPanel
        workflowId="workflow-1"
        runs={[
          {
            run_id: "run-1",
            workflow_id: "workflow-1",
            status: "completed",
            metrics_json: { actual_cost_usd: 0, actual_credits: 6 },
          },
        ]}
        artifacts={[]}
        selectedRunId={null}
        onRefresh={vi.fn()}
        onInspectRun={vi.fn()}
        onRestoreRun={vi.fn()}
        onPinArtifact={vi.fn()}
      />,
    );

    expect(screen.getByText(/6 cr/)).toBeTruthy();
    expect(screen.queryByText(/\$0\.00/)).toBeNull();
  });
});

// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlanningRecoveryCard } from "./planning-recovery-card";

afterEach(cleanup);

describe("planning recovery", () => {
  it("retains progress and offers an explicit planning action", () => {
    const onContinue = vi.fn();
    render(<PlanningRecoveryCard value={{ id: "checkpoint", state: "offered", workflow_name: "Board", request: "Make a storyboard", completed: ["Inspected saved recipe"], errors: [{ message: "Resolve image input" }] }} busy={false} onContinue={onContinue} />);
    expect(screen.getByText("Inspected saved recipe")).toBeTruthy();
    expect(screen.getByText("Resolve image input")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review and run" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue planning" }));
    expect(onContinue).toHaveBeenCalledWith("checkpoint");
  });
  it("does not offer stale or completed checkpoints", () => {
    const { rerender } = render(<PlanningRecoveryCard value={{ id: "checkpoint", state: "stale" }} busy={false} onContinue={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Continue planning" })).toBeNull();
    rerender(<PlanningRecoveryCard value={{ id: "checkpoint", state: "completed" }} busy={false} onContinue={vi.fn()} />);
    expect(screen.queryByRole("region", { name: "Planning recovery" })).toBeNull();
  });
});

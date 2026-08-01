// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { ProductionPlanChecklist } from "./production-plan-checklist";
import type { AssistantProductionPlan } from "./types";

afterEach(cleanup);

const plan: AssistantProductionPlan = {
  version: 1,
  goal: "Produce a 45-second derelict-ship sequence.",
  constraints: [
    { name: "target_duration_seconds", value: 45, source: "user_request" },
    { name: "clip_max_seconds", value: 15, source: "model_catalog", model_key: "seedance-2.0" },
    { name: "minimum_clip_count", value: 3, source: "derived" },
  ],
  steps: [
    { id: "characters", kind: "character_sheet", title: "Lock the crew", status: "done", depends_on: [], notes: "" },
    { id: "environment", kind: "environment_sheet", title: "Lock the ship", status: "ready", depends_on: [], notes: "" },
    { id: "storyboard", kind: "storyboard", title: "Plan the story beats", status: "proposed", depends_on: ["characters", "environment"], notes: "" },
  ],
};

it("shows grounded constraints, ordered steps, and the active step", () => {
  render(<ProductionPlanChecklist plan={plan} />);

  expect(screen.getByRole("region", { name: "Production plan" })).toBeTruthy();
  expect(screen.getByText("45")).toBeTruthy();
  expect(screen.getByText("seedance-2.0")).toBeTruthy();
  expect(screen.getByRole("list", { name: "Production steps" }).children).toHaveLength(3);
  expect(screen.getByText("Lock the ship").closest("li")?.getAttribute("aria-current")).toBe("step");
});

it("uses an in-progress step instead of the first ready step", () => {
  render(
    <ProductionPlanChecklist
      plan={{
        ...plan,
        steps: plan.steps.map((step) => (
          step.id === "storyboard" ? { ...step, status: "in_progress" } : step
        )),
      }}
    />,
  );

  expect(screen.getByText("Plan the story beats").closest("li")?.getAttribute("data-active")).toBe("true");
  expect(screen.getByText("Lock the ship").closest("li")?.getAttribute("data-active")).toBe("false");
});

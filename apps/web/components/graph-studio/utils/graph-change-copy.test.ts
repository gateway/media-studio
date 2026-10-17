import { describe, expect, it } from "vitest";

import type { AssistantPlanResponse } from "../types";
import { graphChangeCopy } from "./graph-change-copy";

type Operations = AssistantPlanResponse["graph_plan"]["operations"];
type Copy = ReturnType<typeof graphChangeCopy>;

function plan(operations: Operations, metadata?: Record<string, unknown>, status = "validated", valid = true) {
  // Only the pure copy function's input fields are needed; no app/runtime fixture.
  return {
    graph_plan: { operations, metadata }, workflow: { name: "Saved name" },
    plan: { status }, validation: { valid },
  } as AssistantPlanResponse;
}

const emptyCopy = "No canvas changes are prepared. Review any questions or requirements below.";
const failedCopy = "These changes were not completed. Ask for a fresh review before trying again.";
const stageCopy = "The new workflow is open in its own tab with this conversation. Applying it did not start a run.";

const cases: Array<{
  name: string; operations: Operations; effects: string; action: string;
  titles: [string, string]; renameOnly?: boolean;
}> = [
  { name: "rename", operations: [{ op: "rename_workflow", title: "Proposed" }], effects: "", action: "Rename workflow", titles: ["Workflow rename prepared", "Workflow renamed"], renameOnly: true },
  { name: "layout", operations: [{ op: "arrange_workflow" }], effects: "Arrange the workflow", action: "Tidy workflow", titles: ["Workflow layout ready", "Workflow layout updated"] },
  { name: "edits", operations: ["set_node_field", "set_node_title", "set_execution_mode", "replace_model"].map(op => ({ op })), effects: "Update node settings or titles", action: "Apply node changes", titles: ["Node changes prepared", "Node updated"] },
  { name: "additions", operations: [{ op: "add_node", title: " First " }, { op: "connect_nodes" }, { op: "add_note", title: "Second" }, { op: "group_nodes" }], effects: "Add nodes: First, Second; Update connections; Update node groups", action: "Add to canvas", titles: ["Graph additions prepared", "Graph added"] },
  { name: "untitled additions", operations: [{ op: "add_node" }, { op: "add_note", title: " " }], effects: "Add nodes", action: "Add to canvas", titles: ["Graph additions prepared", "Graph added"] },
  { name: "connections", operations: ["connect_nodes", "update_edge", "remove_edge"].map(op => ({ op })), effects: "Update connections", action: "Apply changes", titles: ["Workflow changes prepared", "Workflow changes applied"] },
  { name: "groups", operations: ["group_nodes", "remove_nodes_from_group"].map(op => ({ op })), effects: "Update node groups", action: "Apply changes", titles: ["Workflow changes prepared", "Workflow changes applied"] },
  { name: "unknown operation", operations: [{ op: "future_operation" }, {}], effects: "Update the workflow", action: "Apply changes", titles: ["Workflow changes prepared", "Workflow changes applied"] },
  { name: "mixed order and repeated categories", operations: [{ op: "arrange_workflow" }, { op: "rename_workflow", title: "Earlier" }, { op: "set_node_title" }, { op: "rename_workflow", title: "Later" }, { op: "arrange_workflow" }], effects: "Arrange the workflow; Rename the workflow to ‘Later’; Update node settings or titles", action: "Apply changes", titles: ["Workflow changes prepared", "Workflow changes applied"] },
];

describe("graph change copy characterization", () => {
  for (const row of cases) {
    for (const applied of [false, true]) {
      it(`${row.name}, applied=${applied}`, () => {
        const name = applied ? "Saved name" : "Proposed";
        let copy = `Prepared for review: ${row.effects}. These changes have not been applied.`;
        if (applied) {
          const intro = row.name === "edits" ? "The requested node changes are updated on the canvas." : "The confirmed graph changes are on the canvas.";
          const effects = row.effects.replace("‘Later’", "‘Saved name’");
          copy = `${intro} Applying them did not start a run. Changes: ${effects}.`;
        }
        if (row.renameOnly) {
          copy = applied ? `Workflow renamed to ‘${name}’. Applying this change did not start a run.`
            : `Ready to rename this workflow to ‘${name}’. The name has not changed yet. Your images, nodes and connections will stay the same.`;
        }
        expect(graphChangeCopy(plan(row.operations), applied)).toEqual({
          renameOnly: row.renameOnly ?? false, title: row.titles[Number(applied)], action: row.action, copy,
        });
      });
    }
  }

  it.each(["update_edge", "remove_edge", "remove_nodes_from_group", "arrange_workflow", "set_node_field", "rename_workflow", "unknown"])("%s prevents the additions action", op => {
    expect(graphChangeCopy(plan([{ op: "add_node" }, { op }])).action).toBe("Apply changes");
  });

  it.each([
    [{}, "Add to canvas"],
    [{ template_refinement: true }, "Apply refinement"],
    [{ replace_existing_test_lane: true }, "Replace test lane"],
    [{ replace_existing_test_lane: true, template_refinement: true }, "Replace test lane"],
    [{ independent_stage: true, replace_existing_test_lane: true, template_refinement: true }, "Open new workflow"],
    [{ independent_stage: "yes" }, "Open new workflow"],
  ] as const)("chooses the additions action for %j", (metadata, action) => {
    for (const applied of [false, true]) {
      expect(graphChangeCopy(plan([{ op: "add_node" }], metadata), applied).action).toBe(action);
    }
  });

  it("keeps additions metadata subordinate to the operation category", () => {
    expect(graphChangeCopy(plan([{ op: "arrange_workflow" }], { replace_existing_test_lane: true, template_refinement: true })).action).toBe("Tidy workflow");
  });

  it("uses the final rename's title verbatim, and the saved name after applying", () => {
    const response = plan([{ op: "rename_workflow", title: "Earlier" }, { op: "rename_workflow", title: " Later " }]);
    expect(graphChangeCopy(response).copy).toContain("‘ Later ’");
    expect(graphChangeCopy(response, true).copy).toContain("‘Saved name’");
    expect(graphChangeCopy(plan([{ op: "rename_workflow" }])).copy).toContain("‘’");
  });

  it("normalizes addition titles without dropping duplicates or numeric titles", () => {
    expect(graphChangeCopy(plan([{ op: "add_node", title: " A " }, { op: "add_note", title: "A" }, { op: "add_note", title: 0 }])).copy)
      .toBe("Prepared for review: Add nodes: A, A, 0. These changes have not been applied.");
  });

  for (const operations of [[], [{ op: "rename_workflow", title: "Proposed" }], [{ op: "add_node" }]]) {
    for (const independent of [false, true]) {
      for (const applied of [false, true]) {
        it(`overrides: operations=${operations.length}:${operations[0]?.op}, independent=${independent}, applied=${applied}`, () => {
          const metadata = { independent_stage: independent };
          const response = plan(operations, metadata);
          const ordinary = graphChangeCopy(plan(operations), applied);
          let expected: Copy = { ...ordinary };
          if (independent) {
            expected = { ...expected, action: "Open new workflow", title: applied ? "New workflow opened" : "New workflow prepared", copy: applied ? stageCopy : `Prepared a separate workflow ‘Saved name’. ${ordinary.copy}` };
          }
          if (!operations.length) expected = { ...expected, title: "No canvas changes", copy: emptyCopy };
          expect(graphChangeCopy(response, applied)).toEqual(expected);
          for (const status of ["draft", "validated", "applied", "failed", "rejected"]) {
            for (const valid of [false, true]) {
              let result = { ...expected };
              if (!applied && (status === "failed" || status === "rejected")) {
                result = { ...result, title: status === "failed" ? "Changes could not be applied" : "Changes rejected", copy: failedCopy };
              } else if (!applied && !valid) result.title = "Workflow changes need review";
              expect(graphChangeCopy(plan(operations, metadata, status, valid), applied)).toEqual(result);
            }
          }
        });
      }
    }
  }
});

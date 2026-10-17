import type { AssistantPlanResponse } from "../types";

type Effect = "rename" | "add" | "edit" | "layout" | "connections" | "groups" | "other";
type ChangeKind = "rename" | "layout" | "edit" | "add" | "other";

const operationEffects = new Map<unknown, Effect>([
  ["rename_workflow", "rename"],
  ["add_node", "add"], ["add_note", "add"],
  ["set_node_field", "edit"], ["set_node_title", "edit"], ["set_execution_mode", "edit"], ["replace_model", "edit"],
  ["arrange_workflow", "layout"],
  ["connect_nodes", "connections"], ["update_edge", "connections"], ["remove_edge", "connections"],
  ["group_nodes", "groups"], ["remove_nodes_from_group", "groups"],
]);
const effectLabels: Record<Exclude<Effect, "rename">, string> = {
  add: "Add nodes", edit: "Update node settings or titles", layout: "Arrange the workflow",
  connections: "Update connections", groups: "Update node groups", other: "Update the workflow",
};
const presentation: Record<ChangeKind, { titles: [string, string]; action: string }> = {
  rename: { titles: ["Workflow rename prepared", "Workflow renamed"], action: "Rename workflow" },
  layout: { titles: ["Workflow layout ready", "Workflow layout updated"], action: "Tidy workflow" },
  edit: { titles: ["Node changes prepared", "Node updated"], action: "Apply node changes" },
  add: { titles: ["Graph additions prepared", "Graph added"], action: "Add to canvas" },
  other: { titles: ["Workflow changes prepared", "Workflow changes applied"], action: "Apply changes" },
};

function summarizeOperations(plan: AssistantPlanResponse, applied: boolean) {
  const operations = plan.graph_plan.operations;
  const effects = new Map<Effect, string>();
  for (const item of operations) {
    const effect = operationEffects.get(item.op) ?? "other";
    const label = effect === "rename"
      ? `Rename the workflow to ‘${applied ? plan.workflow.name : String(item.title ?? "")}’`
      : effectLabels[effect];
    effects.set(effect, label);
  }
  const addedTitles = operations.filter(item => ["add_node", "add_note"].includes(String(item.op))).map(item => String(item.title ?? "").trim()).filter(Boolean);
  if (addedTitles.length) effects.set("add", `Add nodes: ${addedTitles.join(", ")}`);

  let kind: ChangeKind = "other";
  if (effects.size === 1 && effects.has("rename")) kind = "rename";
  else if (effects.size === 1 && effects.has("layout")) kind = "layout";
  else if (effects.size === 1 && effects.has("edit")) kind = "edit";
  else if (effects.has("add") && operations.every(item => ["add_node", "add_note", "connect_nodes", "group_nodes"].includes(String(item.op)))) kind = "add";
  return { effects, kind };
}

function describeOperations(plan: AssistantPlanResponse, applied: boolean, kind: ChangeKind, effects: Map<Effect, string>) {
  const metadata = plan.graph_plan.metadata ?? {};
  let action = presentation[kind].action;
  if (kind === "add") {
    if (metadata.replace_existing_test_lane) action = "Replace test lane";
    else if (metadata.template_refinement) action = "Apply refinement";
  }
  const title = presentation[kind].titles[Number(applied)];
  let copy: string;
  if (kind === "rename") {
    const name = applied ? plan.workflow.name : String(plan.graph_plan.operations.at(-1)?.title ?? "");
    copy = applied ? `Workflow renamed to ‘${name}’. Applying this change did not start a run.`
      : `Ready to rename this workflow to ‘${name}’. The name has not changed yet. Your images, nodes and connections will stay the same.`;
  } else if (applied) {
    const intro = kind === "edit" ? "The requested node changes are updated on the canvas." : "The confirmed graph changes are on the canvas.";
    copy = `${intro} Applying them did not start a run. Changes: ${[...effects.values()].join("; ")}.`;
  } else {
    copy = `Prepared for review: ${[...effects.values()].join("; ")}. These changes have not been applied.`;
  }
  return { renameOnly: kind === "rename", title, action, copy };
}

// Authored prose is supporting context. Recorded operations own the outcome and action.
export function graphChangeCopy(plan: AssistantPlanResponse, applied = false) {
  const { effects, kind } = summarizeOperations(plan, applied);
  const result = describeOperations(plan, applied, kind, effects);

  // Overrides are ordered: independent stage, empty canvas, then unapplied status/validation.
  // Copy/title overrides preserve the operation action, except for an independent stage.
  if (plan.graph_plan.metadata?.independent_stage) {
    result.action = "Open new workflow";
    result.title = applied ? "New workflow opened" : "New workflow prepared";
    result.copy = applied ? "The new workflow is open in its own tab with this conversation. Applying it did not start a run."
      : `Prepared a separate workflow ‘${plan.workflow.name}’. ${result.copy}`;
  }
  if (!effects.size) {
    result.title = "No canvas changes";
    result.copy = "No canvas changes are prepared. Review any questions or requirements below.";
  }
  if (!applied && ["failed", "rejected"].includes(plan.plan.status)) {
    result.title = plan.plan.status === "failed" ? "Changes could not be applied" : "Changes rejected";
    result.copy = "These changes were not completed. Ask for a fresh review before trying again.";
  } else if (!applied && !plan.validation.valid) {
    result.title = "Workflow changes need review";
  }
  return result;
}

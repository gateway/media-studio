import type { GraphNodeDefinition, GraphNodeField, GraphNodePort } from "../types";
import { graphPromptRecipeSelectionSummary } from "./graph-prompt-recipe";

export type GraphNodeHelpContent = {
  summary: string;
  lines: string[];
};

function titleCase(value: unknown) {
  return String(value ?? "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function compactOptions(field: GraphNodeField) {
  const options = (field.options ?? []).map((item) => String(item));
  if (!options.length) return null;
  if (field.id === "duration") return `${field.label} ${options.map((item) => `${item}s`).join(" or ")}`;
  if (options.length <= 6) return `${field.label} ${options.join(", ")}`;
  const important = options.filter((item) => ["1:1", "9:16", "16:9", "auto"].includes(item.toLowerCase()));
  const shown = Array.from(new Set([...options.slice(0, 3), ...important])).slice(0, 6);
  return `${field.label} ${options.length} options incl. ${shown.join(", ")}`;
}

function fieldSettingLine(fields: GraphNodeField[]) {
  const supported = fields
    .filter((field) => !field.hidden && !field.advanced && field.id !== "prompt")
    .map((field) => {
      if (field.options?.length) return compactOptions(field);
      if (field.type === "boolean") return `${field.label} on/off`;
      if ((field.type === "integer" || field.type === "number") && (field.min != null || field.max != null)) return `${field.label} ${field.min ?? "min"}-${field.max ?? "max"}`;
      return field.help_text ? `${field.label}: ${field.help_text}` : null;
    })
    .filter(Boolean)
    .slice(0, 5);
  return supported.length ? `Settings: ${supported.join(". ")}.` : null;
}

function pluralMedia(type: string, count: number) {
  if (type === "audio") return count === 1 ? "audio file" : "audio files";
  return count === 1 ? type : `${type}s`;
}

function mediaInputText(port: GraphNodePort) {
  const max = typeof port.max === "number" ? port.max : null;
  const min = typeof port.min === "number" ? port.min : port.required ? 1 : 0;
  if (min === 1 && max === 1) return `exactly 1 ${port.type}`;
  if (min === 0 && max) return `up to ${max} reference ${pluralMedia(port.type, max)}`;
  if (min > 0 && max && min !== max) return `${min}-${max} ${pluralMedia(port.type, max)}`;
  if (min > 0) return `${min}+ ${pluralMedia(port.type, min)}`;
  return port.label.toLowerCase();
}

function inputLine(definition: GraphNodeDefinition) {
  const parts: string[] = [];
  if (definition.ports.inputs.some((port) => port.type === "text" && port.id === "prompt")) parts.push("prompt");
  const mediaPorts = definition.ports.inputs.filter((port) => !port.advanced && ["image", "video", "audio"].includes(port.type));
  mediaPorts.forEach((port) => parts.push(mediaInputText(port)));
  return parts.length ? `Inputs: ${parts.join(", ")}.` : null;
}

function outputLine(definition: GraphNodeDefinition) {
  const outputs = definition.ports.outputs.filter((port) => !port.advanced);
  const count = asRecord(definition.limits?.output_count).max ?? asRecord(definition.limits?.output_count).default ?? 1;
  if (outputs.length === 1) return `Outputs: ${count} ${outputs[0].type}.`;
  if (outputs.length) return `Outputs: ${outputs.map((port) => port.label).join(", ")}.`;
  return null;
}

function taskModeText(definition: GraphNodeDefinition) {
  const source = asRecord(definition.source);
  const outputType = titleCase(source.output_media_type ?? definition.ports.outputs.find((port) => !port.advanced)?.type ?? "media");
  const modes = Array.isArray(source.task_modes) ? source.task_modes.map(titleCase).filter(Boolean) : [];
  if (!modes.length) return `${outputType} model using Media Studio validation, pricing, submit, and polling.`;
  return `${outputType} model for ${modes.join(" or ").toLowerCase()}.`;
}

export function buildGraphNodeHelpContent(definition: GraphNodeDefinition, fields?: Record<string, unknown>): GraphNodeHelpContent {
  if (definition.type === "prompt.recipe") {
    const summary = graphPromptRecipeSelectionSummary(definition, fields ?? {});
    if (summary) {
      return {
        summary: summary.description,
        lines: [summary.subtitle, ...summary.details],
      };
    }
    return {
      summary: definition.help_text || definition.description || "Prompt Recipe node.",
      lines: [
        "Pick a recipe category, then choose a saved Prompt Recipe.",
        "Only the fields used by that recipe will appear.",
        "Open Prompt Recipes to inspect the full system prompt.",
      ],
    };
  }
  const isKieModel = definition.source?.kind === "kie_model";
  if (!isKieModel) {
    const inputs = definition.ports.inputs.filter((port) => !port.advanced).slice(0, 4);
    const outputs = definition.ports.outputs.filter((port) => !port.advanced).slice(0, 4);
    const fields = definition.fields.filter((field) => !field.hidden && field.help_text).slice(0, 3);
    return {
      summary: definition.help_text || definition.description || "Graph node.",
      lines: [
        inputs.length ? `Inputs: ${inputs.map((port) => `${port.label}${port.required ? "*" : ""}`).join(", ")}.` : null,
        outputs.length ? `Outputs: ${outputs.map((port) => port.label).join(", ")}.` : null,
        fields.length ? `Fields: ${fields.map((field) => `${field.label}: ${field.help_text}`).join(" ")}` : null,
      ].filter(Boolean) as string[],
    };
  }

  return {
    summary: taskModeText(definition),
    lines: [
      inputLine(definition),
      outputLine(definition),
      fieldSettingLine(definition.fields),
      "Cost: estimated before Run from current settings.",
    ].filter(Boolean) as string[],
  };
}

import type { GraphNodeDefinition, GraphNodePort } from "../types";
import { evaluateGraphVisibleCondition } from "./graph-node-fields";

export const IMAGE_SPLIT_MAX_OUTPUTS = 25;
export const VIDEO_COMBINE_MAX_INPUTS = 12;

function integerField(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function imageSplitOutputCount(definition: GraphNodeDefinition, fields: Record<string, unknown>) {
  if (definition.type !== "image.split") return null;
  const defaultCount = integerField(definition.fields.find((field) => field.id === "outputs")?.default, 4);
  return Math.min(IMAGE_SPLIT_MAX_OUTPUTS, Math.max(1, integerField(fields.outputs, defaultCount)));
}

export function videoCombineInputCount(definition: GraphNodeDefinition, fields: Record<string, unknown>) {
  if (definition.type !== "video.combine") return null;
  const defaultCount = integerField(definition.fields.find((field) => field.id === "clip_count")?.default, 4);
  return Math.min(VIDEO_COMBINE_MAX_INPUTS, Math.max(2, integerField(fields.clip_count, defaultCount)));
}

export function visibleGraphInputPorts(definition: GraphNodeDefinition, fields: Record<string, unknown>): GraphNodePort[] {
  const count = videoCombineInputCount(definition, fields);
  if (count !== null) {
    return definition.ports.inputs.filter((port) => {
      const match = /^video_(\d+)$/.exec(port.id);
      if (!evaluateGraphVisibleCondition(port.visible_if, fields, definition)) return false;
      return match ? Number(match[1]) <= count : !port.advanced;
    });
  }
  return definition.ports.inputs.filter((port) => !port.advanced && evaluateGraphVisibleCondition(port.visible_if, fields, definition));
}

export function visibleGraphOutputPorts(definition: GraphNodeDefinition, fields: Record<string, unknown>): GraphNodePort[] {
  const count = imageSplitOutputCount(definition, fields);
  if (count !== null) {
    return definition.ports.outputs.filter((port) => {
      const match = /^image_(\d+)$/.exec(port.id);
      if (!evaluateGraphVisibleCondition(port.visible_if, fields, definition)) return false;
      return match ? Number(match[1]) <= count : !port.advanced;
    });
  }
  if (definition.type === "image.transform") {
    const operation = String(fields.operation || definition.fields.find((field) => field.id === "operation")?.default || "resize");
    return definition.ports.outputs.filter((port) => {
      if (!evaluateGraphVisibleCondition(port.visible_if, fields, definition)) return false;
      if (operation === "extract_metadata") return port.id === "metadata";
      return port.id === "image";
    });
  }
  if (definition.type === "video.transform") {
    return definition.ports.outputs.filter((port) => port.id === "video" && evaluateGraphVisibleCondition(port.visible_if, fields, definition));
  }
  if (definition.type === "video.extract") {
    const operation = String(fields.operation || definition.fields.find((field) => field.id === "operation")?.default || "poster_frame");
    const outputByOperation: Record<string, string> = {
      extract_audio: "audio",
      extract_frames: "images",
      extract_metadata: "metadata",
      poster_frame: "image",
    };
    const outputId = outputByOperation[operation] ?? "image";
    return definition.ports.outputs.filter((port) => port.id === outputId && evaluateGraphVisibleCondition(port.visible_if, fields, definition));
  }
  if (definition.type === "audio.transform") {
    const operation = String(fields.operation || definition.fields.find((field) => field.id === "operation")?.default || "extract_metadata");
    return definition.ports.outputs.filter(
      (port) => (operation === "extract_metadata" ? port.id === "metadata" : port.id === "audio") && evaluateGraphVisibleCondition(port.visible_if, fields, definition),
    );
  }
  return definition.ports.outputs.filter((port) => !port.advanced && evaluateGraphVisibleCondition(port.visible_if, fields, definition));
}

"use client";

import { Braces, Cpu, FileText, Image, Music, Package, Video } from "lucide-react";

import type { GraphNodeDefinition } from "../types";

function primaryGraphNodeType(definition: GraphNodeDefinition) {
  const portTypes = [...definition.ports.inputs, ...definition.ports.outputs].map((port) => port.type.replace(/\[\]$/, ""));
  const category = definition.category.toLowerCase();
  if (portTypes.includes("video") || category.includes("video")) return "Video";
  if (portTypes.includes("audio") || category.includes("audio")) return "Audio";
  if (portTypes.includes("image") || category.includes("image")) return "Image";
  if (portTypes.includes("text") || category.includes("prompt")) return "Text";
  if (portTypes.includes("json") || category.includes("debug")) return "JSON";
  if (portTypes.includes("asset") || category.includes("media")) return "Asset";
  if (category.includes("model")) return "Model";
  return definition.category.split("/").pop() || "Node";
}

export function GraphNodeTypeBadge({ definition }: { definition: GraphNodeDefinition }) {
  const type = primaryGraphNodeType(definition);
  const Icon = type === "Video" ? Video : type === "Audio" ? Music : type === "Image" ? Image : type === "Text" ? FileText : type === "JSON" ? Braces : type === "Model" ? Cpu : Package;
  return (
    <span className={`graph-node-type-badge graph-node-type-badge-${type.toLowerCase()}`}>
      <Icon size={13} />
      {type}
    </span>
  );
}

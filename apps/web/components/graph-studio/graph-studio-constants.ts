import type { GraphNodeColorChoice } from "./graph-node-context-menu";

export const WORKSPACE_STORAGE_KEY = "media-studio:graph-studio:last-workspace";

export const NODE_COLOR_CHOICES: GraphNodeColorChoice[] = [
  { id: "default", label: "Default", accent: "#d1ff47", surface: "#171b1a", header: "#202524" },
  { id: "green", label: "Green", accent: "#31d158", surface: "#17231d", header: "#203327" },
  { id: "blue", label: "Blue", accent: "#73a7ff", surface: "#151d2b", header: "#1d2a3c" },
  { id: "purple", label: "Purple", accent: "#b28cff", surface: "#21182d", header: "#2b203a" },
  { id: "gold", label: "Gold", accent: "#f0c15a", surface: "#241f14", header: "#332a18" },
  { id: "rose", label: "Rose", accent: "#ff6b8a", surface: "#29181f", header: "#3a2029" },
];

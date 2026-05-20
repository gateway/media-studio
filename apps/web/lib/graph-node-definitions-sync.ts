"use client";

export const GRAPH_NODE_DEFINITIONS_STORAGE_KEY = "media-studio:graph-node-definitions:revision";
export const GRAPH_NODE_DEFINITIONS_EVENT = "media-studio:graph-node-definitions:changed";

export type GraphNodeDefinitionsRevision = {
  changedAt: string;
  reason: string;
};

function createRevision(reason: string): GraphNodeDefinitionsRevision {
  return {
    changedAt: new Date().toISOString(),
    reason,
  };
}

export function readGraphNodeDefinitionsRevision(): GraphNodeDefinitionsRevision | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(GRAPH_NODE_DEFINITIONS_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<GraphNodeDefinitionsRevision>;
    if (!parsed.changedAt || !parsed.reason) {
      return null;
    }
    return {
      changedAt: String(parsed.changedAt),
      reason: String(parsed.reason),
    };
  } catch {
    return null;
  }
}

export async function refreshGraphNodeDefinitionsOnServer() {
  const response = await fetch("/api/control/media/graph/node-definitions/refresh", {
    method: "POST",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Unable to refresh graph node definitions.");
  }
  return response.json();
}

export async function invalidateGraphNodeDefinitions(reason: string) {
  if (typeof window === "undefined") {
    return createRevision(reason);
  }
  const revision = createRevision(reason);
  const serialized = JSON.stringify(revision);
  window.localStorage.setItem(GRAPH_NODE_DEFINITIONS_STORAGE_KEY, serialized);
  window.dispatchEvent(new CustomEvent(GRAPH_NODE_DEFINITIONS_EVENT, { detail: revision }));
  return revision;
}

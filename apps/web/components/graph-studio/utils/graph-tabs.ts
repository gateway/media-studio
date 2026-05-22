import type { GraphWorkspaceTab, GraphWorkflowPayload } from "../types";
import { WORKSPACE_STORAGE_KEY } from "../graph-studio-constants";
import { normalizeGraphWorkflowPayload } from "./graph-workflow-normalization";

export const GRAPH_TABS_STORAGE_KEY = "media-studio:graph-studio:tabs";
export const GRAPH_TABS_SCHEMA_VERSION = 4;
export const GRAPH_TABS_SUPPORTED_SCHEMA_VERSIONS = new Set([2, 3, GRAPH_TABS_SCHEMA_VERSION]);
export const GRAPH_TABS_MAX_RESTORABLE_TABS = 8;
export const GRAPH_TABS_MAX_CONSOLE_LINES = 120;
export const GRAPH_TABS_MAX_CONSOLE_LINE_CHARS = 240;

export type GraphTabSnapshot = {
  workflowId: string | null;
  workflowName: string;
  workflow: GraphWorkflowPayload;
  savedWorkflowSignature?: string | null;
  workflowUpdatedAt?: string | null;
  runId?: string | null;
  runStatus?: string | null;
  consoleLines?: string[];
  dirty?: boolean;
};

export type GraphTabSessionState = {
  active_tab_id: string;
  tabs: GraphWorkspaceTab[];
  restored: boolean;
};

type GraphTabWriteVariant = {
  maxTabs: number;
  keepConsoleLines: boolean;
  keepInactiveConsoleLines: boolean;
};

export function blankGraphWorkflowPayload(name = "New workflow"): GraphWorkflowPayload {
  return {
    schema_version: 1,
    workflow_id: null,
    name,
    nodes: [],
    edges: [],
    metadata: {},
  };
}

export function applyGraphTabSnapshot(tab: GraphWorkspaceTab, snapshot: GraphTabSnapshot): GraphWorkspaceTab {
  return {
    ...tab,
    workflow_id: snapshot.workflowId,
    workflow_name: snapshot.workflowName,
    workflow_json: snapshot.workflow,
    saved_workflow_signature: snapshot.savedWorkflowSignature ?? tab.saved_workflow_signature ?? null,
    workflow_updated_at: snapshot.workflowUpdatedAt ?? tab.workflow_updated_at ?? null,
    run_id: snapshot.runId ?? null,
    run_status: snapshot.runStatus ?? (snapshot.runId ? tab.run_status ?? null : null),
    console_lines: snapshot.consoleLines ?? tab.console_lines ?? [],
    dirty: snapshot.dirty ?? tab.dirty ?? false,
    updated_at: new Date().toISOString(),
  };
}

function normalizeConsoleLines(lines: unknown, keepLines = true): string[] {
  if (!keepLines || !Array.isArray(lines)) return [];
  return lines
    .map((line) => String(line))
    .slice(-GRAPH_TABS_MAX_CONSOLE_LINES)
    .map((line) =>
      line.length > GRAPH_TABS_MAX_CONSOLE_LINE_CHARS
        ? `${line.slice(0, GRAPH_TABS_MAX_CONSOLE_LINE_CHARS - 1)}…`
        : line,
    );
}

function graphTabTimestamp(tab: Pick<GraphWorkspaceTab, "updated_at">): number {
  const parsed = Date.parse(tab.updated_at ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeWorkflowPayload(value: unknown): GraphWorkflowPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const workflow = value as GraphWorkflowPayload;
  if (!Array.isArray(workflow.nodes) || !Array.isArray(workflow.edges)) return null;
  return normalizeGraphWorkflowPayload(workflow);
}

function hasLegacyPromptRecipeTypes(workflow: GraphWorkflowPayload | null): boolean {
  return Boolean(
    workflow?.nodes?.some(
      (node) =>
        typeof node?.type === "string" &&
        node.type.startsWith("prompt.recipe.") &&
        node.type !== "prompt.recipe",
    ),
  );
}

function normalizeTab(value: unknown, schemaVersion = GRAPH_TABS_SCHEMA_VERSION): GraphWorkspaceTab | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as GraphWorkspaceTab;
  const workflow = normalizeWorkflowPayload(candidate.workflow_json ?? null);
  if (workflow === null && candidate.workflow_json) return null;
  if (!candidate.tab_id || !candidate.workflow_name) return null;
  if (!candidate.workflow_id && hasLegacyPromptRecipeTypes(workflow)) return null;
  const savedWorkflowSignature =
    typeof candidate.saved_workflow_signature === "string"
      ? candidate.saved_workflow_signature
      : candidate.saved_workflow_signature === null
        ? null
        : schemaVersion < GRAPH_TABS_SCHEMA_VERSION && candidate.workflow_id && workflow && !candidate.dirty
          ? graphWorkflowSnapshotSignature(workflow)
          : null;
  return {
    tab_id: String(candidate.tab_id),
    workflow_id: candidate.workflow_id ?? null,
    workflow_name: String(candidate.workflow_name),
    workflow_json: workflow,
    saved_workflow_signature: savedWorkflowSignature,
    workflow_updated_at: candidate.workflow_updated_at ?? null,
    run_id: candidate.run_id ?? null,
    run_status: candidate.run_status ?? null,
    console_lines: normalizeConsoleLines(candidate.console_lines),
    dirty: Boolean(candidate.dirty),
    updated_at: candidate.updated_at ?? null,
  };
}

function legacyWorkspaceToSession(value: unknown): GraphTabSessionState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as {
    workflowId?: string | null;
    workflowName?: string;
    workflow?: GraphWorkflowPayload;
    runId?: string | null;
    updatedAt?: string | null;
  };
  const workflow = normalizeWorkflowPayload(candidate.workflow ?? null);
  if (!workflow) return null;
  if (!candidate.workflowId && hasLegacyPromptRecipeTypes(workflow)) return null;
  const tab = applyGraphTabSnapshot(
    {
      tab_id: `tab-${crypto.randomUUID().slice(0, 8)}`,
      workflow_id: null,
      workflow_name: String(candidate.workflowName || workflow.name || "Recovered workflow"),
      workflow_json: null,
      workflow_updated_at: null,
      run_id: null,
      console_lines: [],
      dirty: false,
      updated_at: candidate.updatedAt ?? new Date().toISOString(),
    },
    {
      workflowId: candidate.workflowId ?? workflow.workflow_id ?? null,
      workflowName: String(candidate.workflowName || workflow.name || "Recovered workflow"),
      workflow,
      runId: candidate.runId ?? null,
      runStatus: null,
      dirty: false,
    },
  );
  return { active_tab_id: tab.tab_id, tabs: [tab], restored: true };
}

export function readGraphTabSession(): GraphTabSessionState | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(GRAPH_TABS_STORAGE_KEY) || "null") as {
      schema_version?: number;
      active_tab_id?: string;
      tabs?: unknown[];
    } | null;
    if (
      parsed?.schema_version &&
      GRAPH_TABS_SUPPORTED_SCHEMA_VERSIONS.has(parsed.schema_version) &&
      parsed.active_tab_id &&
      Array.isArray(parsed.tabs)
    ) {
      const tabs = parsed.tabs
        .map((tab) => normalizeTab(tab, parsed.schema_version))
        .filter((tab): tab is GraphWorkspaceTab => Boolean(tab));
      if (tabs.length) {
        const active = tabs.find((tab) => tab.tab_id === parsed.active_tab_id) ?? tabs[0];
        return { active_tab_id: active.tab_id, tabs, restored: true };
      }
    }
  } catch {
    // fall through to legacy state
  }
  try {
    return legacyWorkspaceToSession(JSON.parse(window.localStorage.getItem(WORKSPACE_STORAGE_KEY) || "null"));
  } catch {
    return null;
  }
}

export function shouldReloadSavedWorkflowRecordOnRestore(tab: GraphWorkspaceTab | null | undefined): boolean {
  if (!tab?.workflow_id) return false;
  const workflow = normalizeWorkflowPayload(tab.workflow_json ?? null);
  if (!workflow) return true;
  if (!Array.isArray(workflow.nodes) || workflow.nodes.length === 0) return true;
  return !tab.dirty;
}

export function graphWorkflowDirtyState({
  workflowId,
  workflowName,
  workflow,
  savedWorkflowSignature,
  dirtyFallback = false,
}: {
  workflowId: string | null | undefined;
  workflowName: string;
  workflow: GraphWorkflowPayload | null | undefined;
  savedWorkflowSignature?: string | null;
  dirtyFallback?: boolean;
}): boolean {
  const currentSignature = graphWorkflowSnapshotSignature(workflow);
  if (!currentSignature) return Boolean(workflowId || dirtyFallback);
  if (workflowId) {
    if (savedWorkflowSignature) {
      return currentSignature !== savedWorkflowSignature;
    }
    return Boolean(dirtyFallback);
  }
  const blankSignature = graphWorkflowSnapshotSignature(blankGraphWorkflowPayload(workflowName || "New workflow"));
  return currentSignature !== blankSignature;
}

function stableWorkflowValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableWorkflowValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableWorkflowValue(child)]),
  );
}

export function graphWorkflowSnapshotSignature(workflow: GraphWorkflowPayload | null | undefined): string | null {
  const normalized = normalizeWorkflowPayload(workflow ?? null);
  if (!normalized) return null;
  return JSON.stringify(stableWorkflowValue(normalized));
}

export function graphWorkflowSnapshotsMatch(
  left: GraphWorkflowPayload | null | undefined,
  right: GraphWorkflowPayload | null | undefined,
): boolean {
  const leftSignature = graphWorkflowSnapshotSignature(left);
  const rightSignature = graphWorkflowSnapshotSignature(right);
  return leftSignature !== null && leftSignature === rightSignature;
}

function compactTabsForWrite(
  activeTabId: string,
  tabs: GraphWorkspaceTab[],
  variant: GraphTabWriteVariant,
): GraphWorkspaceTab[] {
  const activeTab = tabs.find((tab) => tab.tab_id === activeTabId) ?? tabs[0] ?? null;
  const remaining = tabs
    .filter((tab) => tab.tab_id !== activeTab?.tab_id)
    .sort((left, right) => graphTabTimestamp(right) - graphTabTimestamp(left))
    .slice(0, Math.max(0, variant.maxTabs - (activeTab ? 1 : 0)));
  const selected = activeTab ? [activeTab, ...remaining] : remaining;
  return selected.map((tab) => ({
    ...tab,
    console_lines: normalizeConsoleLines(
      tab.console_lines,
      tab.tab_id === activeTabId ? variant.keepConsoleLines : variant.keepInactiveConsoleLines,
    ),
  }));
}

function graphTabSessionPayload(
  activeTabId: string,
  tabs: GraphWorkspaceTab[],
  variant: GraphTabWriteVariant,
) {
  const compactedTabs = compactTabsForWrite(activeTabId, tabs, variant);
  const active = compactedTabs.find((tab) => tab.tab_id === activeTabId) ?? compactedTabs[0];
  return {
    schema_version: GRAPH_TABS_SCHEMA_VERSION,
    active_tab_id: active?.tab_id ?? activeTabId,
    tabs: compactedTabs,
  };
}

export function writeGraphTabSession(activeTabId: string, tabs: GraphWorkspaceTab[]): void {
  if (typeof window === "undefined") return;
  const variants: GraphTabWriteVariant[] = [
    { maxTabs: GRAPH_TABS_MAX_RESTORABLE_TABS, keepConsoleLines: true, keepInactiveConsoleLines: true },
    { maxTabs: 6, keepConsoleLines: true, keepInactiveConsoleLines: false },
    { maxTabs: 4, keepConsoleLines: false, keepInactiveConsoleLines: false },
  ];
  for (const variant of variants) {
    try {
      window.localStorage.setItem(
        GRAPH_TABS_STORAGE_KEY,
        JSON.stringify(graphTabSessionPayload(activeTabId, tabs, variant)),
      );
      return;
    } catch {
      // fall through to smaller persistence variants
    }
  }
  window.localStorage.removeItem(GRAPH_TABS_STORAGE_KEY);
}

export function clearLegacyWorkspaceSnapshot(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
}

export function graphTabCloseTarget(tabs: GraphWorkspaceTab[], activeTabId: string, tabId: string): GraphWorkspaceTab | null {
  const closingIndex = tabs.findIndex((tab) => tab.tab_id === tabId);
  if (closingIndex === -1 || tabId !== activeTabId) {
    return tabs.find((tab) => tab.tab_id === activeTabId) ?? tabs[0] ?? null;
  }
  return tabs[closingIndex - 1] ?? tabs[closingIndex + 1] ?? null;
}

export function graphTabOpenWorkflowTarget(
  tabs: GraphWorkspaceTab[],
  activeTabId: string,
  targetTab: GraphWorkspaceTab,
  activeSnapshot?: GraphTabSnapshot,
): { tabs: GraphWorkspaceTab[]; activeTabId: string } {
  const tabsWithActiveSnapshot = activeSnapshot
    ? tabs.map((tab) => (tab.tab_id === activeTabId ? applyGraphTabSnapshot(tab, activeSnapshot) : tab))
    : tabs;
  const existing = targetTab.workflow_id
    ? tabsWithActiveSnapshot.find((tab) => tab.workflow_id === targetTab.workflow_id)
    : null;
  if (existing) {
    return {
      tabs: tabsWithActiveSnapshot.map((tab) => (tab.tab_id === existing.tab_id ? targetTab : tab)),
      activeTabId: existing.tab_id,
    };
  }
  return { tabs: [...tabsWithActiveSnapshot, targetTab], activeTabId: targetTab.tab_id };
}

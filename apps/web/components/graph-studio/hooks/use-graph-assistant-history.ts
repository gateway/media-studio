"use client";

import { useCallback, useRef, useState, type MutableRefObject } from "react";

import type { GraphHistorySnapshot } from "../utils/graph-history";
import { blankGraphWorkflowPayload } from "../utils/graph-tabs";
import type { GraphNodeDefinition, GraphWorkspaceTab, GraphWorkflowPayload, StudioEdge, StudioNode } from "../types";

type HydrateWorkflowPayload = (
  workflow: GraphWorkflowPayload,
  options?: {
    workflowId?: string | null;
    workflowName?: string;
    workflowUpdatedAt?: string | null;
    run?: null;
    highlightNodeIds?: string[];
    assistantGenerated?: boolean;
    definitionsByType?: Map<string, GraphNodeDefinition>;
  },
) => void;

type CommitSnapshot = (
  snapshot: GraphHistorySnapshot | null,
  options?: { baseSnapshot?: GraphHistorySnapshot | null; tabId?: string | null },
) => void;

type UpdateTab = (
  tabId: string | null,
  snapshot: {
    workflowId: string | null;
    workflowName: string;
    workflow: GraphWorkflowPayload;
    savedWorkflowSignature: string | null;
    workflowUpdatedAt: string | null;
    runId: string | null;
    runStatus: string | null;
    consoleLines: string[];
    dirty: boolean;
  },
) => void;

export function useGraphAssistantHistory({
  activeTab,
  activeTabId,
  consoleLines,
  currentHistorySnapshot,
  currentWorkflowPayload,
  currentHistorySnapshotRef,
  nodesRef,
  edgesRef,
  workflowId,
  workflowName,
  workflowUpdatedAt,
  applyUndoHistorySnapshot,
  commitSnapshot,
  hydrateWorkflowPayload,
  markWorkspaceChanged,
  redo,
  undo,
  updateTab,
}: {
  activeTab: GraphWorkspaceTab | null;
  activeTabId: string | null;
  consoleLines: string[];
  currentHistorySnapshot: GraphHistorySnapshot | null;
  currentWorkflowPayload: GraphWorkflowPayload;
  currentHistorySnapshotRef: MutableRefObject<GraphHistorySnapshot | null>;
  nodesRef: MutableRefObject<StudioNode[]>;
  edgesRef: MutableRefObject<StudioEdge[]>;
  workflowId: string | null;
  workflowName: string;
  workflowUpdatedAt: string | null;
  applyUndoHistorySnapshot: (snapshot: GraphHistorySnapshot) => void;
  commitSnapshot: CommitSnapshot;
  hydrateWorkflowPayload: HydrateWorkflowPayload;
  markWorkspaceChanged: () => void;
  redo: () => boolean;
  undo: () => boolean;
  updateTab: UpdateTab;
}) {
  const activeTabRef = useRef<GraphWorkspaceTab | null>(activeTab);
  const activeTabIdRef = useRef<string | null>(activeTabId);
  const workflowIdRef = useRef<string | null>(workflowId);
  const workflowNameRef = useRef(workflowName);
  const workflowUpdatedAtRef = useRef<string | null>(workflowUpdatedAt ?? null);
  const assistantBaseSnapshotRef = useRef<GraphHistorySnapshot | null>(null);
  const assistantAppliedSnapshotRef = useRef<GraphHistorySnapshot | null>(null);
  const assistantRedoSnapshotRef = useRef<GraphHistorySnapshot | null>(null);
  const [assistantUndoSnapshot, setAssistantUndoSnapshot] = useState<{
    applied: GraphHistorySnapshot | null;
    base: GraphHistorySnapshot;
    tabId: string | null;
  } | null>(null);
  const [assistantRedoSnapshot, setAssistantRedoSnapshotState] = useState<GraphHistorySnapshot | null>(null);
  activeTabRef.current = activeTab;
  activeTabIdRef.current = activeTabId;
  workflowIdRef.current = workflowId;
  workflowNameRef.current = workflowName;
  workflowUpdatedAtRef.current = workflowUpdatedAt ?? null;
  const setAssistantRedoSnapshot = useCallback((snapshot: GraphHistorySnapshot | null) => {
    assistantRedoSnapshotRef.current = snapshot;
    setAssistantRedoSnapshotState(snapshot);
  }, []);

  const undoGraphChange = useCallback(() => {
    markWorkspaceChanged();
    const currentSnapshot = currentHistorySnapshotRef.current ?? {
      workflowId: workflowIdRef.current,
      workflowName: workflowNameRef.current,
      workflowUpdatedAt: workflowUpdatedAtRef.current,
      workflow: currentWorkflowPayload,
    };
    const latestActiveTabId = activeTabIdRef.current;
    const assistantUndoRecord = assistantUndoSnapshot?.tabId === latestActiveTabId ? assistantUndoSnapshot : null;
    const assistantBaseSnapshot = assistantUndoRecord?.base ?? assistantBaseSnapshotRef.current;
    const assistantAppliedSnapshot = assistantUndoRecord?.applied ?? assistantAppliedSnapshotRef.current ?? currentSnapshot;
    if (assistantBaseSnapshot) {
      applyUndoHistorySnapshot(assistantBaseSnapshot);
      assistantBaseSnapshotRef.current = null;
      assistantAppliedSnapshotRef.current = null;
      setAssistantUndoSnapshot(null);
      setAssistantRedoSnapshot(assistantAppliedSnapshot);
      return true;
    }
    const generatedOnBlankTab = nodesRef.current.some(
      (node) => (node.data as StudioNode["data"] | undefined)?.activityDetail === "Created by Media Assistant",
    );
    if (generatedOnBlankTab && currentSnapshot) {
      const blankWorkflow = blankGraphWorkflowPayload("New workflow");
      applyUndoHistorySnapshot({
        workflowId: null,
        workflowName: blankWorkflow.name,
        workflowUpdatedAt: null,
        workflow: blankWorkflow,
      });
      assistantBaseSnapshotRef.current = null;
      assistantAppliedSnapshotRef.current = null;
      setAssistantUndoSnapshot(null);
      setAssistantRedoSnapshot(currentSnapshot);
      return true;
    }
    setAssistantUndoSnapshot(null);
    setAssistantRedoSnapshot(null);
    const undone = undo();
    if (undone && currentSnapshot) setAssistantRedoSnapshot(currentSnapshot);
    return undone;
  }, [
    activeTabId,
    applyUndoHistorySnapshot,
    assistantUndoSnapshot,
    currentHistorySnapshotRef,
    currentWorkflowPayload,
    markWorkspaceChanged,
    nodesRef,
    setAssistantRedoSnapshot,
    undo,
  ]);

  const redoGraphChange = useCallback(() => {
    markWorkspaceChanged();
    const redoSnapshot = assistantRedoSnapshot ?? assistantRedoSnapshotRef.current;
    if (redoSnapshot) {
      const baseSnapshot = currentHistorySnapshotRef.current;
      const latestActiveTabId = activeTabIdRef.current;
      assistantBaseSnapshotRef.current = baseSnapshot;
      assistantAppliedSnapshotRef.current = redoSnapshot;
      if (baseSnapshot) setAssistantUndoSnapshot({ applied: redoSnapshot, base: baseSnapshot, tabId: latestActiveTabId });
      setAssistantRedoSnapshot(null);
      commitSnapshot(redoSnapshot, { baseSnapshot, tabId: latestActiveTabId });
      hydrateWorkflowPayload(redoSnapshot.workflow, {
        workflowId: redoSnapshot.workflowId,
        workflowName: redoSnapshot.workflowName,
        workflowUpdatedAt: redoSnapshot.workflowUpdatedAt ?? null,
      });
      return true;
    }
    return redo();
  }, [assistantRedoSnapshot, commitSnapshot, currentHistorySnapshotRef, hydrateWorkflowPayload, markWorkspaceChanged, redo, setAssistantRedoSnapshot]);

  const applyAssistantWorkflow = useCallback(
    (workflow: GraphWorkflowPayload, options?: { highlightNodeIds?: string[]; baseWorkflow?: GraphWorkflowPayload; definitionsByType?: Map<string, GraphNodeDefinition> }) => {
      markWorkspaceChanged();
      const fallbackSnapshot = currentHistorySnapshotRef.current ?? currentHistorySnapshot;
      const latestActiveTab = activeTabRef.current;
      const latestActiveTabId = activeTabIdRef.current;
      const latestWorkflowId = workflowIdRef.current;
      const latestWorkflowName = workflowNameRef.current;
      const latestWorkflowUpdatedAt = workflowUpdatedAtRef.current;
      const activeTabWorkflow = latestActiveTab?.workflow_json ?? null;
      const explicitBaseWorkflow = options?.baseWorkflow ?? null;
      const canvasIsBlank = !nodesRef.current.length && !edgesRef.current.length;
      const activeTabIsBlank = Boolean(!latestActiveTab?.workflow_id && activeTabWorkflow && !activeTabWorkflow.nodes.length);
      const explicitBaseIsBlank = Boolean(explicitBaseWorkflow && !explicitBaseWorkflow.workflow_id && !explicitBaseWorkflow.nodes.length);
      const blankBaseWorkflow = blankGraphWorkflowPayload(latestActiveTab?.workflow_name || latestWorkflowName || "New workflow");
      const baseWorkflow =
        explicitBaseWorkflow ??
        (canvasIsBlank || activeTabIsBlank
          ? blankBaseWorkflow
          : fallbackSnapshot?.workflow ?? activeTabWorkflow ?? currentWorkflowPayload ?? blankBaseWorkflow);
      const baseWorkflowIsBlank = explicitBaseIsBlank || canvasIsBlank || activeTabIsBlank || !baseWorkflow.nodes.length;
      const baseSnapshot: GraphHistorySnapshot = {
        workflowId: baseWorkflowIsBlank ? null : fallbackSnapshot?.workflowId ?? latestActiveTab?.workflow_id ?? latestWorkflowId,
        workflowName: baseWorkflowIsBlank ? baseWorkflow.name || "New workflow" : fallbackSnapshot?.workflowName ?? latestActiveTab?.workflow_name ?? latestWorkflowName,
        workflowUpdatedAt: baseWorkflowIsBlank ? null : fallbackSnapshot?.workflowUpdatedAt ?? latestActiveTab?.workflow_updated_at ?? latestWorkflowUpdatedAt ?? null,
        workflow: baseWorkflowIsBlank ? { ...baseWorkflow, workflow_id: null, name: baseWorkflow.name || "New workflow" } : baseWorkflow,
      };
      const nextWorkflowId = baseWorkflowIsBlank ? null : workflow.workflow_id ?? baseSnapshot.workflowId ?? latestWorkflowId;
      const nextWorkflowName = workflow.name || baseSnapshot.workflowName || latestWorkflowName;
      const nextWorkflow = baseWorkflowIsBlank ? { ...workflow, workflow_id: null, name: nextWorkflowName } : workflow;
      const appliedSnapshot: GraphHistorySnapshot = {
        workflowId: nextWorkflowId,
        workflowName: nextWorkflowName,
        workflowUpdatedAt: baseSnapshot.workflowUpdatedAt ?? latestWorkflowUpdatedAt ?? null,
        workflow: nextWorkflow,
      };
      commitSnapshot(appliedSnapshot, { baseSnapshot, tabId: latestActiveTabId });
      assistantBaseSnapshotRef.current = baseSnapshot;
      assistantAppliedSnapshotRef.current = appliedSnapshot;
      setAssistantUndoSnapshot({ applied: appliedSnapshot, base: baseSnapshot, tabId: latestActiveTabId });
      setAssistantRedoSnapshot(null);
      updateTab(latestActiveTabId, {
        workflowId: nextWorkflowId,
        workflowName: nextWorkflowName,
        workflow: nextWorkflow,
        savedWorkflowSignature: null,
        workflowUpdatedAt: baseSnapshot.workflowUpdatedAt ?? latestWorkflowUpdatedAt ?? null,
        runId: null,
        runStatus: null,
        consoleLines,
        dirty: true,
      });
      hydrateWorkflowPayload(nextWorkflow, {
        workflowId: nextWorkflowId,
        workflowName: nextWorkflowName,
        highlightNodeIds: options?.highlightNodeIds,
        assistantGenerated: baseWorkflowIsBlank,
        definitionsByType: options?.definitionsByType,
      });
    },
    [
      commitSnapshot,
      consoleLines,
      currentHistorySnapshot,
      currentHistorySnapshotRef,
      currentWorkflowPayload,
      edgesRef,
      hydrateWorkflowPayload,
      markWorkspaceChanged,
      nodesRef,
      setAssistantRedoSnapshot,
      updateTab,
    ],
  );

  return {
    assistantRedoAvailable: Boolean(assistantRedoSnapshot ?? assistantRedoSnapshotRef.current),
    assistantUndoAvailable: Boolean(
      (assistantUndoSnapshot && assistantUndoSnapshot.tabId === activeTabId) || assistantBaseSnapshotRef.current,
    ),
    applyAssistantWorkflow,
    redoGraphChange,
    undoGraphChange,
  };
}

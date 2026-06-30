// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GraphLibraryDialog } from "@/components/graph-studio/graph-library-dialogs";
import type { GraphNodeDefinition } from "@/components/graph-studio/types";

function makeDefinition(overrides: Partial<GraphNodeDefinition> = {}): GraphNodeDefinition {
  return {
    type: "prompt.recipe",
    title: "Prompt Recipe",
    description: "Run a saved prompt recipe.",
    category: "Prompt",
    ports: { inputs: [], outputs: [] },
    fields: [],
    ...overrides,
  };
}

function renderLibraryDialog(
  overrides: Partial<Parameters<typeof GraphLibraryDialog>[0]> = {},
) {
  const props: Parameters<typeof GraphLibraryDialog>[0] = {
    sidebarDialog: "nodes",
    definitions: [],
    definitionsByCategory: {},
    workflows: [],
    templates: [],
    references: [],
    assets: [],
    workflowId: null,
    runHistory: [],
    selectedHistoryRunId: null,
    selectedRunArtifacts: [],
    onClose: vi.fn(),
    onLoadStarterTemplate: vi.fn(),
    onLoadWorkflow: vi.fn(),
    onInstantiateTemplate: vi.fn(),
    onDeleteWorkflow: vi.fn(),
    onDeleteTemplate: vi.fn(),
    onImportWorkflow: vi.fn(),
    onAddDefinitionNode: vi.fn(),
    onRefreshRunHistory: vi.fn(),
    onInspectRun: vi.fn(),
    onRestoreRun: vi.fn(),
    onPinArtifact: vi.fn(),
    ...overrides,
  };

  return { ...render(<GraphLibraryDialog {...props} />), props };
}

describe("GraphLibraryDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("hides hidden internal definitions from the default node library", () => {
    const visibleDefinition = makeDefinition();
    const hiddenDefinition = makeDefinition({
      type: "internal.hidden_debug",
      title: "Internal Hidden Debug",
      source: {
        kind: "system",
        hidden_in_search: true,
      },
    });

    renderLibraryDialog({
      sidebarDialog: "nodes",
      definitions: [visibleDefinition, hiddenDefinition],
      definitionsByCategory: {
        Prompt: [visibleDefinition, hiddenDefinition],
      },
    });

    expect(screen.getByRole("button", { name: /prompt recipe/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /internal hidden debug/i })).toBeNull();
  });
});

// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GraphNodeDisplayAny } from "@/components/graph-studio/graph-node-display-any";
import type { GraphNodeData } from "@/components/graph-studio/types";

function makeDisplayNodeData(overrides: Partial<GraphNodeData> = {}): GraphNodeData {
  return {
    definition: {
      type: "display.any",
      title: "Display Any",
      category: "Debug",
      ports: { inputs: [], outputs: [] },
      fields: [],
    },
    fields: {},
    outputSnapshot: {
      value: [{ value: "Seedance output text" }],
    },
    onFieldChange: vi.fn(),
    ...overrides,
  };
}

describe("GraphNodeDisplayAny", () => {
  it("marks text output as nodrag/nopan and stops pointer bubbling so text can be selected", () => {
    const parentPointerDown = vi.fn();
    const parentMouseDown = vi.fn();

    render(
      <div onPointerDown={parentPointerDown} onMouseDown={parentMouseDown}>
        <GraphNodeDisplayAny data={makeDisplayNodeData()} />
      </div>,
    );

    const output = screen.getByText("Seedance output text");
    expect(output.tagName).toBe("PRE");
    expect(output.className).toContain("nodrag");
    expect(output.className).toContain("nopan");

    fireEvent.pointerDown(output);
    fireEvent.mouseDown(output);

    expect(parentPointerDown).not.toHaveBeenCalled();
    expect(parentMouseDown).not.toHaveBeenCalled();
  });

  it("copies the rendered output text with the copy action", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText,
      },
    });

    const { container } = render(<GraphNodeDisplayAny data={makeDisplayNodeData()} />);

    const copyButton = within(container).getByRole("button", { name: "Copy output" });
    fireEvent.click(copyButton);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Seedance output text"));
    expect(copyButton.getAttribute("title")).toBe("Copied");
  });
});

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PillSelect } from "@/components/ui/pill-select";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PillSelect", () => {
  it("opens down when there is usable space below", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 52,
      y: 390,
      top: 390,
      left: 52,
      bottom: 438,
      right: 392,
      width: 340,
      height: 48,
      toJSON: () => ({}),
    } as DOMRect);
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1139 });

    render(
      <PillSelect
        pickerId="model"
        open
        onToggle={() => undefined}
        onClose={() => undefined}
        appearance="admin"
        label="GPT Image 2 Image to Image"
        selectedValue="gpt-i2i"
        choices={[
          { value: "gpt-i2i", label: "GPT Image 2 Image to Image" },
          { value: "gpt-t2i", label: "GPT Image 2 Text to Image" },
        ]}
        onSelect={() => undefined}
      />,
    );

    expect(screen.getByText("GPT Image 2 Text to Image").closest(".admin-select-menu")?.className).toContain("top-[calc(100%+0.65rem)]");
  });

  it("closes on outside pointer down and Escape", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <div>
        <button type="button">Outside</button>
        <PillSelect
          pickerId="model"
          open
          onToggle={() => undefined}
          onClose={onClose}
          appearance="admin"
          label="GPT Image 2 Image to Image"
          selectedValue="gpt-i2i"
          choices={[{ value: "gpt-i2i", label: "GPT Image 2 Image to Image" }]}
          onSelect={() => undefined}
        />
      </div>,
    );

    fireEvent.pointerDown(screen.getByText("Outside"));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <PillSelect
        pickerId="model"
        open
        onToggle={() => undefined}
        onClose={onClose}
        appearance="admin"
        label="GPT Image 2 Image to Image"
        selectedValue="gpt-i2i"
        choices={[{ value: "gpt-i2i", label: "GPT Image 2 Image to Image" }]}
        onSelect={() => undefined}
      />,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

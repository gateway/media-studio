// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
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
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 1139,
    });

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

    expect(
      screen
        .getByText("GPT Image 2 Text to Image")
        .closest(".admin-select-menu")?.className,
    ).toContain("top-[calc(100%+0.65rem)]");
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

it("positions the composer menu outside flow and flips it as the rail scrolls", () => {
  let top = 76;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () =>
      ({
        x: 12,
        y: top,
        top,
        left: 12,
        bottom: top + 44,
        right: 352,
        width: 340,
        height: 44,
        toJSON: () => ({}),
      }) as DOMRect,
  );
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 992,
  });
  const onSelect = vi.fn();
  render(
    <PillSelect
      pickerId="model"
      viewportOverlay
      open
      onToggle={vi.fn()}
      onClose={vi.fn()}
      label="Model"
      choices={[
        { value: "first", label: "First model" },
        { value: "seedance-2.5", label: "Seedance 2.5" },
      ]}
      onSelect={onSelect}
    />,
  );
  const menu = screen
    .getByText("Seedance 2.5")
    .closest(".scrollbar-none") as HTMLElement;
  expect(menu.style.maxHeight).toBe("520px");
  expect(menu.style.position).toBe("fixed");
  expect(menu.style.top).toBe("132px");
  expect(menu.style.left).toBe("12px");
  top = 855;
  fireEvent.scroll(window);
  expect(menu.style.top).toBe("auto");
  expect(menu.style.bottom).toBe("149px");
  fireEvent.scroll(menu);
  expect(menu.style.maxHeight).toBe("520px");
  fireEvent.click(screen.getByText("Seedance 2.5"));
  expect(onSelect).toHaveBeenCalledExactlyOnceWith("seedance-2.5");
});

it("closes when the SVG caret is clicked again or focus leaves the picker", () => {
  function ComposerMenu() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <PillSelect
          pickerId="model"
          viewportOverlay
          open={open}
          onToggle={() => setOpen(!open)}
          onClose={() => setOpen(false)}
          label="Current model"
          choices={[{ value: "different", label: "Different model" }]}
          onSelect={vi.fn()}
        />
        <button type="button">Open another panel</button>
      </>
    );
  }
  render(<ComposerMenu />);
  const trigger = screen.getByRole("button", { name: "Current model" });
  const caret = trigger.querySelector("svg path")!;
  fireEvent.click(caret);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  fireEvent.pointerDown(caret);
  fireEvent.mouseDown(caret);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(caret);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");

  fireEvent.click(trigger);
  const option = screen.getByTestId("studio-picker-option-model-different");
  fireEvent.blur(trigger, { relatedTarget: option });
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  fireEvent.blur(option, {
    relatedTarget: screen.getByText("Open another panel"),
  });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

it.each([
  { top: 100, bottom: 134, height: 72, placement: "top-[calc(100%+0.65rem)]" },
  {
    top: 142,
    bottom: 176,
    height: 110,
    placement: "bottom-[calc(100%+0.65rem)]",
  },
])(
  "keeps a short viewport menu within its available $height px and adapts on resize",
  ({ top, bottom, height, placement }) => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top,
      bottom,
      left: 0,
      right: 300,
      width: 300,
      height: bottom - top,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } as DOMRect);
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 238,
    });
    const onSelect = vi.fn();
    render(
      <PillSelect
        pickerId="resolution"
        open
        onToggle={vi.fn()}
        onClose={vi.fn()}
        appearance="admin"
        label="Current resolution"
        choices={[{ value: "720p", label: "720p" }]}
        onSelect={onSelect}
      />,
    );
    const choice = screen.getByRole("button", { name: "720p" });
    const menu = choice.closest(".admin-select-menu") as HTMLElement;
    expect(menu.style.maxHeight).toBe(`${height}px`);
    expect(menu.className).toContain(placement);
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 900,
    });
    fireEvent.resize(window);
    expect(menu.style.maxHeight).toBe("360px");
    fireEvent.click(choice);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("720p");
  },
);

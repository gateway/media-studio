// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { StudioCreateStage } from "@/components/studio/studio-create-stage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function ComposerStage({ open = true }: { open?: boolean }) {
  return (
    <StudioCreateStage immersive composerCollapsed={!open}>
      <div id="studio-composer-shell">
        <textarea aria-label="Prompt" defaultValue="A red lantern" />
        <select aria-label="Resolution" defaultValue="2K">
          <option>1K</option>
          <option>2K</option>
        </select>
      </div>
    </StudioCreateStage>
  );
}

it("resizes a left composer with mouse and keyboard within bounds and preserves the draft", () => {
  vi.stubGlobal("innerWidth", 1265);
  vi.stubGlobal("PointerEvent", MouseEvent);
  const { container } = render(<ComposerStage />);
  const divider = screen.getByRole("separator", {
    name: "Resize Studio composer",
  });
  const prompt = screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: "Prompt",
  });
  const resolution = screen.getByRole<HTMLSelectElement>("combobox", {
    name: "Resolution",
  });
  const stage = container.querySelector<HTMLElement>("#create")!;
  const startWidth = Number(divider.getAttribute("aria-valuenow"));
  divider.setPointerCapture = vi.fn();
  divider.hasPointerCapture = () => true;
  divider.releasePointerCapture = vi.fn();

  fireEvent.pointerDown(divider, { button: 0, clientX: startWidth });
  fireEvent.pointerMove(divider, { clientX: startWidth + 100 });
  fireEvent.pointerUp(divider);
  expect(divider.releasePointerCapture).toHaveBeenCalledOnce();
  expect(stage.style.getPropertyValue("--studio-rail-size")).toBe(
    `${startWidth + 100}px`,
  );
  expect(document.activeElement).toBe(divider);
  fireEvent.keyDown(divider, { key: "ArrowLeft" });
  expect(divider.getAttribute("aria-valuenow")).toBe(String(startWidth + 90));
  fireEvent.keyDown(divider, { key: "Home" });
  expect(divider.getAttribute("aria-valuenow")).toBe(
    divider.getAttribute("aria-valuemin"),
  );
  fireEvent.keyDown(divider, { key: "End" });
  expect(divider.getAttribute("aria-valuenow")).toBe("600");
  expect(screen.getByRole("textbox", { name: "Prompt" })).toBe(prompt);
  expect(prompt.value).toBe("A red lantern");
  expect(resolution.value).toBe("2K");
});

it("reserves space for the gallery and restores the preferred desktop width after mobile and collapse", () => {
  vi.stubGlobal("innerWidth", 1265);
  const { rerender, container } = render(<ComposerStage />);
  fireEvent.keyDown(screen.getByRole("separator"), { key: "End" });

  vi.stubGlobal("innerWidth", 800);
  fireEvent.resize(window);
  expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe(
    "320",
  );

  vi.stubGlobal("innerWidth", 767);
  fireEvent.resize(window);
  expect(screen.queryByRole("separator")).toBeNull();
  expect(
    container
      .querySelector<HTMLElement>("#create")
      ?.style.getPropertyValue("--studio-rail-size"),
  ).toBe("");

  vi.stubGlobal("innerWidth", 1265);
  fireEvent.resize(window);
  rerender(<ComposerStage open={false} />);
  expect(screen.queryByRole("separator")).toBeNull();
  rerender(<ComposerStage />);
  expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe(
    "600",
  );
});

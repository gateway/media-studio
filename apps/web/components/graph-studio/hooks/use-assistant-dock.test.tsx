// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAssistantDock } from "./use-assistant-dock";

const key = "media-studio:graph-studio:assistant-layout";
let measure: (width: number) => void;
const disconnect = vi.fn();
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: (entries: unknown[]) => void) { measure = (width) => callback([{ contentRect: { width } }]); }
    observe() { measure(1200); }
    disconnect = disconnect;
  });
  vi.stubGlobal("PointerEvent", MouseEvent);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
function Harness({ open = true }: { open?: boolean }) {
  const dock = useAssistantDock(open);
  return <main ref={dock.containerRef} data-docked={dock.docked}>
    <select aria-label="Placement" value={dock.placement} onChange={(e) => dock.setPlacement(e.target.value as "right" | "floating")}>
      <option value="right">Right</option><option value="floating">Floating</option>
    </select>
    <div {...dock.splitterProps} />
  </main>;
}
it("defaults right, clamps the displayed width and restores saved width after a temporary fallback", () => {
  const { container } = render(<Harness />);
  const splitter = screen.getByRole("separator");
  expect(splitter.getAttribute("aria-valuenow")).toBe("420");
  fireEvent.keyDown(splitter, { key: "End" });
  expect(splitter.getAttribute("aria-valuenow")).toBe("720");
  act(() => measure(850));
  expect(splitter.getAttribute("aria-valuenow")).toBe("370");
  act(() => measure(790));
  expect(container.firstElementChild?.getAttribute("data-docked")).toBe("false");
  expect(JSON.parse(localStorage.getItem(key)!).width).toBe(720);
  act(() => measure(1200));
  expect(container.firstElementChild?.getAttribute("data-docked")).toBe("true");
  expect(splitter.getAttribute("aria-valuenow")).toBe("720");
});
it("supports pointer capture, cancellation and keyboard bounds without bubbling to canvas shortcuts", () => {
  const parentKey = vi.fn();
  const { unmount } = render(<div onKeyDown={parentKey}><Harness /></div>);
  const splitter = screen.getByRole("separator");
  splitter.setPointerCapture = vi.fn(); splitter.hasPointerCapture = () => true; splitter.releasePointerCapture = vi.fn();
  fireEvent.pointerDown(splitter, { button: 0, clientX: 900 });
  fireEvent.pointerMove(splitter, { clientX: 800 });
  expect(splitter.getAttribute("aria-valuenow")).toBe("520");
  fireEvent.pointerCancel(splitter);
  fireEvent.pointerMove(splitter, { clientX: 600 });
  expect(splitter.getAttribute("aria-valuenow")).toBe("520");
  fireEvent.keyDown(splitter, { key: "Home" });
  fireEvent.keyDown(splitter, { key: "ArrowRight" });
  expect(splitter.getAttribute("aria-valuenow")).toBe("320");
  fireEvent.keyDown(splitter, { key: "ArrowLeft", shiftKey: true });
  expect(splitter.getAttribute("aria-valuenow")).toBe("370");
  expect(parentKey).not.toHaveBeenCalled();
  fireEvent.pointerDown(splitter, { button: 0, clientX: 900 });
  fireEvent.pointerUp(splitter);
  expect(splitter.releasePointerCapture).toHaveBeenCalled();
  unmount(); expect(disconnect).toHaveBeenCalled();
});
it.each(["garbage", '{"placement":"left","width":"900"}', '{"width":null}', "[]"])("recovers malformed/obsolete preferences: %s", (value) => {
  localStorage.setItem(key, value); render(<Harness />);
  expect((screen.getByLabelText("Placement") as HTMLSelectElement).value).toBe("right");
  expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("420");
});
it("remembers placement and width through close and remount", () => {
  const view = render(<Harness />);
  fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowLeft" });
  fireEvent.change(screen.getByLabelText("Placement"), { target: { value: "floating" } });
  view.rerender(<Harness open={false} />); view.unmount(); render(<Harness />);
  expect((screen.getByLabelText("Placement") as HTMLSelectElement).value).toBe("floating");
  expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("430");
});

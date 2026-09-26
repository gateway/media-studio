// @vitest-environment jsdom
import { useRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AssistantPromptInput } from "./assistant-prompt-input";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("resizes upward within CSS bounds, cancels cleanly and supports keyboard without changing the draft", () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  const onChange = vi.fn();
  function Harness() {
    const inputRef = useRef<HTMLTextAreaElement>(null);
    return <AssistantPromptInput inputRef={inputRef} value="Keep this draft" placeholder="Message" onChange={onChange} />;
  }
  render(<Harness />);
  const input = screen.getByRole("textbox") as HTMLTextAreaElement;
  input.style.minHeight = "60px"; input.style.maxHeight = "360px";
  vi.spyOn(input, "getBoundingClientRect").mockImplementation(() => ({ height: parseFloat(input.style.height) || 80 }) as DOMRect);
  const grip = screen.getByRole("button", { name: "Resize prompt height" });
  grip.setPointerCapture = vi.fn(); grip.hasPointerCapture = () => true; grip.releasePointerCapture = vi.fn();
  fireEvent.pointerDown(grip, { button: 0, clientY: 600 });
  fireEvent.pointerMove(grip, { clientY: 400 });
  expect(input.style.height).toBe("280px");
  fireEvent.pointerCancel(grip);
  fireEvent.pointerMove(grip, { clientY: 100 });
  expect(input.style.height).toBe("280px");
  fireEvent.keyDown(grip, { key: "ArrowUp" });
  expect(input.style.height).toBe("300px");
  fireEvent.pointerDown(grip, { button: 0, clientY: 600 });
  fireEvent.pointerMove(grip, { clientY: 0 });
  expect(input.style.height).toBe("360px");
  fireEvent.pointerMove(grip, { clientY: 1000 });
  expect(input.style.height).toBe("60px");
  fireEvent.pointerUp(grip);
  expect(grip.releasePointerCapture).toHaveBeenCalled();
  fireEvent.keyDown(grip, { key: "ArrowDown" });
  expect(input.style.height).toBe("60px");
  expect(input.value).toBe("Keep this draft");
  expect(onChange).not.toHaveBeenCalled();
});

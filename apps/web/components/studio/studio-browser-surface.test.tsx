// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  StudioBrowserOverlay,
  StudioBrowserLoadSentinel,
} from "./studio-browser-surface";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("contains keyboard focus and restores the trigger when dismissed", () => {
  const trigger = document.createElement("button");
  document.body.append(trigger);
  trigger.focus();
  const onClose = vi.fn();
  const view = render(
    <StudioBrowserOverlay
      testId="browser"
      zIndexClassName="z-[121]"
      title="Projects"
      onClose={onClose}
    >
      <button>First</button>
      <button disabled>Unavailable</button>
      <button>Last</button>
    </StudioBrowserOverlay>,
  );
  const first = screen.getByRole("button", { name: "First" });
  const last = screen.getByRole("button", { name: "Last" });
  expect(document.activeElement).toBe(
    screen.getByRole("dialog", { name: "Projects" }),
  );
  fireEvent.keyDown(window, { key: "Tab" });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(window, { key: "Tab" });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(document.activeElement).toBe(trigger);
  trigger.remove();
});
it("leaves open pickers operable and reserves their first Escape", () => {
  const onClose = vi.fn();
  render(
    <StudioBrowserOverlay
      testId="browser"
      zIndexClassName="z-[121]"
      title="Presets"
      onClose={onClose}
    >
      <div data-studio-picker="category">
        <button aria-expanded="true">Category</button>
        <button>Portrait</button>
      </div>
    </StudioBrowserOverlay>,
  );
  expect(
    screen.getByRole("button", { name: "Portrait" }).closest("[inert]"),
  ).toBeNull();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();
});
it("suspends the parent while a child dialog owns keyboard interaction", () => {
  const onClose = vi.fn();
  render(
    <StudioBrowserOverlay
      testId="browser"
      zIndexClassName="z-[121]"
      title="Library"
      suspended
      onClose={onClose}
    >
      <button>Use image</button>
    </StudioBrowserOverlay>,
  );
  expect(screen.getByTestId("browser").hasAttribute("inert")).toBe(true);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();
});

it("returns to the invoking control after a nested dialog closes", () => {
  const props = {
    testId: "browser",
    zIndexClassName: "z-[121]",
    title: "Library",
    onClose: vi.fn(),
  };
  const view = render(
    <StudioBrowserOverlay {...props}>
      <button>Preview image</button>
    </StudioBrowserOverlay>,
  );
  const preview = screen.getByRole("button", { name: "Preview image" });
  preview.focus();
  view.rerender(
    <StudioBrowserOverlay {...props} suspended>
      <button>Preview image</button>
    </StudioBrowserOverlay>,
  );
  view.rerender(
    <StudioBrowserOverlay {...props}>
      <button>Preview image</button>
    </StudioBrowserOverlay>,
  );
  expect(document.activeElement).toBe(preview);
});

it("loads intersecting pages only while ready and disconnects while busy or unmounted", () => {
  let notify!: IntersectionObserverCallback;
  const observe = vi.fn();
  const disconnect = vi.fn();
  const observer = vi.fn(function (callback: IntersectionObserverCallback) {
    notify = callback;
    return { observe, disconnect };
  });
  vi.stubGlobal("IntersectionObserver", observer);
  const load = vi.fn(async () => {});
  const view = render(
    <StudioBrowserLoadSentinel loading={false} disabled onLoadMore={load} />,
  );
  expect(observer).not.toHaveBeenCalled();
  view.rerender(
    <StudioBrowserLoadSentinel loading={false} onLoadMore={load} />,
  );
  expect(observe).toHaveBeenCalledTimes(1);
  notify(
    [{ isIntersecting: false } as IntersectionObserverEntry],
    {} as IntersectionObserver,
  );
  expect(load).not.toHaveBeenCalled();
  notify(
    [{ isIntersecting: true } as IntersectionObserverEntry],
    {} as IntersectionObserver,
  );
  expect(load).toHaveBeenCalledTimes(1);
  view.rerender(<StudioBrowserLoadSentinel loading onLoadMore={load} />);
  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(observer).toHaveBeenCalledTimes(1);
  view.rerender(
    <StudioBrowserLoadSentinel loading={false} onLoadMore={load} />,
  );
  expect(observer).toHaveBeenCalledTimes(2);
  view.unmount();
  expect(disconnect).toHaveBeenCalledTimes(2);
});

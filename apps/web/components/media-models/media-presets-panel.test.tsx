// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MediaPresetsPanel } from "./media-presets-panel";
import type { MediaPreset } from "@/lib/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const preset = { preset_id: "seed", key: "seed", label: "Seed preset", status: "active", source_kind: "custom", model_key: "nano-banana-2", input_schema_json: [], input_slots_json: [], prompt_template: "Seed prompt" } as MediaPreset;
const seed = [preset];
const item = (id: string) => ({ ...preset, preset_id: id, key: id, label: `${id} preset` });
const response = (presets: MediaPreset[], next_offset: number | null = null) => new Response(JSON.stringify({ ok: true, presets, total: 3, next_offset }));
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}
const props = { presets: seed, total: 3, nextOffset: 60, seedValid: true, isImporting: false, onImportClick: vi.fn() };
let observe: IntersectionObserverCallback;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => response([item("remote")])));
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { observe = callback; }
    observe = vi.fn();
    disconnect = vi.fn();
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("MediaPresetsPanel scoped reads", () => {
  it("uses a valid first page in Strict Mode, including a valid empty catalog", () => {
    const view = render(<StrictMode><MediaPresetsPanel {...props} /></StrictMode>);
    expect(screen.getByRole("heading", { name: "Seed preset" })).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    view.rerender(<StrictMode><MediaPresetsPanel {...props} presets={[]} total={0} nextOffset={null} /></StrictMode>);
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText("Showing 0 of 0")).toBeTruthy();
  });

  it("distinguishes an empty search from an empty catalog", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response([])));
    render(<MediaPresetsPanel {...props} presets={[]} total={0} nextOffset={null} />);
    expect(screen.getByText("No structured presets have been added yet.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search media presets"), { target: { value: "no-match" } });
    await screen.findByText("No presets match your search.");
    expect(screen.queryByText("No structured presets have been added yet.")).toBeNull();
    fireEvent.change(screen.getByLabelText("Search media presets"), { target: { value: "" } });
    await screen.findByText("No structured presets have been added yet.");
  });

  it("fetches one full page when the server seed is invalid, sharing Strict Mode reads", async () => {
    render(<StrictMode><MediaPresetsPanel {...props} seedValid={false} /></StrictMode>);
    await screen.findByRole("heading", { name: "remote preset" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/control/media-presets?limit=60&offset=0&status=active");
  });

  it("ignores an older query success and failure after the latest query resolves", async () => {
    const old = deferred(), latest = deferred();
    vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("q=old") ? old.promise : latest.promise));
    render(<MediaPresetsPanel {...props} />);
    fireEvent.change(screen.getByLabelText("Search media presets"), { target: { value: "old" } });
    fireEvent.change(screen.getByLabelText("Search media presets"), { target: { value: "latest" } });
    await act(async () => latest.resolve(response([item("latest")])));
    await screen.findByRole("heading", { name: "latest preset" });
    await act(async () => old.resolve(new Response(JSON.stringify({ ok: false, error: "old failed" }), { status: 500 })));
    expect(screen.queryByText("old failed")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Seed preset" })).toBeNull();
    expect(screen.getByRole("heading", { name: "latest preset" })).toBeTruthy();
  });

  it("appends a page once when observer and click fire together and removes repeated IDs", async () => {
    const more = deferred();
    vi.stubGlobal("fetch", vi.fn(() => more.promise));
    render(<MediaPresetsPanel {...props} />);
    act(() => observe([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    fireEvent.click(screen.getByRole("button", { name: "Loading..." }));
    act(() => observe([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    await act(async () => more.resolve(response([preset, item("more")])));
    await screen.findByRole("heading", { name: "more preset" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(fetch).toHaveBeenCalledWith("/api/control/media-presets?limit=60&offset=60&status=active");
  });

  it("discards an old load-more result after search changes and clearing search restores the seed", async () => {
    const more = deferred();
    vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("offset=60") ? more.promise : Promise.resolve(response([item("search")]))));
    render(<MediaPresetsPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Load more presets" }));
    fireEvent.change(screen.getByLabelText("Search media presets"), { target: { value: "search" } });
    await screen.findByRole("heading", { name: "search preset" });
    await act(async () => more.resolve(response([item("stale-more")])));
    expect(screen.queryByRole("heading", { name: "stale-more preset" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Search media presets"), { target: { value: "" } });
    await screen.findByRole("heading", { name: "Seed preset" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries a failed first page and a failed append without hiding successful rows", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: "Read failed" }), { status: 500 }))
      .mockResolvedValueOnce(response([preset], 60))
      .mockRejectedValueOnce(new Error("Append failed"))
      .mockResolvedValueOnce(response([item("more")]));
    vi.stubGlobal("fetch", fetchMock);
    render(<MediaPresetsPanel {...props} seedValid={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry loading presets" }));
    await screen.findByRole("heading", { name: "Seed preset" });
    fireEvent.click(screen.getByRole("button", { name: "Load more presets" }));
    await screen.findByText("Append failed");
    expect(screen.getByRole("heading", { name: "Seed preset" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry loading presets" }));
    await screen.findByRole("heading", { name: "more preset" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("refreshes an active search on new props and rejects the previous in-flight query", async () => {
    const old = deferred();
    const fetchMock = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(response([item("fresh")]));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<MediaPresetsPanel {...props} />);
    fireEvent.change(screen.getByLabelText("Search media presets"), { target: { value: "query" } });
    view.rerender(<MediaPresetsPanel {...props} presets={[item("new-seed")]} />);
    await screen.findByRole("heading", { name: "fresh preset" });
    await act(async () => old.resolve(response([item("stale")])));
    expect(screen.queryByRole("heading", { name: "stale preset" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refreshes invalid seeds on new props rather than treating failed server loads as valid", async () => {
    const view = render(<MediaPresetsPanel {...props} seedValid={false} />);
    await screen.findByRole("heading", { name: "remote preset" });
    view.rerender(<MediaPresetsPanel {...props} seedValid={false} presets={[item("changed")]} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
});

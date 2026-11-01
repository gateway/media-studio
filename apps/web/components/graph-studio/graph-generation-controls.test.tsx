// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphGenerationControls } from "./graph-generation-controls";

const offline = { live_submit_enabled: false, kie_api_key_configured: true };
const live = { ...offline, live_submit_enabled: true };
const response = (body: object, status = 200) => ({ ok: status === 200, status, json: async () => body });
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => { fetcher = vi.fn().mockResolvedValue(response(offline)); vi.stubGlobal("fetch", fetcher); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function setup(runActive = false) {
  const onRun = vi.fn();
  render(<GraphGenerationControls runActive={runActive} onRun={onRun} />);
  return onRun;
}

describe("KIE generation mode", () => {
  it("shows a compact offline control and only runs after the user presses Run offline", async () => {
    const onRun = setup();
    const simulate = await screen.findByRole("button", { name: "Run offline" });
    expect(screen.getByRole("button", { name: "Offline mode — enable live generation" }).title).toContain("placeholder");
    expect(screen.queryByRole("status")).toBeNull();
    expect(onRun).not.toHaveBeenCalled();
    fireEvent.click(simulate);
    await waitFor(() => expect(onRun).toHaveBeenCalledTimes(1));
  });

  it("requires an explicit enable click and never runs a workflow when enabling live", async () => {
    const onRun = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Offline mode — enable live generation" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("provider credits");
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValueOnce(response(live));
    fireEvent.click(within(dialog).getByRole("button", { name: "Enable live", exact: true }));
    await screen.findByRole("button", { name: "Run", exact: true });
    expect(screen.queryByText("Offline")).toBeNull();
    expect(screen.queryByText("Live mode")).toBeNull();
    expect(fetcher.mock.calls[1]).toEqual(["/api/control/media/generation-mode/enable-live", { method: "POST", cache: "no-store", headers: {} }]);
    expect(onRun).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows no mode control or banner when live", async () => {
    fetcher.mockResolvedValue(response(live));
    setup();
    await waitFor(() => expect((screen.getByTestId("graph-run-button") as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText("Offline")).toBeNull();
    expect(screen.queryByText("Live mode")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps simulation when the server rejects a busy queue", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Offline mode — enable live generation" }));
    fetcher.mockResolvedValueOnce(response({ detail: "Finish or cancel pending jobs." }, 409));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Enable live", exact: true }));
    expect((await screen.findByRole("alert")).textContent).toContain("Finish or cancel");
    expect(screen.getByText("Offline")).toBeTruthy();
  });

  it("directs missing credentials to Connections instead of enabling", async () => {
    fetcher.mockResolvedValue(response({ ...offline, kie_api_key_configured: false }));
    setup();
    expect((await screen.findByRole("link")).getAttribute("href")).toBe("/settings/connections");
    expect(screen.queryByRole("button", { name: "Offline mode — enable live generation" })).toBeNull();
  });

  it("does not run when the mode changes between display and click", async () => {
    const onRun = setup();
    const simulate = await screen.findByRole("button", { name: "Run offline" });
    fetcher.mockResolvedValueOnce(response(live));
    fireEvent.click(simulate);
    expect((await screen.findByRole("alert")).textContent).toContain("Generation mode changed");
    expect(onRun).not.toHaveBeenCalled();
  });

  it("disables Run when the mode cannot be read, and supports retry", async () => {
    fetcher.mockRejectedValueOnce(new Error("Connection unavailable"));
    setup();
    await screen.findByRole("alert");
    expect((screen.getByTestId("graph-run-button") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await screen.findByRole("button", { name: "Run offline" });
  });

  it("does not offer a mode change or another run while this graph is running", async () => {
    setup(true);
    const enable = await screen.findByRole("button", { name: "Offline mode — enable live generation" });
    expect((enable as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("graph-run-button")).toBeNull();
  });
});

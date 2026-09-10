// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GraphAssistantSetup } from "./graph-assistant-setup";
import { useGraphAssistantAvailability } from "./hooks/use-graph-assistant-availability";

function Harness() {
  const availability = useGraphAssistantAvailability();
  return availability.status === "ready"
    ? <div>Operational Assistant ready</div>
    : <GraphAssistantSetup status={availability.status} bottomOffset={18} onCheckAgain={availability.checkAgain} onClose={vi.fn()} />;
}

const ready = { media_assistant_enabled: true, codex_local_ready: true, codex_local_command_available: true, codex_local_login_configured: true };
const healthResponse = (health: object) => ({ ok: true, json: async () => health });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Media Assistant setup entry", () => {
  it("shows setup without requesting an operational session when the feature is disabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_MEDIA_STUDIO_ASSISTANT_DEBUG", "0");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<Harness />);
    expect(await screen.findByText("Media Assistant is not enabled")).toBeTruthy();
    expect(screen.getByText(/NEXT_PUBLIC_MEDIA_STUDIO_ASSISTANT_DEBUG=1/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Setup" }).getAttribute("href")).toBe("/setup");
    expect(screen.getByRole("link", { name: "AI Settings" }).getAttribute("href")).toBe("/settings/llms");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...ready, media_assistant_enabled: false }, "Media Assistant is not enabled"],
    [{ ...ready, codex_local_ready: false, codex_local_command_available: false }, "Install Codex to use Media Assistant"],
    [{ ...ready, codex_local_ready: false, codex_local_login_configured: false }, "Sign in to Codex"],
    [{ ...ready, codex_local_ready: false }, "Codex Local is not ready"],
  ])("explains the health blocker and only makes a readiness request", async (health, title) => {
    vi.stubEnv("NEXT_PUBLIC_MEDIA_STUDIO_ASSISTANT_DEBUG", "1");
    const fetchMock = vi.fn().mockResolvedValue(healthResponse(health));
    vi.stubGlobal("fetch", fetchMock);
    render(<Harness />);
    expect(await screen.findByText(title)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/control/health", { cache: "no-store" });
    expect(screen.queryByText("Operational Assistant ready")).toBeNull();
  });

  it("keeps actions unavailable while checking, distinguishes health failure, and retries to ready", async () => {
    vi.stubEnv("NEXT_PUBLIC_MEDIA_STUDIO_ASSISTANT_DEBUG", "1");
    let resolveHealth!: (response: object) => void;
    const fetchMock = vi.fn()
      .mockReturnValueOnce(new Promise((resolve) => { resolveHealth = resolve; }))
      .mockResolvedValueOnce(healthResponse(ready));
    vi.stubGlobal("fetch", fetchMock);
    render(<Harness />);
    expect(screen.getByText("Checking Media Assistant")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Check again" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("Operational Assistant ready")).toBeNull();
    await act(async () => resolveHealth({ ok: false, status: 503 }));
    expect(await screen.findByText("Could not check Media Assistant")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Operational Assistant ready")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("complementary", { name: "Media assistant setup" })).toBeNull();
  });

  it("recovers from an unavailable Codex after setup without reloading", async () => {
    vi.stubEnv("NEXT_PUBLIC_MEDIA_STUDIO_ASSISTANT_DEBUG", "1");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(healthResponse({ ...ready, codex_local_ready: false }))
      .mockResolvedValueOnce(healthResponse(ready)));
    render(<Harness />);
    await screen.findByText("Codex Local is not ready");
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(screen.getByText("Operational Assistant ready")).toBeTruthy());
  });

  it("can close setup without changing readiness or launching Codex", () => {
    const close = vi.fn();
    const retry = vi.fn();
    render(<GraphAssistantSetup status="missing" bottomOffset={18} onCheckAgain={retry} onClose={close} />);
    fireEvent.click(screen.getByRole("button", { name: "Close Media Assistant setup" }));
    expect(close).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
  });
});

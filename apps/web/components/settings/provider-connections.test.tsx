// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderConnections } from "@/components/settings/provider-connections";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); refresh.mockReset(); });

describe("ProviderConnections", () => {
  it("saves a connection without sending an empty key and refreshes its consumers", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ provider_kind: "openrouter" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const changed = vi.fn();
    window.addEventListener("provider-connections-changed", changed);
    render(<ProviderConnections connections={[{ provider_kind: "openrouter", configured: true, api_key_configured: true, credential_source: "stored", base_url: "https://router.invalid/v1" }]} />);
    expect(screen.getByLabelText("API key").getAttribute("type")).toBe("password");
    fireEvent.change(screen.getByLabelText("API base URL"), { target: { value: "https://new.invalid/v1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save OpenRouter connection" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ base_url: "https://new.invalid/v1" });
    expect(changed).toHaveBeenCalledOnce();
    expect(screen.getByText(/Connection saved/)).toBeTruthy();
    window.removeEventListener("provider-connections-changed", changed);
  });
});

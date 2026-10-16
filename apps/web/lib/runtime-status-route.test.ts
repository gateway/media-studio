import { beforeEach, describe, expect, it, vi } from "vitest";

const probes = vi.hoisted(() => ({ run: vi.fn(), spawn: vi.fn() }));
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  return { execFile: Object.assign(vi.fn(), { [promisify.custom]: probes.run }), spawn: probes.spawn };
});

describe("runtime status from the responding web server", () => {
  beforeEach(() => {
    probes.run.mockReset().mockResolvedValue({ stdout: "", stderr: "" });
    probes.spawn.mockReset();
  });

  it("reports the responding web server running when process-name discovery finds nothing", async () => {
    const { GET } = await import("@/app/api/control/runtime/route");
    const response = await GET(new Request("http://localhost/api/control/runtime"));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.services.web).toMatchObject({ status: "running", supervisor: "manual", manageable: false });
    expect(payload.services.api.status).toBe("inactive");
  });

  it("does not label a live manual web server failed because an old launchd entry exited", async () => {
    probes.run.mockImplementation(async (command: string) => ({ stdout: command === "launchctl" ? "-\t126\tcom.media-studio.web\n" : "" }));
    const { GET } = await import("@/app/api/control/runtime/route");
    const payload = await (await GET(new Request("http://localhost/api/control/runtime"))).json();
    expect(payload.services.web).toMatchObject({ status: "running", supervisor: "manual", manageable: false });
  });

  it("retains management for a running launchd service", async () => {
    probes.run.mockImplementation(async (command: string) => ({ stdout: command === "launchctl" ? "123\t0\tcom.media-studio.web\n" : "" }));
    const { GET } = await import("@/app/api/control/runtime/route");
    const payload = await (await GET(new Request("http://localhost/api/control/runtime"))).json();
    expect(payload.services.web).toMatchObject({ status: "running", supervisor: "launchd", manageable: true });
  });

  it("still reports web running when process inspection is unavailable", async () => {
    probes.run.mockRejectedValue(new Error("process inspection unavailable"));
    const { GET } = await import("@/app/api/control/runtime/route");
    const payload = await (await GET(new Request("http://localhost/api/control/runtime"))).json();
    expect(payload.services.web).toMatchObject({ status: "running", manageable: false });
  });

  it("rejects untrusted requests before inspecting processes", async () => {
    const { GET } = await import("@/app/api/control/runtime/route");
    const response = await GET(new Request("https://untrusted.example/api/control/runtime"));
    expect(response.status).toBe(403);
    expect(probes.run).not.toHaveBeenCalled();
  });

  it("keeps manual restart disabled", async () => {
    const { POST } = await import("@/app/api/control/runtime/route");
    const response = await POST(new Request("http://localhost/api/control/runtime", { method: "POST", body: JSON.stringify({service: "web", action: "restart"}) }));
    expect(response.status).toBe(400);
    expect(probes.spawn).not.toHaveBeenCalled();
  });
});

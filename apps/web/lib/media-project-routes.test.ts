import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const listMediaProjects = vi.fn();
const createMediaProject = vi.fn();
const updateMediaProject = vi.fn();
const archiveMediaProject = vi.fn();
const unarchiveMediaProject = vi.fn();
const deleteMediaProject = vi.fn();
const listProjectReferences = vi.fn();
const attachProjectReference = vi.fn();
const detachProjectReference = vi.fn();

vi.mock("@/lib/control-api", () => ({
  listMediaProjects,
  createMediaProject,
  updateMediaProject,
  archiveMediaProject,
  unarchiveMediaProject,
  deleteMediaProject,
  listProjectReferences,
  attachProjectReference,
  detachProjectReference,
}));

describe("project control web routes", () => {
  beforeEach(() => {
    vi.resetModules();
    listMediaProjects.mockReset();
    createMediaProject.mockReset();
    updateMediaProject.mockReset();
    archiveMediaProject.mockReset();
    unarchiveMediaProject.mockReset();
    deleteMediaProject.mockReset();
    listProjectReferences.mockReset();
    attachProjectReference.mockReset();
    detachProjectReference.mockReset();
  });

  it("lists projects through the project route wrapper", async () => {
    listMediaProjects.mockResolvedValueOnce({
      ok: true,
      data: { projects: [{ project_id: "project-1", name: "Alpha", status: "active" }] },
    });

    const { GET } = await import("@/app/api/control/media/projects/route");
    const response = await GET(new NextRequest("http://localhost/api/control/media/projects?status=all"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(listMediaProjects).toHaveBeenCalledWith("all");
    expect(payload).toEqual({
      ok: true,
      projects: [{ project_id: "project-1", name: "Alpha", status: "active" }],
    });
  });

  it("creates a project with wrapped project payload", async () => {
    createMediaProject.mockResolvedValueOnce({
      ok: true,
      data: { project: { project_id: "project-1", name: "Alpha", status: "active" } },
    });

    const { POST } = await import("@/app/api/control/media/projects/route");
    const response = await POST(
      new NextRequest("http://localhost/api/control/media/projects", {
        method: "POST",
        body: JSON.stringify({ name: "Alpha", description: "" }),
        headers: { "content-type": "application/json" },
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(createMediaProject).toHaveBeenCalledWith({ name: "Alpha", description: "" });
    expect(payload).toEqual({
      ok: true,
      project: { project_id: "project-1", name: "Alpha", status: "active" },
    });
  });

  it("updates, archives, restores, and deletes projects through wrapped routes", async () => {
    updateMediaProject.mockResolvedValueOnce({
      ok: true,
      data: { project: { project_id: "project-1", name: "Beta", status: "active" } },
    });
    archiveMediaProject.mockResolvedValueOnce({
      ok: true,
      data: { project: { project_id: "project-1", name: "Beta", status: "archived" } },
    });
    unarchiveMediaProject.mockResolvedValueOnce({
      ok: true,
      data: { project: { project_id: "project-1", name: "Beta", status: "active" } },
    });
    deleteMediaProject.mockResolvedValueOnce({
      ok: true,
      data: { project: null },
    });

    const projectRoute = await import("@/app/api/control/media/projects/[projectId]/route");
    const archiveRoute = await import("@/app/api/control/media/projects/[projectId]/archive/route");
    const unarchiveRoute = await import("@/app/api/control/media/projects/[projectId]/unarchive/route");

    const patchResponse = await projectRoute.PATCH(
      new NextRequest("http://localhost/api/control/media/projects/project-1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Beta", description: "Updated" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ projectId: "project-1" }) },
    );
    const patchPayload = await patchResponse.json();

    const archiveResponse = await archiveRoute.POST(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: "project-1" }),
    });
    const archivePayload = await archiveResponse.json();

    const unarchiveResponse = await unarchiveRoute.POST(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: "project-1" }),
    });
    const unarchivePayload = await unarchiveResponse.json();

    const deleteResponse = await projectRoute.DELETE(
      new NextRequest("http://localhost/api/control/media/projects/project-1?permanent=true", { method: "DELETE" }),
      { params: Promise.resolve({ projectId: "project-1" }) },
    );
    const deletePayload = await deleteResponse.json();

    expect(patchPayload).toEqual({
      ok: true,
      project: { project_id: "project-1", name: "Beta", status: "active" },
    });
    expect(archivePayload).toEqual({
      ok: true,
      project: { project_id: "project-1", name: "Beta", status: "archived" },
    });
    expect(unarchivePayload).toEqual({
      ok: true,
      project: { project_id: "project-1", name: "Beta", status: "active" },
    });
    expect(deletePayload).toEqual({
      ok: true,
      project: null,
    });
    expect(deleteMediaProject).toHaveBeenCalledWith("project-1", true);
  });

  it("lists and mutates project reference attachments", async () => {
    listProjectReferences.mockResolvedValueOnce({
      ok: true,
      data: {
        items: [{ reference_id: "ref-1", kind: "image" }],
        limit: 100,
        offset: 0,
      },
    });
    attachProjectReference.mockResolvedValueOnce({
      ok: true,
      data: { item: { reference_id: "ref-1", kind: "image" } },
    });
    detachProjectReference.mockResolvedValueOnce({
      ok: true,
      data: { item: { reference_id: "ref-1", kind: "image" } },
    });

    const listRoute = await import("@/app/api/control/media/projects/[projectId]/references/route");
    const itemRoute = await import("@/app/api/control/media/projects/[projectId]/references/[referenceId]/route");

    const listResponse = await listRoute.GET(
      new NextRequest("http://localhost/api/control/media/projects/project-1/references?kind=image"),
      { params: Promise.resolve({ projectId: "project-1" }) },
    );
    const listPayload = await listResponse.json();

    const attachResponse = await itemRoute.POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ projectId: "project-1", referenceId: "ref-1" }),
    });
    const attachPayload = await attachResponse.json();

    const detachResponse = await itemRoute.DELETE(new Request("http://localhost", { method: "DELETE" }), {
      params: Promise.resolve({ projectId: "project-1", referenceId: "ref-1" }),
    });
    const detachPayload = await detachResponse.json();

    expect(listPayload).toEqual({
      ok: true,
      items: [{ reference_id: "ref-1", kind: "image" }],
      limit: 100,
      offset: 0,
    });
    expect(attachPayload).toEqual({
      ok: true,
      item: { reference_id: "ref-1", kind: "image" },
    });
    expect(detachPayload).toEqual({
      ok: true,
      item: { reference_id: "ref-1", kind: "image" },
    });
  });
});

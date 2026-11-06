// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioHeaderChrome } from "@/components/studio/studio-header-chrome";

afterEach(cleanup);

function renderHeader(
  overrides: Partial<ComponentProps<typeof StudioHeaderChrome>> = {},
) {
  const callbacks = {
    onGalleryModelFilterChange: vi.fn(),
    onActivateGalleryKindFilter: vi.fn(),
    onToggleFavoritesFilter: vi.fn(),
    onOpenStudio: vi.fn(),
    onOpenGraph: vi.fn(),
    onOpenProjects: vi.fn(),
    onOpenProjectWorkspace: vi.fn(),
    onOpenPresets: vi.fn(),
    onOpenLibrary: vi.fn(),
    onOpenSettings: vi.fn(),
  };
  render(
    <StudioHeaderChrome
      immersive
      apiHealthy
      galleryModelFilter="all"
      models={[]}
      favoritesOnly={false}
      galleryKindFilter="all"
      {...callbacks}
      {...overrides}
    />,
  );
  return callbacks;
}

describe("StudioHeaderChrome", () => {
  it("uses the same filter actions from the All media menu and returns keyboard focus", () => {
    const callbacks = renderHeader();
    const trigger = screen.getByRole("button", { name: "All media" });
    fireEvent.click(trigger);
    const images = screen.getByRole("button", { name: "Images" });
    images.focus();
    fireEvent.keyDown(images, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Videos" }));
    expect(
      callbacks.onActivateGalleryKindFilter,
    ).toHaveBeenCalledExactlyOnceWith("video");

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Favorites" }));
    expect(callbacks.onToggleFavoritesFilter).toHaveBeenCalledTimes(1);
  });

  it("groups the existing library actions without duplicating Projects", () => {
    const callbacks = renderHeader();
    const library = screen.getByRole("button", { name: "Library" });
    fireEvent.click(library);
    expect(screen.getAllByRole("button", { name: "Projects" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Media Presets" }));
    fireEvent.click(library);
    fireEvent.click(screen.getByRole("button", { name: "Reference library" }));
    fireEvent.click(screen.getByRole("button", { name: "Projects" }));
    fireEvent.click(screen.getByRole("button", { name: "Graph" }));
    expect(callbacks.onOpenPresets).toHaveBeenCalledTimes(1);
    expect(callbacks.onOpenLibrary).toHaveBeenCalledTimes(1);
    expect(callbacks.onOpenProjects).toHaveBeenCalledTimes(1);
    expect(callbacks.onOpenGraph).toHaveBeenCalledTimes(1);
  });

  it("shows the live balance and keeps project selection and exit scoped to the current project", () => {
    const callbacks = renderHeader({
      project: { project_id: "project-7", name: "A working project" },
      remainingCredits: 1066.6,
    });
    expect(screen.getByText("1,066.6 credits")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Open project A working project" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Exit project workspace" }),
    );
    expect(callbacks.onOpenProjectWorkspace.mock.calls).toEqual([
      ["project-7"],
      [null],
    ]);
  });
});

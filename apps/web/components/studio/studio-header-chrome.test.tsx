// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StudioHeaderChrome } from "@/components/studio/studio-header-chrome";

function renderHeader() {
  return render(
    <StudioHeaderChrome
      immersive
      apiHealthy
      galleryModelFilter="all"
      models={[]}
      favoritesOnly={false}
      galleryKindFilter="all"
      onGalleryModelFilterChange={vi.fn()}
      onActivateGalleryKindFilter={vi.fn()}
      onToggleFavoritesFilter={vi.fn()}
      onOpenProjects={vi.fn()}
      onOpenPresets={vi.fn()}
      onOpenLibrary={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  );
}

describe("StudioHeaderChrome", () => {
  it("uses the shared dark badge surface for inactive filter buttons and keeps active filters primary", () => {
    renderHeader();

    expect(screen.getByLabelText("All media").className).toContain("var(--action-primary-fill)");
    expect(screen.getByLabelText("Images").className).toContain("studio-badge");
    expect(screen.getByLabelText("Presets").className).toContain("studio-badge");
  });
});

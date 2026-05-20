import { describe, expect, it } from "vitest";

import {
  studioBadgeClassName,
  studioBadgeIconClassName,
  studioCaptionClassName,
  studioMetaLabelClassName,
  studioMetaValueClassName,
  studioPreviewFallbackClassName,
  studioPreviewOverlayClassName,
} from "@/components/studio/studio-theme";

describe("studio theme helpers", () => {
  it("builds badge classes from semantic tones and sizes", () => {
    expect(studioBadgeClassName()).toContain("studio-badge");
    expect(studioBadgeClassName({ tone: "accent", size: "compact" })).toContain("studio-badge-accent");
    expect(studioBadgeClassName({ tone: "accent", size: "compact" })).toContain("studio-badge-compact");
    expect(studioBadgeClassName({ tone: "project" })).toContain("studio-badge-project");
  });

  it("builds icon and text helpers from shared semantic tokens", () => {
    expect(studioBadgeIconClassName({ tone: "danger" })).toContain("studio-badge-icon-danger");
    expect(studioMetaLabelClassName()).toContain("studio-meta-label");
    expect(studioMetaValueClassName({ tone: "accent" })).toContain("studio-meta-value-accent");
    expect(studioCaptionClassName()).toContain("studio-caption");
    expect(studioPreviewFallbackClassName()).toContain("studio-preview-fallback");
    expect(studioPreviewOverlayClassName()).toContain("studio-preview-overlay");
  });
});

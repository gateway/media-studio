import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  adminDashedCardClassName,
  adminInsetSurfaceClassName,
} from "@/components/admin-controls";
import { buttonClassName } from "@/components/ui/button";
import { iconButtonClassName } from "@/components/ui/icon-button";
import { pillSelectButtonClassName } from "@/components/ui/pill-select";
import {
  calloutPanelClassName,
  emptyStateClassName,
  infoRowClassName,
  mediaBrowserCardClassName,
  overlayPanelClassName,
  propertyStackClassName,
  surfaceCardClassName,
  surfaceInputShellClassName,
  surfaceInsetClassName,
} from "@/components/ui/surface-primitives";
import { feedbackToneClassName } from "@/components/ui/toast-banner";

describe("ui primitives", () => {
  it("keeps studio and admin button variants token-backed through shared action variables", () => {
    expect(buttonClassName({ appearance: "studio", variant: "primary" })).toContain("var(--action-primary-fill)");
    expect(buttonClassName({ appearance: "admin", variant: "primary" })).toContain("var(--action-primary-fill)");
    expect(buttonClassName({ appearance: "studio", variant: "subtle" })).toContain("var(--action-subtle-border)");
    expect(buttonClassName({ appearance: "admin", variant: "danger" })).toContain("var(--action-danger-border)");
  });

  it("supports compact button sizing without redefining variants", () => {
    const studioCompact = buttonClassName({ appearance: "studio", variant: "primary", size: "compact" });
    const adminCompact = buttonClassName({ appearance: "admin", variant: "subtle", size: "compact" });

    expect(studioCompact).toContain("h-9");
    expect(adminCompact).toContain("px-[0.9rem]");
  });

  it("uses shared icon button tones for studio surfaces", () => {
    expect(iconButtonClassName({ tone: "primary" })).toContain("var(--action-primary-fill)");
    expect(iconButtonClassName({ tone: "danger" })).toContain("var(--action-danger-border)");
    expect(iconButtonClassName({ tone: "favorite" })).toContain("rgba(255,126,166,0.16)");
  });

  it("uses shared pill select button styles for both app surfaces", () => {
    expect(pillSelectButtonClassName("studio")).toContain("var(--action-subtle-border)");
    expect(pillSelectButtonClassName("admin")).toContain("admin-form-control");
    expect(pillSelectButtonClassName("admin")).toContain("admin-select-trigger");
  });

  it("maps feedback intents to semantic theme tokens", () => {
    expect(feedbackToneClassName("working", "studio")).toContain("var(--feedback-working-border)");
    expect(feedbackToneClassName("danger", "studio")).toContain("var(--feedback-danger-surface)");
    expect(feedbackToneClassName("healthy", "admin")).toContain("var(--feedback-healthy-text)");
    expect(feedbackToneClassName("warning", "admin")).toContain("var(--feedback-warning-border)");
  });

  it("resolves shared surface primitives to semantic classes", () => {
    expect(surfaceCardClassName({ appearance: "studio" })).toContain("surface-card");
    expect(surfaceCardClassName({ appearance: "admin", tone: "accent" })).toContain("surface-card-accent");
    expect(surfaceInsetClassName({ appearance: "studio" })).toContain("surface-inset");
    expect(infoRowClassName({ appearance: "studio", interactive: true })).toContain("surface-info-row");
    expect(overlayPanelClassName({ appearance: "studio" })).toContain("overlay-panel");
    expect(emptyStateClassName({ appearance: "studio" })).toContain("surface-empty-state");
  });

  it("maps the second-wave shared surfaces to semantic class contracts", () => {
    expect(mediaBrowserCardClassName({ appearance: "studio", selected: true })).toContain("media-browser-card");
    expect(calloutPanelClassName({ appearance: "admin", tone: "danger" })).toContain("callout-panel-danger");
    expect(propertyStackClassName({ appearance: "admin" })).toContain("property-stack");
    expect(surfaceInputShellClassName({ appearance: "studio" })).toContain("surface-input-shell");
  });

  it("documents retained compatibility aliases in globals.css", () => {
    const globalsPath = path.resolve(process.cwd(), "app/globals.css");
    const globalsSource = readFileSync(globalsPath, "utf8");

    expect(globalsSource).toContain("compatibility alias");
    expect(globalsSource).toContain(".admin-surface-card");
  });

  it("keeps admin inset and empty-state helpers routed through shared surface contracts", () => {
    expect(adminInsetSurfaceClassName).toContain("surface-inset");
    expect(adminDashedCardClassName).toContain("surface-empty-state");
  });
});

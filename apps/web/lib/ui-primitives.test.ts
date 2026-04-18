import { describe, expect, it } from "vitest";

import { buttonClassName } from "@/components/ui/button";
import { iconButtonClassName } from "@/components/ui/icon-button";
import { pillSelectButtonClassName } from "@/components/ui/pill-select";
import { feedbackToneClassName } from "@/components/ui/toast-banner";

describe("ui primitives", () => {
  it("keeps studio and admin button variants distinct and token-backed", () => {
    expect(buttonClassName({ appearance: "studio", variant: "primary" })).toContain("var(--ms-action-primary-fill)");
    expect(buttonClassName({ appearance: "admin", variant: "primary" })).toContain("var(--ui-action-primary-fill)");
    expect(buttonClassName({ appearance: "studio", variant: "subtle" })).toContain("var(--ms-action-subtle-border)");
    expect(buttonClassName({ appearance: "admin", variant: "danger" })).toContain("var(--ui-action-danger-border)");
  });

  it("supports compact button sizing without redefining variants", () => {
    const studioCompact = buttonClassName({ appearance: "studio", variant: "primary", size: "compact" });
    const adminCompact = buttonClassName({ appearance: "admin", variant: "subtle", size: "compact" });

    expect(studioCompact).toContain("h-9");
    expect(adminCompact).toContain("px-[0.95rem]");
  });

  it("uses shared icon button tones for studio surfaces", () => {
    expect(iconButtonClassName({ tone: "primary" })).toContain("var(--ms-action-primary-fill)");
    expect(iconButtonClassName({ tone: "danger" })).toContain("var(--ms-action-danger-border)");
    expect(iconButtonClassName({ tone: "favorite" })).toContain("rgba(255,126,166,0.16)");
  });

  it("uses shared pill select button styles for both app surfaces", () => {
    expect(pillSelectButtonClassName("studio")).toContain("var(--ms-action-subtle-border)");
    expect(pillSelectButtonClassName("admin")).toContain("admin-form-control");
    expect(pillSelectButtonClassName("admin")).toContain("admin-select-trigger");
  });

  it("maps feedback intents to semantic theme tokens", () => {
    expect(feedbackToneClassName("working", "studio")).toContain("var(--ms-feedback-working-border)");
    expect(feedbackToneClassName("danger", "studio")).toContain("var(--ms-feedback-danger-surface)");
    expect(feedbackToneClassName("healthy", "admin")).toContain("var(--ui-feedback-healthy-text)");
    expect(feedbackToneClassName("warning", "admin")).toContain("var(--ui-feedback-warning-border)");
  });
});

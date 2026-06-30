// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { Coins } from "lucide-react";
import { describe, expect, it } from "vitest";

import { StudioMetricPill } from "@/components/studio/studio-metric-pill";

describe("StudioMetricPill", () => {
  it("keeps highlighted credit pills on the default Studio badge surface", () => {
    render(<StudioMetricPill icon={Coins} value="6" accent="highlight" />);

    const pill = screen.getByText("6").closest(".studio-badge");

    expect(pill?.className).toContain("studio-badge");
    expect(pill?.className).not.toContain("studio-badge-accent");
    expect(pill?.querySelector(".studio-badge-icon-accent")).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PricingRuleRow } from "@/app/pricing/pricing-rule-row";
import { buildPricingScenarioRows } from "@/app/pricing/pricing-rule-view";

const rule = { model_key: "image-model", provider: "Example", interface_type: "image", billing_unit: "request", base_credits: 8, base_cost_usd: 0.04, pricing_status: "observed_site_pricing", multipliers: { resolution: { "1k": 1, "2k": 1.5, "4k": 2.25 } }, notes: ["First rate note", "Second rate note"] };
afterEach(cleanup);

describe("Pricing rule disclosure", () => {
  it("keeps rates compact and shows both currencies and output counts when expanded", () => {
    const { container } = render(<PricingRuleRow rule={rule} model={null} authoritative={false} />);
    const row=container.querySelector("details")!;
    expect(row.open).toBe(false);
    fireEvent.click(container.querySelector("summary")!);
    expect(row.open).toBe(true);
    const examples=screen.getByRole("region",{name:"Example totals"});
    expect(within(examples).getByRole("columnheader",{name:"1 output"})).toBeTruthy();
    expect(within(examples).getByRole("columnheader",{name:"2 outputs"})).toBeTruthy();
    expect(within(examples).getByText("$0.06")).toBeTruthy();
    expect(within(examples).getByText("12 credits")).toBeTruthy();
    expect(within(examples).getByText("$0.12")).toBeTruthy();
    expect(within(examples).getByText("24 credits")).toBeTruthy();
    expect(screen.getByText("First rate note")).toBeTruthy();
    expect(screen.getByText("Second rate note")).toBeTruthy();
    const source=container.querySelector<HTMLDetailsElement>(".admin-pricing-source-details")!;
    expect(source.open).toBe(false);
    fireEvent.click(within(source).getByText("Model and source details"));
    expect(source.open).toBe(true);
    expect(within(source).getByText("image-model")).toBeTruthy();
  });
  it("keeps unknown per-second rates honest without inventing per-output totals", () => {
    const { container }=render(<PricingRuleRow rule={{model_key:"unknown",billing_unit:"second"}} model={null} authoritative={false} />);
    fireEvent.click(container.querySelector("summary")!);
    expect(screen.getAllByText("n/a")).toHaveLength(2);
    expect(screen.getByText(/base rate above is per second/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
  it("retains explicit zero estimates and missing USD independently from credits", () => {
    const rows=buildPricingScenarioRows({...rule,base_credits:0,base_cost_usd:0},null);
    expect(rows[0]).toMatchObject({perOutputUsd:"$0.00",perOutputCredits:"0 credits",twoOutputUsd:"$0.00",twoOutputCredits:"0 credits"});
    const creditsOnly=buildPricingScenarioRows({...rule,base_cost_usd:null},null);
    expect(creditsOnly[0].perOutputUsd).toBe("n/a");
    expect(creditsOnly[0].perOutputCredits).toBe("8 credits");
  });
  it("uses unrounded catalog values before formatting two-output totals", () => {
    const rows=buildPricingScenarioRows({...rule,base_credits:55,base_cost_usd:0.275,multipliers:{duration:{"5":1}}},null);
    expect(rows[0]).toMatchObject({label:"5s",perOutputUsd:"$0.28",twoOutputUsd:"$0.55",twoOutputCredits:"110 credits"});
  });
});

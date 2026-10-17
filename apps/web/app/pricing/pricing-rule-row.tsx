import { ChevronDown } from "lucide-react";

import { buildPricingScenarioRows, formatAdjustmentMap, formatPricingStatus } from "@/app/pricing/pricing-rule-view";
import type { MediaModelSummary } from "@/lib/types";
import { formatCreditsAmount, formatUsdAmount, toFiniteNumber } from "@/lib/utils";

export function PricingRuleRow({ rule, model, authoritative }: {
  rule: Record<string, unknown>;
  model: MediaModelSummary | null;
  authoritative: boolean;
}) {
  const adjustments = [
    ...formatAdjustmentMap("Multiplier", rule.multipliers, (value) => {
      const amount = toFiniteNumber(value);
      return amount == null ? "n/a" : `${amount}×`;
    }),
    ...formatAdjustmentMap("Credit add", rule.adders_credits, (value) => formatCreditsAmount(value, { suffix: " credits" }) ?? "n/a"),
    ...formatAdjustmentMap("USD add", rule.adders_cost_usd, (value) => formatUsdAmount(value) ?? "n/a"),
  ];
  const notes = Array.isArray(rule.notes) ? rule.notes.filter((note): note is string => typeof note === "string" && Boolean(note.trim())) : [];
  const scenarios = buildPricingScenarioRows(rule, model);
  const unit = String(rule.billing_unit || "request").replaceAll("_", " ");
  return <details className="admin-data-row admin-pricing-row">
    <summary className="admin-data-summary admin-pricing-columns">
      <div className="admin-pricing-identity">
        <div className="min-w-0"><h3 className="font-semibold">{model?.label || String(rule.model_key || "Unknown model")}</h3><span className="admin-data-meta">{[rule.provider, rule.interface_type].filter(Boolean).join(" · ") || "Model rate"}</span></div>
        <ChevronDown className="admin-pricing-mobile-chevron size-3.5" aria-hidden="true" />
      </div>
      <span className="admin-data-model admin-pricing-unit">{unit}</span>
      <span className="admin-pricing-amount">{formatCreditsAmount(rule.base_credits) ?? "n/a"}<span className="admin-pricing-mobile-label"> credits / {unit}</span></span>
      <span className="admin-pricing-amount">{formatUsdAmount(rule.base_cost_usd) ?? "n/a"}<span className="admin-pricing-mobile-label"> / {unit}</span></span>
      <span className="admin-pricing-row-action">View estimates<ChevronDown className="size-3.5" aria-hidden="true" /></span>
    </summary>
    <div className="admin-data-body">
      <div className="admin-pricing-expanded">
        <section aria-label="Example totals" className="min-w-0">
          <h4 className="admin-pricing-detail-title">Example totals</h4>
          {scenarios.length ? <table className="admin-pricing-scenarios">
            <thead><tr><th scope="col">Configuration</th><th scope="col">1 output</th><th scope="col">2 outputs</th></tr></thead>
            <tbody>{scenarios.map((scenario) => <tr key={scenario.key}>
              <th scope="row">{scenario.label}</th>
              <td><span>{scenario.perOutputUsd ?? "n/a"}</span><small>{scenario.perOutputCredits ?? "Credits unavailable"}</small></td>
              <td><span>{scenario.twoOutputUsd ?? "n/a"}</span><small>{scenario.twoOutputCredits ?? "Credits unavailable"}</small></td>
            </tr>)}</tbody>
          </table> : <p className="admin-pricing-explanation">No option scenarios are recorded for this model. The base rate above is per {unit}; Studio checks the exact request before generation.</p>}
          <p className="admin-pricing-footnote">Examples use the current catalog rules. Studio checks the exact options and output count before generation.</p>
        </section>
        <section aria-label="How this rate works" className="min-w-0">
          <h4 className="admin-pricing-detail-title">How this rate works</h4>
          <p className="admin-pricing-explanation">Pricing status: {formatPricingStatus(authoritative, String(rule.pricing_status ?? "unknown"))}</p>
          {adjustments.length ? <ul className="admin-pricing-adjustments">{adjustments.map((line) => <li key={line}>{line}</li>)}</ul> : <p className="admin-pricing-explanation mt-3">No option adjustments recorded for this rule.</p>}
          {notes.map((note, index) => <p key={index} className="admin-pricing-explanation mt-3">{note}</p>)}
          <details className="admin-pricing-source-details">
            <summary>Model and source details<ChevronDown className="size-3.5" aria-hidden="true" /></summary>
            <dl><div><dt>Model</dt><dd>{String(rule.model_key || "Unknown model")}</dd></div><div><dt>Billing unit</dt><dd>{unit}</dd></div><div><dt>Provider</dt><dd>{String(rule.provider || "Unknown")}</dd></div></dl>
            <p className="admin-pricing-footnote">These estimates are not confirmed provider charges.</p>
          </details>
        </section>
      </div>
    </div>
  </details>;
}

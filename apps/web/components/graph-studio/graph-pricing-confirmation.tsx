"use client";

import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";

import type { GraphEstimateResponse } from "./types";
import { formatGraphCredits, graphEstimateToolbarLabel } from "./utils/graph-pricing";

export function GraphPricingConfirmation({
  state,
  availableCredits,
  onAnswer,
}: {
  state: { estimate: GraphEstimateResponse; resolve: (confirmed: boolean) => void } | null;
  availableCredits: number | null;
  onAnswer: (confirmed: boolean, rememberChoice?: boolean) => void;
}) {
  const [rememberChoice, setRememberChoice] = useState(false);
  if (!state) return null;
  const total = state.estimate.pricing_summary?.total?.estimated_credits;
  const overCredit = availableCredits != null && total != null && total > availableCredits;
  const warningText = overCredit
    ? `This graph estimates ${formatGraphCredits(total)} credits, above the available ${formatGraphCredits(availableCredits)} credits.`
    : "This graph includes at least one node with unknown pricing.";
  return (
    <div className="graph-pricing-modal-backdrop" role="presentation">
      <div className="graph-pricing-modal" role="dialog" aria-modal="true" aria-label="Confirm graph pricing">
        <div className="graph-modal-header">
          <strong><AlertTriangle size={16} /> Confirm run cost</strong>
          <button
            type="button"
            aria-label="Cancel run"
            onClick={() => {
              setRememberChoice(false);
              onAnswer(false);
            }}
          ><X size={16} /></button>
        </div>
        <p>{warningText}</p>
        <div className="graph-pricing-modal-summary">{graphEstimateToolbarLabel(state.estimate)}</div>
        {state.estimate.warnings?.length ? (
          <ul className="graph-pricing-modal-warnings">
            {state.estimate.warnings.slice(0, 4).map((warning, index) => <li key={`${warning.code}-${index}`}>{warning.message}</li>)}
          </ul>
        ) : null}
        <label className="graph-pricing-modal-optout">
          <input
            type="checkbox"
            checked={rememberChoice}
            onChange={(event) => setRememberChoice(event.target.checked)}
          />
          <span>Do not show this again</span>
        </label>
        <div className="graph-rename-actions">
          <button
            type="button"
            onClick={() => {
              setRememberChoice(false);
              onAnswer(false);
            }}
          >Cancel</button>
          <button
            type="button"
            onClick={() => {
              onAnswer(true, rememberChoice);
              setRememberChoice(false);
            }}
          >Run anyway</button>
        </div>
      </div>
    </div>
  );
}

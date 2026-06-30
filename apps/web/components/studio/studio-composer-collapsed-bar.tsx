"use client";

import { ChevronUp, Coins, Sparkles } from "lucide-react";

import { StudioMetricPill } from "@/components/studio/studio-metric-pill";
import { cn } from "@/lib/utils";

type StudioComposerCollapsedBarProps = {
  currentModelLabel: string;
  formattedRemainingCredits: string | null;
  estimatedCredits: string | null;
  presetLabel: string | null;
  structuredPresetActive: boolean;
  hasReferenceInputs: boolean;
  onExpand: () => void;
};

export function StudioComposerCollapsedBar({
  currentModelLabel,
  formattedRemainingCredits,
  estimatedCredits,
  presetLabel,
  structuredPresetActive,
  hasReferenceInputs,
  onExpand,
}: StudioComposerCollapsedBarProps) {
  const modeLabel = structuredPresetActive && presetLabel ? presetLabel : "Prompt mode";

  return (
    <div className="studio-composer-collapsed-bar">
      <div className="studio-composer-collapsed-main">
        <span className="studio-composer-collapsed-icon">
          <Sparkles className="size-4" />
        </span>
        <div className="studio-composer-collapsed-copy">
          <div className="studio-composer-collapsed-eyebrow">Composer collapsed</div>
          <div className="studio-composer-collapsed-summary">
            <span className="truncate">{currentModelLabel}</span>
            <span className="studio-composer-collapsed-separator">·</span>
            <span className={cn("truncate", structuredPresetActive ? "studio-composer-collapsed-mode-accent" : "studio-composer-collapsed-mode")}>
              {modeLabel}
            </span>
            {hasReferenceInputs ? (
              <>
                <span className="studio-composer-collapsed-separator">·</span>
                <span className="studio-composer-collapsed-reference">references staged</span>
              </>
            ) : null}
          </div>
        </div>
      </div>
      <div className="studio-composer-collapsed-metrics">
        {formattedRemainingCredits ? <StudioMetricPill icon={Coins} value={formattedRemainingCredits} /> : null}
        {estimatedCredits ? <StudioMetricPill icon={Coins} value={estimatedCredits} accent="highlight" /> : null}
      </div>
      <button
        type="button"
        onClick={onExpand}
        className="studio-composer-collapsed-expand-button"
        aria-label="Expand Studio composer"
        title="Expand composer"
      >
        <ChevronUp className="size-[17px]" aria-hidden="true" />
      </button>
    </div>
  );
}

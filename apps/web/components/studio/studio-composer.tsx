"use client";

import { ChevronDown, CircleDollarSign, Coins, LoaderCircle, X } from "lucide-react";

import type { FloatingComposerStatus } from "@/lib/media-studio-contract";
import { StudioMetricPill } from "@/components/studio/studio-metric-pill";
import { cn } from "@/lib/utils";

type StudioComposerProps = {
  immersive: boolean;
  mobileComposerCollapsed: boolean;
  mobileComposerExpanded: boolean;
  currentModelLabel: string;
  formattedRemainingCredits: string | null;
  estimatedCredits: string | null;
  estimatedCostUsd: string | null;
  structuredPresetActive: boolean;
  presetLabel: string | null;
  externalTopContent?: React.ReactNode;
  sourceAttachmentStrip?: React.ReactNode;
  studioSettingsButton: React.ReactNode;
  floatingComposerStatus: FloatingComposerStatus | null;
  onToggleCollapsed: () => void;
  children: React.ReactNode;
};

export function StudioComposer({
  immersive,
  mobileComposerCollapsed,
  mobileComposerExpanded,
  currentModelLabel,
  formattedRemainingCredits,
  estimatedCredits,
  estimatedCostUsd,
  structuredPresetActive,
  presetLabel,
  externalTopContent,
  sourceAttachmentStrip,
  studioSettingsButton,
  floatingComposerStatus,
  onToggleCollapsed,
  children,
}: StudioComposerProps) {
  const hasSidebar = Boolean(sourceAttachmentStrip);
  return (
    <div
      className={cn(
        mobileComposerExpanded
          ? "fixed inset-0 z-[110] flex items-end overflow-y-auto bg-[rgba(6,8,7,0.84)] p-3 pb-6 [webkit-overflow-scrolling:touch] md:inset-auto md:block md:overflow-visible md:bg-transparent md:p-0"
          : immersive
            ? "fixed bottom-4 left-4 right-4 z-[70] md:bottom-6 md:left-6 md:right-6"
            : "absolute bottom-4 left-4 right-4 z-20 md:bottom-6 md:left-6 md:right-6",
      )}
    >
      {externalTopContent ? (
        <div className={cn("mx-auto mb-3 w-full", immersive ? "max-w-[1480px]" : "max-w-[1240px]")}>
          {externalTopContent}
        </div>
      ) : null}
      <div
        className={cn(
          "mx-auto w-full border border-white/10 bg-[rgba(21,24,23,0.9)] shadow-[0_28px_70px_rgba(0,0,0,0.42)] backdrop-blur-2xl",
          mobileComposerExpanded
            ? "mt-auto flex min-h-[calc(100dvh-1.5rem)] flex-col justify-end rounded-[30px] px-4 pb-6 pt-8 md:min-h-0 md:rounded-[34px] md:px-4 md:py-4"
            : "rounded-[34px] px-4 py-[17px]",
          immersive ? "max-w-[1480px]" : "max-w-[1240px]",
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-3 md:hidden">
          <div className="min-w-0 flex-1">
            <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/46">Prompt composer</div>
            <div className="mt-2 text-[0.95rem] font-semibold tracking-[-0.03em] text-white/92">{currentModelLabel}</div>
            {mobileComposerExpanded ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {formattedRemainingCredits ? <StudioMetricPill icon={Coins} value={formattedRemainingCredits} /> : null}
                {estimatedCredits ? <StudioMetricPill icon={Coins} value={estimatedCredits} accent="highlight" /> : null}
                {estimatedCostUsd ? <StudioMetricPill icon={CircleDollarSign} value={estimatedCostUsd} accent="highlight" /> : null}
              </div>
            ) : null}
            {hasSidebar ? (
              <div className="mt-4 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/46">
                {!structuredPresetActive ? "Source images" : presetLabel ?? "Preset mode"}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/76 transition hover:border-[rgba(216,141,67,0.28)] hover:text-white"
            aria-label={mobileComposerCollapsed ? "Expand prompt composer" : "Collapse prompt composer"}
          >
            <ChevronDown className={cn("size-4 transition-transform", mobileComposerCollapsed ? "" : "rotate-180")} />
          </button>
        </div>
        <div className={cn(mobileComposerCollapsed ? "hidden md:block" : "block")}>
          {hasSidebar ? <div className="mb-4 md:hidden">{sourceAttachmentStrip}</div> : null}
          <div className={cn("grid gap-4 lg:items-stretch", hasSidebar ? "lg:grid-cols-[220px_minmax(0,1fr)]" : "lg:grid-cols-[minmax(0,1fr)]")}>
            {hasSidebar ? (
              <div className="relative hidden md:flex md:items-end md:justify-between md:gap-3 lg:order-none lg:grid lg:min-h-full lg:content-start lg:justify-stretch lg:gap-3">
                {sourceAttachmentStrip}
                <div className="absolute bottom-0 left-0">{studioSettingsButton}</div>
              </div>
            ) : null}
            <div className="grid gap-3">
              <div className="relative pt-8">
                {!hasSidebar ? <div className="absolute right-0 top-0 hidden md:block">{studioSettingsButton}</div> : null}
                {floatingComposerStatus ? (
                  <div
                    className={cn(
                      "pointer-events-none absolute inset-x-3 top-0 z-20 transition duration-300 ease-out md:inset-x-4",
                      floatingComposerStatus.visible ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0",
                    )}
                  >
                    <div
                      className={cn(
                        "overflow-hidden rounded-[20px] border px-4 py-3 shadow-[0_22px_48px_rgba(0,0,0,0.34)] backdrop-blur-xl",
                        floatingComposerStatus.tone === "danger"
                          ? "border-[rgba(201,102,82,0.34)] bg-[rgba(62,19,16,0.88)] text-[#ffd3ca]"
                          : floatingComposerStatus.tone === "healthy"
                            ? "border-[rgba(176,235,44,0.28)] bg-[rgba(28,40,10,0.88)] text-[#e4ff97]"
                            : "border-[rgba(216,141,67,0.26)] bg-[rgba(22,18,12,0.9)] text-[#f6d8a8]",
                      )}
                    >
                      <div className="flex items-center gap-2 text-[0.78rem] font-medium">
                        {floatingComposerStatus.tone === "danger" ? (
                          <X className="size-4 shrink-0" />
                        ) : (
                          <LoaderCircle className="size-4 shrink-0 animate-spin" />
                        )}
                        <span>{floatingComposerStatus.text}</span>
                      </div>
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-black/20">
                        <div
                          className={cn(
                            "h-full w-1/2 animate-pulse rounded-full",
                            floatingComposerStatus.tone === "danger"
                              ? "bg-[#ff9f8a]"
                              : floatingComposerStatus.tone === "healthy"
                                ? "bg-[#d8ff2e]"
                                : "bg-[#e3a54b]",
                          )}
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
                {children}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

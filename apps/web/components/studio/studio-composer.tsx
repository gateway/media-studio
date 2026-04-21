"use client";

import { ChevronDown, Coins } from "lucide-react";

import type { FloatingComposerStatus } from "@/lib/media-studio-contract";
import { StudioMetricPill } from "@/components/studio/studio-metric-pill";
import { IconButton } from "@/components/ui/icon-button";
import { ToastBanner } from "@/components/ui/toast-banner";
import { overlayBackdropClassName, overlayPanelClassName } from "@/components/ui/surfaces";
import { cn } from "@/lib/utils";

type StudioComposerProps = {
  immersive: boolean;
  mobileComposerCollapsed: boolean;
  mobileComposerExpanded: boolean;
  currentModelLabel: string;
  formattedRemainingCredits: string | null;
  estimatedCredits: string | null;
  structuredPresetActive: boolean;
  presetLabel: string | null;
  externalTopContent?: React.ReactNode;
  mobileInputsContent?: React.ReactNode;
  sourceAttachmentStrip?: React.ReactNode;
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
  structuredPresetActive,
  presetLabel,
  externalTopContent,
  mobileInputsContent,
  sourceAttachmentStrip,
  floatingComposerStatus,
  onToggleCollapsed,
  children,
}: StudioComposerProps) {
  const hasSidebar = Boolean(sourceAttachmentStrip);
  return (
    <div
      className={cn(
        mobileComposerExpanded
          ? cn(overlayBackdropClassName, "z-[110] flex items-stretch bg-[rgba(6,8,7,0.84)] p-0 lg:inset-auto lg:block lg:overflow-visible lg:bg-transparent lg:p-0")
          : immersive
            ? "fixed bottom-4 left-4 right-4 z-[70] md:bottom-6 md:left-6 md:right-6"
            : "absolute bottom-4 left-4 right-4 z-20 md:bottom-6 md:left-6 md:right-6",
      )}
    >
      {externalTopContent ? (
        <div
          className={cn(
            "mb-3 w-full",
            mobileComposerExpanded ? "hidden lg:block lg:mx-auto" : "mx-auto",
            immersive ? "max-w-[1480px]" : "max-w-[1240px]",
          )}
        >
          {externalTopContent}
        </div>
      ) : null}
      {floatingComposerStatus ? (
        <div
          className={cn(
            "pointer-events-none mb-3 w-full transition duration-300 ease-out",
            mobileComposerExpanded ? "hidden lg:block lg:mx-auto" : "mx-auto",
            immersive ? "max-w-[1480px]" : "max-w-[1240px]",
            floatingComposerStatus.visible ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0",
          )}
        >
          <ToastBanner
            tone={floatingComposerStatus.tone}
            message={floatingComposerStatus.text}
            spinning={floatingComposerStatus.tone !== "danger"}
            progress={50}
            className="pointer-events-none mx-2 md:mx-4"
          />
        </div>
      ) : null}
        <div
          className={cn(
            overlayPanelClassName,
            "border-white/10 bg-[rgba(21,24,23,0.9)] backdrop-blur-2xl",
            mobileComposerExpanded
              ? cn(
                "w-screen max-w-none self-stretch flex h-[100dvh] min-h-[100dvh] flex-col overflow-hidden rounded-none border-x-0 border-b-0 px-4 pb-4 pt-6 shadow-[0_32px_80px_rgba(0,0,0,0.48)] lg:mx-auto lg:mt-auto lg:h-auto lg:min-h-0 lg:max-h-[calc(100dvh-1.5rem)] lg:w-full lg:rounded-[34px] lg:border-x lg:border-b lg:px-4 lg:py-4",
                immersive ? "lg:max-w-[1480px]" : "lg:max-w-[1240px]",
              )
            : cn("mx-auto w-full rounded-[34px] px-4 py-[17px]", immersive ? "max-w-[1480px]" : "max-w-[1240px]"),
        )}
      >
        <div className="sticky top-0 z-10 -mx-4 mb-4 flex items-start justify-between gap-3 border-b border-white/8 bg-[rgba(21,24,23,0.96)] px-4 pb-4 pt-1 backdrop-blur-xl lg:hidden">
          <div className="min-w-0 flex-1">
            <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/46">Prompt composer</div>
            <div className="mt-2 text-[0.95rem] font-semibold tracking-[-0.03em] text-white/92">{currentModelLabel}</div>
            {mobileComposerExpanded ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {formattedRemainingCredits ? <StudioMetricPill icon={Coins} value={formattedRemainingCredits} /> : null}
                {estimatedCredits ? <StudioMetricPill icon={Coins} value={estimatedCredits} accent="highlight" /> : null}
              </div>
            ) : null}
            {hasSidebar ? (
              <div className="mt-4 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/46">
                {!structuredPresetActive ? "Source images" : presetLabel ?? "Preset mode"}
              </div>
            ) : null}
          </div>
          <IconButton
            icon={ChevronDown}
            onClick={onToggleCollapsed}
            className="text-white/76 hover:text-white"
            iconClassName={cn("transition-transform", mobileComposerCollapsed ? "" : "rotate-180")}
            aria-label={mobileComposerCollapsed ? "Expand prompt composer" : "Collapse prompt composer"}
          />
        </div>
        <div
          className={cn(
            mobileComposerCollapsed ? "hidden lg:block" : "block",
            mobileComposerExpanded ? "min-h-0 flex-1 overflow-y-auto pr-0 lg:pr-1" : "",
          )}
        >
          <div className={cn("grid gap-4 lg:items-stretch", hasSidebar ? "lg:grid-cols-[220px_minmax(0,1fr)]" : "lg:grid-cols-[minmax(0,1fr)]")}>
            {hasSidebar ? (
              <div className="hidden lg:flex lg:items-end lg:justify-between lg:gap-3 lg:order-none lg:grid lg:min-h-full lg:content-start lg:justify-stretch">
                {sourceAttachmentStrip}
              </div>
            ) : null}
            <div className="grid gap-3">
              {mobileInputsContent ? <div className="lg:hidden">{mobileInputsContent}</div> : null}
              <div>
                {children}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

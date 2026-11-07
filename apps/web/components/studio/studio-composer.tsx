"use client";

import { ChevronDown } from "lucide-react";

import type { FloatingComposerStatus } from "@/lib/media-studio-contract";
import { StudioComposerCollapsedBar } from "@/components/studio/studio-composer-collapsed-bar";
import {
  StudioCreditBalance,
  StudioCreditMetrics,
} from "@/components/studio/studio-metric-pill";
import { IconButton } from "@/components/ui/icon-button";
import { ToastBanner } from "@/components/ui/toast-banner";
import { overlayPanelClassName } from "@/components/ui/surfaces";
import { cn } from "@/lib/utils";

type StudioComposerProps = {
  immersive: boolean;
  composerCollapsed: boolean;
  mobileComposerCollapsed: boolean;
  mobileComposerExpanded: boolean;
  currentModelLabel: string;
  remainingCredits?: number | null;
  formattedRemainingCredits: string | null;
  estimatedCredits: string | null;
  structuredPresetActive: boolean;
  presetLabel: string | null;
  modelPicker?: React.ReactNode;
  referenceInputs?: React.ReactNode;
  mobileInputsContent?: React.ReactNode;
  sourceAttachmentStrip?: React.ReactNode;
  floatingComposerStatus: FloatingComposerStatus | null;
  onToggleCollapsed: () => void;
  onToggleComposerCollapsed: () => void;
  children: React.ReactNode;
};

export function StudioComposer({
  immersive,
  composerCollapsed,
  mobileComposerCollapsed,
  mobileComposerExpanded,
  currentModelLabel,
  remainingCredits,
  formattedRemainingCredits,
  estimatedCredits,
  structuredPresetActive,
  presetLabel,
  modelPicker,
  referenceInputs,
  mobileInputsContent,
  sourceAttachmentStrip,
  floatingComposerStatus,
  onToggleCollapsed,
  onToggleComposerCollapsed,
  children,
}: StudioComposerProps) {
  const hasSidebar = Boolean(sourceAttachmentStrip);
  const hasReferenceInputs = [
    referenceInputs,
    sourceAttachmentStrip,
    mobileInputsContent,
  ].some(Boolean);
  const overlayExpanded = !composerCollapsed && mobileComposerExpanded;
  const dockedComposerClassName = immersive
    ? "fixed bottom-4 left-4 right-4 z-[70] md:bottom-6 md:left-6 md:right-6"
    : "absolute bottom-4 left-4 right-4 z-20 md:bottom-6 md:left-6 md:right-6";
  const mobileExpandedComposerClassName = cn(
    "fixed inset-0 z-[110] flex items-stretch overflow-y-auto overscroll-contain bg-[rgba(6,8,7,0.84)] p-0 backdrop-blur-[16px] [-webkit-overflow-scrolling:touch]",
    immersive
      ? "lg:inset-x-6 lg:bottom-6 lg:top-auto lg:z-[70] lg:block lg:overflow-visible lg:bg-transparent lg:p-0 lg:backdrop-blur-none"
      : "lg:absolute lg:inset-x-6 lg:bottom-6 lg:top-auto lg:z-20 lg:block lg:overflow-visible lg:bg-transparent lg:p-0 lg:backdrop-blur-none",
  );

  return (
    <div
      data-structured-preset-active={structuredPresetActive}
      data-mobile-overlay-expanded={overlayExpanded}
      className={cn(
        "studio-composer-rail",
        overlayExpanded
          ? mobileExpandedComposerClassName
          : dockedComposerClassName,
      )}
    >
      {floatingComposerStatus ? (
        <div
          className={cn(
            "pointer-events-none mb-3 w-full transition duration-300 ease-out",
            mobileComposerExpanded ? "hidden md:block md:mx-auto" : "mx-auto",
            immersive ? "max-w-[1480px]" : "max-w-[1240px]",
            floatingComposerStatus.visible
              ? "translate-y-0 opacity-100"
              : "-translate-y-2 opacity-0",
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
      {composerCollapsed ? (
        <StudioComposerCollapsedBar
          currentModelLabel={currentModelLabel}
          formattedRemainingCredits={
            immersive ? null : formattedRemainingCredits
          }
          estimatedCredits={estimatedCredits}
          presetLabel={presetLabel}
          structuredPresetActive={structuredPresetActive}
          hasReferenceInputs={hasReferenceInputs}
          onExpand={onToggleComposerCollapsed}
        />
      ) : (
        <div
          className={cn(
            overlayPanelClassName,
            "studio-composer-panel",
            mobileComposerExpanded
              ? cn(
                  "w-screen max-w-none self-stretch flex h-[100dvh] min-h-[100dvh] flex-col overflow-hidden rounded-none border-x-0 border-b-0 px-4 pb-4 pt-6 shadow-[0_32px_80px_rgba(0,0,0,0.48)] md:mx-auto md:mt-auto md:h-auto md:min-h-0 md:max-h-[calc(100dvh-1.5rem)] md:w-full md:rounded-[34px] md:border-x md:border-b md:px-4 md:py-4",
                  "lg:block lg:w-full lg:self-auto lg:overflow-visible lg:max-h-none lg:px-4 lg:py-[17px]",
                  immersive ? "md:max-w-[1480px]" : "md:max-w-[1240px]",
                )
              : cn(
                  "studio-composer-panel-docked",
                  immersive ? "max-w-[1480px]" : "max-w-[1240px]",
                ),
          )}
        >
          <button
            type="button"
            onClick={onToggleComposerCollapsed}
            className="studio-composer-collapse-button"
            aria-label="Collapse Studio composer"
            title="Collapse composer"
          >
            <ChevronDown className="size-[17px]" aria-hidden="true" />
          </button>
          <StudioComposerTop
            immersive={immersive}
            mobileComposerCollapsed={mobileComposerCollapsed}
            mobileComposerExpanded={mobileComposerExpanded}
            modelPicker={modelPicker}
            currentModelLabel={currentModelLabel}
            remainingCredits={remainingCredits}
            formattedRemainingCredits={formattedRemainingCredits}
            estimatedCredits={estimatedCredits}
            structuredPresetActive={structuredPresetActive}
            presetLabel={presetLabel}
            hasSidebar={hasSidebar}
            onToggleCollapsed={onToggleCollapsed}
          />
          <div
            className={cn(
              "studio-composer-body",
              mobileComposerCollapsed ? "hidden md:block" : "block",
              mobileComposerExpanded
                ? "min-h-0 flex-1 overflow-y-auto pr-0 md:pr-1 lg:flex-none lg:overflow-visible lg:pr-0"
                : "",
            )}
          >
            {referenceInputs}
            <div
              className={cn(
                "studio-composer-layout grid gap-4 md:items-stretch",
                hasSidebar
                  ? "md:grid-cols-[220px_minmax(0,1fr)]"
                  : "md:grid-cols-[minmax(0,1fr)]",
              )}
            >
              {hasSidebar ? (
                <div className="studio-composer-sidebar hidden md:flex md:items-end md:justify-between md:gap-3 md:order-none md:grid md:min-h-full md:content-start md:justify-stretch">
                  {sourceAttachmentStrip}
                </div>
              ) : null}
              <div className="studio-composer-main grid gap-3">
                {mobileInputsContent ? (
                  <div className="md:hidden">{mobileInputsContent}</div>
                ) : null}
                <div className="studio-composer-content">{children}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type StudioComposerTopProps = Pick<
  StudioComposerProps,
  | "immersive"
  | "mobileComposerCollapsed"
  | "mobileComposerExpanded"
  | "modelPicker"
  | "currentModelLabel"
  | "remainingCredits"
  | "formattedRemainingCredits"
  | "estimatedCredits"
  | "structuredPresetActive"
  | "presetLabel"
  | "onToggleCollapsed"
> & { hasSidebar: boolean };

function StudioComposerTop({
  immersive,
  mobileComposerCollapsed,
  mobileComposerExpanded,
  modelPicker,
  currentModelLabel,
  remainingCredits,
  formattedRemainingCredits,
  estimatedCredits,
  structuredPresetActive,
  presetLabel,
  hasSidebar,
  onToggleCollapsed,
}: StudioComposerTopProps) {
  const compact = immersive && mobileComposerExpanded;
  const inlinePicker = compact && Boolean(modelPicker);
  return (
    <div
      className={cn(
        "studio-composer-top",
        inlinePicker && "studio-composer-top-inline-picker",
      )}
      data-mobile-collapsed={mobileComposerCollapsed}
    >
      {modelPicker ? (
        <div className="studio-composer-leading-picker">{modelPicker}</div>
      ) : null}
      <div className="studio-composer-mobile-header">
        {inlinePicker ? null : (
          <StudioComposerMobileSummary
            currentModelLabel={currentModelLabel}
            formattedRemainingCredits={formattedRemainingCredits}
            estimatedCredits={estimatedCredits}
            showMetrics={!immersive && mobileComposerExpanded}
            structuredPresetActive={structuredPresetActive}
            presetLabel={presetLabel}
            hasSidebar={hasSidebar}
          />
        )}
        <StudioComposerMobileToggle
          collapsed={mobileComposerCollapsed}
          onClick={onToggleCollapsed}
        />
      </div>
      {compact ? (
        <StudioCreditBalance
          remaining={remainingCredits}
          className="studio-composer-mobile-balance"
        />
      ) : null}
    </div>
  );
}

function StudioComposerMobileToggle({
  collapsed,
  onClick,
}: {
  collapsed: boolean;
  onClick: () => void;
}) {
  return (
    <IconButton
      icon={ChevronDown}
      onClick={onClick}
      className="studio-composer-mobile-toggle-button"
      iconClassName={cn("transition-transform", !collapsed && "rotate-180")}
      aria-label={
        collapsed ? "Expand prompt composer" : "Collapse prompt composer"
      }
      aria-expanded={!collapsed}
    />
  );
}

function StudioComposerMobileSummary({
  currentModelLabel,
  formattedRemainingCredits,
  estimatedCredits,
  showMetrics,
  structuredPresetActive,
  presetLabel,
  hasSidebar,
}: Pick<
  StudioComposerTopProps,
  | "currentModelLabel"
  | "formattedRemainingCredits"
  | "estimatedCredits"
  | "structuredPresetActive"
  | "presetLabel"
  | "hasSidebar"
> & { showMetrics: boolean }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="studio-composer-mobile-eyebrow">Prompt composer</div>
      <div className="studio-composer-mobile-model-label">
        {currentModelLabel}
      </div>
      {showMetrics ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <StudioCreditMetrics
            remaining={formattedRemainingCredits}
            estimated={estimatedCredits}
          />
        </div>
      ) : null}
      {hasSidebar ? (
        <div className="mt-4 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/46">
          {!structuredPresetActive
            ? "Source images"
            : (presetLabel ?? "Preset mode")}
        </div>
      ) : null}
    </div>
  );
}

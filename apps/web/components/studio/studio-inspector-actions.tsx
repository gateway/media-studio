"use client";

import { Download, ImagePlus, Trash2, Wand2 } from "lucide-react";

import { cn } from "@/lib/utils";

function StudioActionIconButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  tone = "secondary",
  className,
  testId,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "primary" | "secondary" | "danger";
  className?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-10 w-10 items-center justify-center rounded-[16px] border transition disabled:cursor-not-allowed disabled:opacity-60",
        tone === "primary"
          ? "border-[rgba(216,255,46,0.24)] bg-[linear-gradient(135deg,#d8ff2e,#b5f414)] text-[#172200] shadow-[0_16px_28px_rgba(176,235,44,0.18)] hover:-translate-y-0.5"
          : tone === "danger"
            ? "border-[rgba(201,102,82,0.22)] bg-[rgba(201,102,82,0.08)] text-[#ffb5a6] hover:border-[rgba(201,102,82,0.34)] hover:bg-[rgba(201,102,82,0.12)]"
            : "border-white/10 bg-white/[0.06] text-white/78 hover:border-[rgba(216,141,67,0.32)] hover:bg-[rgba(216,141,67,0.14)] hover:text-white",
        className,
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

type StudioInspectorActionsProps = {
  canDownload: boolean;
  downloadActionLabel: string;
  showImageActions: boolean;
  onDownload: () => void;
  onDismiss: () => void;
  onAnimate: () => void;
  onUseImage: () => void;
};

export function StudioInspectorActions({
  canDownload,
  downloadActionLabel,
  showImageActions,
  onDownload,
  onDismiss,
  onAnimate,
  onUseImage,
}: StudioInspectorActionsProps) {
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-4">
        <div className="pointer-events-auto flex items-center gap-2">
          {canDownload ? (
            <StudioActionIconButton
              icon={Download}
              label={downloadActionLabel}
              onClick={onDownload}
              testId="studio-inspector-download"
              className="h-11 w-11 rounded-full border-white/12 bg-[rgba(8,10,9,0.72)] text-white/82 shadow-[0_18px_40px_rgba(0,0,0,0.32)] backdrop-blur-xl"
            />
          ) : null}
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <StudioActionIconButton
            icon={Trash2}
            label="Remove"
            onClick={onDismiss}
            tone="danger"
            testId="studio-inspector-remove"
            className="h-11 w-11 rounded-full border-[rgba(201,102,82,0.28)] bg-[rgba(40,16,14,0.76)] text-[#ffb5a6] shadow-[0_18px_40px_rgba(0,0,0,0.32)] backdrop-blur-xl"
          />
        </div>
      </div>

      <div className="grid gap-3 rounded-[24px] border border-white/10 bg-[rgba(16,19,18,0.98)] p-3 shadow-[0_18px_38px_rgba(0,0,0,0.22)] lg:hidden">
        {showImageActions ? (
          <>
            <button
              type="button"
              data-testid="studio-inspector-animate"
              onClick={onAnimate}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[18px] bg-[linear-gradient(135deg,#d8ff2e,#b5f414)] px-4 text-[0.82rem] font-semibold text-[#172200] shadow-[0_18px_38px_rgba(176,235,44,0.2)] transition hover:-translate-y-0.5"
            >
              <Wand2 className="size-4" />
              Animate
            </button>
            <button
              type="button"
              data-testid="studio-inspector-use-image"
              onClick={onUseImage}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[18px] border border-white/10 bg-white/[0.06] px-4 text-[0.82rem] font-semibold text-white/84 transition hover:border-[rgba(216,141,67,0.3)] hover:bg-[rgba(216,141,67,0.12)] hover:text-white"
            >
              <ImagePlus className="size-4" />
              Use image
            </button>
          </>
        ) : null}
      </div>

      <div className="hidden gap-3 lg:grid">
        {showImageActions ? (
          <>
            <button
              type="button"
              data-testid="studio-inspector-animate-desktop"
              onClick={onAnimate}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[18px] bg-[linear-gradient(135deg,#d8ff2e,#b5f414)] px-4 text-[0.82rem] font-semibold text-[#172200] shadow-[0_18px_38px_rgba(176,235,44,0.2)] transition hover:-translate-y-0.5"
            >
              <Wand2 className="size-4" />
              Animate
            </button>
            <button
              type="button"
              data-testid="studio-inspector-use-image-desktop"
              onClick={onUseImage}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[18px] border border-white/10 bg-white/[0.06] px-4 text-[0.82rem] font-semibold text-white/84 transition hover:border-[rgba(216,141,67,0.3)] hover:bg-[rgba(216,141,67,0.12)] hover:text-white"
            >
              <ImagePlus className="size-4" />
              Use image
            </button>
          </>
        ) : null}
      </div>
    </>
  );
}

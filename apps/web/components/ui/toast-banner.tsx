import type { HTMLAttributes } from "react";
import { AlertTriangle, CheckCircle2, LoaderCircle } from "lucide-react";

import { cn } from "@/lib/utils";

export type FeedbackIntent = "healthy" | "warning" | "danger" | "working";

export function feedbackToneClassName(tone: FeedbackIntent, appearance: "admin" | "studio") {
  if (tone === "healthy") {
    return "border-[var(--feedback-healthy-border)] bg-[var(--feedback-healthy-surface)] text-[var(--feedback-healthy-text)]";
  }
  if (tone === "danger") {
    return "border-[var(--feedback-danger-border)] bg-[var(--feedback-danger-surface)] text-[var(--feedback-danger-text)]";
  }
  if (tone === "working") {
    return "border-[var(--feedback-working-border)] bg-[var(--feedback-working-surface)] text-[var(--feedback-working-text)]";
  }
  return "border-[var(--feedback-warning-border)] bg-[var(--feedback-warning-surface)] text-[var(--feedback-warning-text)]";
}

function defaultTitle(tone: FeedbackIntent) {
  if (tone === "healthy") return "Done";
  if (tone === "danger") return "Heads up";
  if (tone === "working") return "Working";
  return "Notice";
}

function ToneIcon({ tone, spinning }: { tone: FeedbackIntent; spinning?: boolean }) {
  if (tone === "healthy") {
    return <CheckCircle2 className="size-4.5 shrink-0" />;
  }
  if (tone === "danger" || tone === "warning") {
    return <AlertTriangle className="size-4.5 shrink-0" />;
  }
  return <LoaderCircle className={cn("size-4.5 shrink-0", spinning === false ? "" : "animate-spin")} />;
}

export function ToastBanner({
  tone,
  title,
  message,
  appearance = "studio",
  spinning,
  progress,
  className,
  ...props
}: {
  tone: FeedbackIntent;
  title?: string | null;
  message: string;
  appearance?: "admin" | "studio";
  spinning?: boolean;
  progress?: number | null;
  className?: string;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cn(
        appearance === "admin"
          ? "rounded-[20px] border px-4 py-3 shadow-[var(--shadow-floating-notice)] backdrop-blur-xl"
          : "rounded-[20px] border px-4 py-3 shadow-[var(--shadow-floating-notice)] backdrop-blur-xl",
        feedbackToneClassName(tone, appearance),
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <ToneIcon tone={tone} spinning={spinning} />
        <div className="min-w-0 flex-1">
          {title ? (
            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] opacity-75">
              {title}
            </div>
          ) : null}
          <div className={cn(title ? "mt-1" : "", "text-sm font-medium tracking-[-0.02em]")}>
            {title ? message : defaultTitle(tone)}
          </div>
          {title ? null : <div className="mt-1 text-sm leading-6">{message}</div>}
          {typeof progress === "number" ? (
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/10">
              <div
                className="h-full rounded-full bg-current transition-[width] duration-300"
                style={{ width: `${Math.max(8, Math.min(100, progress))}%` }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

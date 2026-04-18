"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

type ControlledOpenProps = {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

function useResolvedOpenState({ defaultOpen = false, open, onOpenChange }: ControlledOpenProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const resolvedOpen = open ?? uncontrolledOpen;

  function updateOpenState(nextOpen: boolean) {
    if (open === undefined) {
      setUncontrolledOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  }

  return {
    resolvedOpen,
    updateOpenState,
  };
}

export function SectionDisclosure({
  title,
  description,
  summary,
  detail,
  statusSlot,
  quickAction,
  children,
  defaultOpen = false,
  open,
  onOpenChange,
  className,
  bodyClassName,
}: {
  title: string;
  description: string;
  summary: string;
  detail?: string | null;
  statusSlot?: ReactNode;
  quickAction?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
} & ControlledOpenProps) {
  const { resolvedOpen, updateOpenState } = useResolvedOpenState({ defaultOpen, open, onOpenChange });

  return (
    <details
      open={resolvedOpen}
      onToggle={(event) => updateOpenState(event.currentTarget.open)}
      className={cn(
        "admin-disclosure group w-full min-w-0 px-5 py-5",
        className,
      )}
    >
      <summary className="flex list-none cursor-pointer items-start justify-between gap-4">
        <div className="space-y-2">
          <h2 className="text-[1.2rem] font-semibold tracking-[-0.03em] text-[var(--foreground)]">{title}</h2>
          <p className="max-w-3xl text-[0.94rem] leading-6 text-[var(--muted-strong)]">{description}</p>
          <div className="pt-1">
            <div className="text-base font-semibold text-[var(--foreground)]">{summary}</div>
            {detail ? <div className="mt-1 text-sm leading-6 text-[var(--muted-strong)]">{detail}</div> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {quickAction}
          {statusSlot}
          <ChevronDown className="size-4 text-[var(--muted-strong)] transition-transform group-open:rotate-180" />
        </div>
      </summary>
      <div className={cn("mt-5 border-t border-[var(--surface-border-soft)] pt-5", bodyClassName)}>{children}</div>
    </details>
  );
}

export function CollapsibleSubsection({
  title,
  description,
  badge,
  tone = "default",
  defaultOpen = false,
  open,
  onOpenChange,
  className,
  summaryClassName,
  titleClassName,
  descriptionClassName,
  bodyClassName,
  iconClassName,
  children,
}: {
  title: string;
  description: string;
  badge?: ReactNode;
  children: ReactNode;
  tone?: "default" | "media";
  className?: string;
  summaryClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  bodyClassName?: string;
  iconClassName?: string;
} & ControlledOpenProps) {
  const { resolvedOpen, updateOpenState } = useResolvedOpenState({ defaultOpen, open, onOpenChange });

  return (
    <details
      open={resolvedOpen}
      onToggle={(event) => updateOpenState(event.currentTarget.open)}
      className={cn(
        "admin-subsection group w-full min-w-0 px-4 py-4",
        tone === "media"
          ? ""
          : "",
        className,
      )}
    >
      <summary className={cn("flex list-none cursor-pointer items-start justify-between gap-3", summaryClassName)}>
        <div>
          <h3
            className={cn(
              "text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted-strong)]",
              titleClassName,
            )}
          >
            {title}
          </h3>
          <p className={cn("mt-2 text-sm leading-6 text-[var(--muted-strong)]", descriptionClassName)}>
            {description}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {badge}
          <ChevronDown
            className={cn(
              "size-4 text-[var(--muted-strong)] transition-transform group-open:rotate-180",
              iconClassName,
            )}
          />
        </div>
      </summary>
      <div className={cn("mt-4", bodyClassName)}>{children}</div>
    </details>
  );
}

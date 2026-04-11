"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type PillSelectChoice = {
  value: string;
  label: string;
};

export function pillSelectButtonClassName(appearance: "admin" | "studio") {
  return appearance === "admin"
    ? "flex h-12 w-full items-center gap-3 rounded-[18px] border border-[var(--ui-action-subtle-border)] bg-[var(--ui-action-subtle-surface)] pl-3.5 pr-3.5 text-left text-[0.82rem] font-semibold text-[var(--ui-action-subtle-text-hover)] transition hover:border-[var(--ui-action-subtle-border-hover)]"
    : "flex h-10 w-full items-center gap-2.5 rounded-[16px] border border-[var(--ms-action-subtle-border)] bg-[var(--ms-action-subtle-surface)] px-3 text-left text-[0.74rem] font-semibold tracking-[0.01em] text-[var(--ms-action-subtle-text-hover)] transition hover:border-[var(--ms-action-warning-border)]";
}

function pillSelectMenuClassName(appearance: "admin" | "studio") {
  return appearance === "admin"
    ? "scrollbar-none absolute left-0 z-30 w-full overflow-auto rounded-[20px] border border-[var(--ui-action-subtle-border)] bg-[rgba(17,20,19,0.98)] p-2 shadow-[var(--ui-shadow-overlay)] backdrop-blur-xl"
    : "scrollbar-none absolute left-0 z-30 min-w-full w-max max-w-[28rem] overflow-auto rounded-[18px] border border-[var(--ms-action-subtle-border)] bg-[rgba(17,20,19,0.98)] p-2 shadow-[var(--ms-shadow-overlay)] backdrop-blur-xl";
}

type PillSelectProps = {
  pickerId: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  widthClassName?: string;
  appearance?: "admin" | "studio";
  icon?: LucideIcon;
  choiceIcon?: (choice: PillSelectChoice) => LucideIcon | null | undefined;
  label: string;
  choices: PillSelectChoice[];
  selectedValue?: string;
  menuTitle?: string;
  onSelect: (value: string) => void;
  className?: string;
};

export function PillSelect({
  pickerId,
  open,
  onToggle,
  onClose,
  widthClassName,
  appearance = "studio",
  icon: Icon,
  choiceIcon,
  label,
  choices,
  selectedValue,
  menuTitle,
  onSelect,
  className,
}: PillSelectProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [menuPlacement, setMenuPlacement] = useState<"up" | "down">("down");
  const [menuMaxHeight, setMenuMaxHeight] = useState(appearance === "studio" ? 280 : 320);
  const normalizedTitle = (menuTitle ?? pickerId.replaceAll("-", " ").replaceAll("_", " "))
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  const selectedChoice =
    choices.find((choice) => choice.value === selectedValue) ??
    choices.find((choice) => choice.label === label) ??
    null;
  const SelectedIcon = selectedChoice ? choiceIcon?.(selectedChoice) ?? Icon : Icon;
  const fallbackChoices =
    appearance === "studio" && selectedChoice
      ? choices.filter((choice) => choice.value !== selectedChoice.value)
      : choices;

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    function updateMenuPlacement() {
      const container = containerRef.current;
      if (!container) {
        return;
      }
      const rect = container.getBoundingClientRect();
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const gutter = 20;
      const gap = 12;
      const spaceBelow = Math.max(0, viewportHeight - rect.bottom - gutter - gap);
      const spaceAbove = Math.max(0, rect.top - gutter - gap);
      const preferUp = spaceAbove >= 220 || spaceAbove >= spaceBelow;
      const nextPlacement = preferUp ? "up" : "down";
      const availableSpace = nextPlacement === "down" ? spaceBelow : spaceAbove;
      setMenuPlacement(nextPlacement);
      setMenuMaxHeight(Math.max(180, Math.min(availableSpace, appearance === "studio" ? 320 : 360)));
    }

    updateMenuPlacement();
    window.addEventListener("resize", updateMenuPlacement);
    window.addEventListener("scroll", updateMenuPlacement, true);
    window.visualViewport?.addEventListener("resize", updateMenuPlacement);
    window.visualViewport?.addEventListener("scroll", updateMenuPlacement);

    return () => {
      window.removeEventListener("resize", updateMenuPlacement);
      window.removeEventListener("scroll", updateMenuPlacement, true);
      window.visualViewport?.removeEventListener("resize", updateMenuPlacement);
      window.visualViewport?.removeEventListener("scroll", updateMenuPlacement);
    };
  }, [appearance, open]);

  return (
    <div
      ref={containerRef}
      data-studio-picker
      data-picker-id={pickerId}
      className={cn("relative", widthClassName, open ? "z-40" : "z-10", className)}
    >
      <button
        type="button"
        data-testid={`studio-picker-${pickerId}`}
        onClick={onToggle}
        className={pillSelectButtonClassName(appearance)}
      >
        {SelectedIcon ? <SelectedIcon className={cn("shrink-0", appearance === "studio" ? "size-4 text-[var(--ms-accent)]" : "size-4 text-[var(--ui-accent-strong)]")} /> : null}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronDown className={cn("size-4 shrink-0 text-white/42 transition", open ? "rotate-180" : "", appearance === "studio" ? "size-3.5" : "")} />
      </button>

      {open ? (
        <div
          style={{ maxHeight: `${menuMaxHeight}px` }}
          className={cn(
            pillSelectMenuClassName(appearance),
            menuPlacement === "down" ? "top-[calc(100%+0.65rem)]" : "bottom-[calc(100%+0.65rem)]",
          )}
        >
          <div className="grid gap-2">
            {appearance === "studio" ? (
              <div className="px-2 pt-1 text-[0.66rem] font-semibold uppercase tracking-[0.24em] text-white/38">
                {normalizedTitle}
              </div>
            ) : null}

            {appearance === "studio" && selectedChoice ? (
              <button
                type="button"
                data-testid={`studio-picker-option-${pickerId}-${selectedChoice.value || "empty"}`}
                onClick={() => {
                  onSelect(selectedChoice.value);
                  onClose();
                }}
                className="flex items-center gap-2.5 rounded-[14px] border border-[var(--ms-action-subtle-border)] bg-white/[0.08] px-2.5 py-2.5 text-left transition hover:border-[var(--ms-action-warning-border)] hover:bg-white/[0.1]"
              >
                {SelectedIcon ? (
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] border border-[var(--ms-action-subtle-border)] bg-white/[0.06] text-white/92">
                    <SelectedIcon className="size-4 text-[var(--ms-accent)]" />
                  </span>
                ) : null}
                <span className="min-w-0 flex-1 truncate text-[0.9rem] font-medium text-white">{selectedChoice.label}</span>
                <Check className="size-4 shrink-0 text-white/56" />
              </button>
            ) : null}

            <div className="grid gap-1">
              {fallbackChoices.map((choice) => {
                const ChoiceIcon = choiceIcon?.(choice) ?? Icon;
                return (
                  <button
                    key={`${pickerId}:${choice.value}`}
                    type="button"
                    data-testid={`studio-picker-option-${pickerId}-${choice.value || "empty"}`}
                    onClick={() => {
                      onSelect(choice.value);
                      onClose();
                    }}
                    className={cn(
                      appearance === "studio"
                        ? "flex items-center gap-2 rounded-[12px] px-2.5 py-2.5 text-left text-[0.8rem] font-medium text-white/82 transition hover:bg-white/[0.08] hover:text-white"
                        : "rounded-[14px] px-3 py-2.5 text-left text-[0.82rem] font-medium text-white/84 transition hover:bg-white/[0.08] hover:text-white",
                    )}
                  >
                    {appearance === "studio" && ChoiceIcon ? (
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] border border-[var(--ms-action-subtle-border)] bg-white/[0.04] text-white/88">
                        <ChoiceIcon className="size-3.5 text-white/72" />
                      </span>
                    ) : null}
                    <span className="min-w-0 flex-1 truncate">{choice.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

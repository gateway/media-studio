"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, type LucideIcon } from "lucide-react";

import { pickerMenuHeightCap } from "@/lib/media-studio-helpers";
import { cn } from "@/lib/utils";

export type PillSelectChoice = {
  value: string;
  label: string;
};

export function pillSelectButtonClassName(appearance: "admin" | "studio") {
  return appearance === "admin"
    ? "admin-form-control admin-select-trigger"
    : "flex h-[41px] w-full items-center gap-2.5 rounded-[calc(var(--radius-control)-2px)] border border-[var(--action-subtle-border)] bg-[var(--action-subtle-surface)] px-3 text-left text-[0.74rem] font-semibold tracking-[0.01em] text-[var(--action-subtle-text-hover)] transition hover:border-[var(--action-warning-border)]";
}

function pillSelectMenuClassName(appearance: "admin" | "studio") {
  return appearance === "admin"
    ? "admin-select-menu scrollbar-none"
    : "scrollbar-none absolute left-0 z-30 min-w-full w-max max-w-[28rem] overflow-auto rounded-[var(--radius-control)] border border-[var(--action-subtle-border)] bg-[var(--surface-card-bg)] p-2 shadow-[var(--shadow-overlay)] backdrop-blur-xl";
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
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPlacement, setMenuPlacement] = useState<"up" | "down">("down");
  const [menuMaxHeight, setMenuMaxHeight] = useState(appearance === "studio" ? 280 : 320);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
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

  const updateScrollIndicators = useCallback(() => {
    const menu = menuRef.current;
    if (!menu) {
      setCanScrollUp(false);
      setCanScrollDown(false);
      return;
    }
    const nextCanScrollUp = menu.scrollTop > 4;
    const nextCanScrollDown = menu.scrollTop + menu.clientHeight < menu.scrollHeight - 4;
    setCanScrollUp(nextCanScrollUp);
    setCanScrollDown(nextCanScrollDown);
  }, []);

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
      const desiredCap = pickerMenuHeightCap(pickerId);
      setMenuPlacement(nextPlacement);
      setMenuMaxHeight(Math.max(220, Math.min(availableSpace, desiredCap)));
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
  }, [open, pickerId]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      updateScrollIndicators();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [open, updateScrollIndicators, fallbackChoices.length, selectedChoice?.value]);

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
        {SelectedIcon ? <SelectedIcon className={cn("shrink-0", "size-4 text-[var(--accent-strong)]")} /> : null}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronDown className={cn("size-4 shrink-0 text-white/42 transition", open ? "rotate-180" : "", appearance === "studio" ? "size-3.5" : "")} />
      </button>

      {open ? (
        <div
          ref={menuRef}
          style={{ maxHeight: `${menuMaxHeight}px` }}
          onScroll={updateScrollIndicators}
          className={cn(
            pillSelectMenuClassName(appearance),
            menuPlacement === "down" ? "top-[calc(100%+0.65rem)]" : "bottom-[calc(100%+0.65rem)]",
          )}
        >
          {canScrollUp ? (
            <div className="pointer-events-none sticky top-0 z-10 -mx-2 -mt-2 mb-2 flex justify-center bg-gradient-to-b from-[rgba(17,20,19,0.98)] via-[rgba(17,20,19,0.92)] to-transparent px-2 pt-2">
              <span className="inline-flex h-6 items-center gap-1 rounded-full border border-white/10 bg-[rgba(10,12,11,0.68)] px-2 text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-white/54 backdrop-blur-xl">
                <ChevronUp className="size-3" />
                More
              </span>
            </div>
          ) : null}
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
                className="flex items-center gap-2.5 rounded-[14px] border border-[var(--action-subtle-border)] bg-white/[0.08] px-2.5 py-2.5 text-left transition hover:border-[var(--action-warning-border)] hover:bg-white/[0.1]"
              >
                {SelectedIcon ? (
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] border border-[var(--action-subtle-border)] bg-white/[0.06] text-white/92">
                    <SelectedIcon className="size-4 text-[var(--accent-strong)]" />
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
                        : "admin-select-option",
                    )}
                  >
                    {appearance === "studio" && ChoiceIcon ? (
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] border border-[var(--action-subtle-border)] bg-white/[0.04] text-white/88">
                        <ChoiceIcon className="size-3.5 text-white/72" />
                      </span>
                    ) : null}
                    <span className="min-w-0 flex-1 truncate">{choice.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {canScrollDown ? (
            <div className="pointer-events-none sticky bottom-0 z-10 -mx-2 -mb-2 mt-2 flex justify-center bg-gradient-to-t from-[rgba(17,20,19,0.98)] via-[rgba(17,20,19,0.92)] to-transparent px-2 pb-2">
              <span className="inline-flex h-6 items-center gap-1 rounded-full border border-white/10 bg-[rgba(10,12,11,0.68)] px-2 text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-white/54 backdrop-blur-xl">
                More
                <ChevronDown className="size-3" />
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

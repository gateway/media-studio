import type { ButtonHTMLAttributes, ComponentType } from "react";

import { cn } from "@/lib/utils";

export type IconButtonAppearance = "studio" | "admin";
export type IconButtonTone = "primary" | "subtle" | "danger" | "favorite";
export type IconButtonShape = "circle" | "soft";

export function iconButtonClassName({
  appearance = "studio",
  tone = "subtle",
  shape = "circle",
  className,
}: {
  appearance?: IconButtonAppearance;
  tone?: IconButtonTone;
  shape?: IconButtonShape;
  className?: string;
}) {
  const baseClassName = cn(
    "inline-flex items-center justify-center border transition disabled:cursor-not-allowed disabled:opacity-60",
    shape === "circle" ? "rounded-full" : "rounded-[calc(var(--radius-control)-2px)]",
    appearance === "admin"
      ? "h-10 w-10 backdrop-blur-xl"
      : "h-10 w-10 backdrop-blur-xl",
  );

  const toneClassName =
    tone === "primary"
      ? appearance === "admin"
        ? "border-[var(--action-primary-border)] bg-[linear-gradient(135deg,var(--action-primary-fill),var(--action-primary-fill-strong))] text-[var(--action-primary-text)] shadow-[var(--shadow-button)] hover:brightness-[1.03]"
        : "border-[var(--action-primary-border)] bg-[linear-gradient(135deg,var(--action-primary-fill),var(--action-primary-fill-strong))] text-[var(--action-primary-text)] shadow-[var(--shadow-button)] hover:-translate-y-0.5"
      : tone === "danger"
        ? appearance === "admin"
          ? "border-[var(--action-danger-border)] bg-[var(--action-danger-surface)] text-[var(--action-danger-text)] hover:border-[var(--action-danger-border-hover)] hover:bg-[var(--action-danger-surface-hover)]"
          : "border-[var(--action-danger-border)] bg-[var(--action-danger-surface)] text-[var(--action-danger-text)] hover:border-[var(--action-danger-border-hover)] hover:bg-[var(--action-danger-surface-hover)] hover:text-white"
        : tone === "favorite"
          ? "border-[rgba(255,126,166,0.38)] bg-[rgba(255,126,166,0.16)] text-[#ff8db3]"
          : appearance === "admin"
            ? "border-[var(--action-subtle-border)] bg-[var(--action-subtle-surface)] text-[var(--action-subtle-text)] hover:border-[var(--action-subtle-border-hover)] hover:bg-[var(--action-subtle-surface-hover)] hover:text-[var(--action-subtle-text-hover)]"
            : "border-[var(--action-subtle-border)] bg-[var(--action-subtle-surface)] text-[var(--action-subtle-text)] hover:border-[var(--action-subtle-border-hover)] hover:bg-[var(--action-subtle-surface-hover)] hover:text-[var(--action-subtle-text-hover)]";

  return cn(baseClassName, toneClassName, className);
}

export function IconButton({
  icon: Icon,
  appearance = "studio",
  tone = "subtle",
  shape = "circle",
  className,
  iconClassName,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ComponentType<{ className?: string }>;
  appearance?: IconButtonAppearance;
  tone?: IconButtonTone;
  shape?: IconButtonShape;
  iconClassName?: string;
}) {
  return (
    <button {...props} type={props.type ?? "button"} className={iconButtonClassName({ appearance, tone, shape, className })}>
      <Icon className={cn("size-4", iconClassName)} />
    </button>
  );
}

import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export type ButtonAppearance = "admin" | "studio";
export type ButtonVariant = "primary" | "subtle" | "danger" | "ghost";
export type ButtonSize = "compact" | "default";

const adminVariantClassNames: Record<ButtonVariant, string> = {
  primary: "admin-button admin-button-primary",
  subtle: "admin-button admin-button-subtle",
  danger: "admin-button admin-button-danger",
  ghost: "admin-button admin-button-ghost",
};

const studioVariantClassNames: Record<ButtonVariant, string> = {
  primary:
    "inline-flex items-center justify-center whitespace-nowrap rounded-[var(--radius-control)] bg-[linear-gradient(135deg,var(--action-primary-fill),var(--action-primary-fill-strong))] px-4 py-3 text-[0.82rem] font-semibold text-[var(--action-primary-text)] shadow-[var(--shadow-button)] transition hover:-translate-y-0.5 hover:brightness-[1.03] disabled:cursor-not-allowed disabled:opacity-60",
  subtle:
    "inline-flex items-center justify-center whitespace-nowrap rounded-[var(--radius-control)] border border-[var(--action-subtle-border)] bg-[var(--action-subtle-surface)] px-4 py-3 text-[0.82rem] font-semibold text-[var(--action-subtle-text)] transition hover:border-[var(--action-subtle-border-hover)] hover:bg-[var(--action-subtle-surface-hover)] hover:text-[var(--action-subtle-text-hover)] disabled:cursor-not-allowed disabled:opacity-60",
  danger:
    "inline-flex items-center justify-center whitespace-nowrap rounded-[var(--radius-control)] border border-[var(--action-danger-border)] bg-[var(--action-danger-surface)] px-4 py-3 text-[0.82rem] font-semibold text-[var(--action-danger-text)] transition hover:border-[var(--action-danger-border-hover)] hover:bg-[var(--action-danger-surface-hover)] hover:text-white disabled:cursor-not-allowed disabled:opacity-60",
  ghost:
    "inline-flex items-center justify-center whitespace-nowrap rounded-[var(--radius-control)] border border-transparent bg-transparent px-4 py-3 text-[0.82rem] font-semibold text-[var(--action-subtle-text)] transition hover:border-[var(--action-subtle-border)] hover:bg-[var(--action-subtle-surface)] hover:text-[var(--action-subtle-text-hover)] disabled:cursor-not-allowed disabled:opacity-60",
};

export function buttonClassName({
  appearance = "studio",
  variant = "primary",
  size = "default",
  className,
}: {
  appearance?: ButtonAppearance;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  const baseClassName =
    appearance === "admin" ? adminVariantClassNames[variant] : studioVariantClassNames[variant];

  const compactClassName =
    size === "compact"
      ? appearance === "admin"
        ? "admin-button-compact"
        : "h-9 px-3 text-[0.72rem] uppercase tracking-[0.12em]"
      : "";

  return cn(baseClassName, compactClassName, className);
}

export function Button({
  appearance = "studio",
  variant = "primary",
  size = "default",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  appearance?: ButtonAppearance;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return <button {...props} type={type} className={buttonClassName({ appearance, variant, size, className })} />;
}

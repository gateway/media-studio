import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export type ButtonAppearance = "admin" | "studio";
export type ButtonVariant = "primary" | "subtle" | "danger" | "ghost";
export type ButtonSize = "compact" | "default";

const adminVariantClassNames: Record<ButtonVariant, string> = {
  primary:
    "admin-button inline-flex items-center justify-center whitespace-nowrap bg-[var(--action-primary-fill)] px-[1.125rem] py-[0.61rem] text-[0.75rem] leading-none font-semibold text-[var(--action-primary-text)] no-underline transition hover:bg-[var(--action-primary-fill-strong)] hover:text-[var(--action-primary-text)] visited:text-[var(--action-primary-text)] disabled:cursor-not-allowed disabled:opacity-60",
  subtle:
    "admin-button inline-flex items-center justify-center whitespace-nowrap border border-[var(--action-subtle-border)] bg-[var(--action-subtle-surface)] px-[0.675rem] py-[0.41rem] text-[0.64rem] leading-none font-semibold uppercase tracking-[0.12em] text-[var(--action-subtle-text)] no-underline transition hover:bg-[var(--action-subtle-surface-hover)] hover:text-[var(--action-subtle-text-hover)] visited:text-[var(--action-subtle-text)] disabled:cursor-not-allowed disabled:opacity-60",
  danger:
    "admin-button inline-flex items-center justify-center whitespace-nowrap border border-[var(--action-danger-border)] bg-[var(--action-danger-surface)] px-[0.9rem] py-[0.41rem] text-[0.64rem] leading-none font-semibold uppercase tracking-[0.12em] text-[var(--action-danger-text)] no-underline transition hover:bg-[var(--action-danger-surface-hover)] hover:text-[var(--action-danger-text)] visited:text-[var(--action-danger-text)] disabled:cursor-not-allowed disabled:opacity-60",
  ghost:
    "admin-button inline-flex items-center justify-center whitespace-nowrap border border-transparent bg-transparent px-[0.9rem] py-[0.41rem] text-[0.64rem] leading-none font-semibold uppercase tracking-[0.12em] text-[var(--action-subtle-text)] transition hover:bg-[var(--action-subtle-surface-hover)] hover:text-[var(--action-subtle-text-hover)] disabled:cursor-not-allowed disabled:opacity-60",
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
        ? variant === "primary"
          ? "w-auto px-[0.9rem] py-[0.41rem] text-[0.64rem] leading-none uppercase tracking-[0.12em]"
          : "w-auto px-[0.9rem] py-[0.41rem]"
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

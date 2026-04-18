import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export type ButtonAppearance = "admin" | "studio";
export type ButtonVariant = "primary" | "subtle" | "danger" | "ghost";
export type ButtonSize = "compact" | "default";

const adminVariantClassNames: Record<ButtonVariant, string> = {
  primary:
    "admin-button inline-flex items-center justify-center whitespace-nowrap bg-[var(--ui-action-primary-fill)] px-[1.1875rem] py-[0.64rem] text-[0.79rem] font-semibold text-[var(--ui-action-primary-text)] no-underline transition hover:bg-[var(--ui-action-primary-fill-strong)] hover:text-[var(--ui-action-primary-text)] visited:text-[var(--ui-action-primary-text)] disabled:cursor-not-allowed disabled:opacity-60",
  subtle:
    "admin-button inline-flex items-center justify-center whitespace-nowrap border border-[var(--ui-action-subtle-border)] bg-[var(--ui-action-subtle-surface)] px-[0.7125rem] py-[0.43rem] text-[0.67rem] font-semibold uppercase tracking-[0.12em] text-[var(--ui-action-subtle-text)] no-underline transition hover:bg-[rgba(18,20,20,0.94)] hover:text-[var(--ui-action-subtle-text-hover)] visited:text-[var(--ui-action-subtle-text)] disabled:cursor-not-allowed disabled:opacity-60",
  danger:
    "admin-button inline-flex items-center justify-center whitespace-nowrap border border-[var(--ui-action-danger-border)] bg-[var(--ui-action-danger-surface)] px-[0.95rem] py-[0.43rem] text-[0.67rem] font-semibold uppercase tracking-[0.12em] text-[var(--ui-action-danger-text)] no-underline transition hover:bg-[rgba(56,18,14,0.88)] hover:text-[var(--ui-action-danger-text)] visited:text-[var(--ui-action-danger-text)] disabled:cursor-not-allowed disabled:opacity-60",
  ghost:
    "admin-button inline-flex items-center justify-center whitespace-nowrap border border-transparent bg-transparent px-[0.95rem] py-[0.43rem] text-[0.67rem] font-semibold uppercase tracking-[0.12em] text-[var(--ui-action-subtle-text)] transition hover:bg-[rgba(18,20,20,0.94)] hover:text-[var(--ui-action-subtle-text-hover)] disabled:cursor-not-allowed disabled:opacity-60",
};

const studioVariantClassNames: Record<ButtonVariant, string> = {
  primary:
    "inline-flex items-center justify-center whitespace-nowrap rounded-[18px] bg-[linear-gradient(135deg,var(--ms-action-primary-fill),var(--ms-action-primary-fill-strong))] px-4 py-3 text-[0.82rem] font-semibold text-[var(--ms-action-primary-text)] shadow-[var(--ms-shadow-button)] transition hover:-translate-y-0.5 hover:brightness-[1.03] disabled:cursor-not-allowed disabled:opacity-60",
  subtle:
    "inline-flex items-center justify-center whitespace-nowrap rounded-[18px] border border-[var(--ms-action-subtle-border)] bg-[var(--ms-action-subtle-surface)] px-4 py-3 text-[0.82rem] font-semibold text-[var(--ms-action-subtle-text)] transition hover:border-[var(--ms-action-subtle-border-hover)] hover:bg-[var(--ms-action-subtle-surface-hover)] hover:text-[var(--ms-action-subtle-text-hover)] disabled:cursor-not-allowed disabled:opacity-60",
  danger:
    "inline-flex items-center justify-center whitespace-nowrap rounded-[18px] border border-[var(--ms-action-danger-border)] bg-[var(--ms-action-danger-surface)] px-4 py-3 text-[0.82rem] font-semibold text-[var(--ms-action-danger-text)] transition hover:border-[var(--ms-action-danger-border-hover)] hover:bg-[var(--ms-action-danger-surface-hover)] hover:text-white disabled:cursor-not-allowed disabled:opacity-60",
  ghost:
    "inline-flex items-center justify-center whitespace-nowrap rounded-[18px] border border-transparent bg-transparent px-4 py-3 text-[0.82rem] font-semibold text-[var(--ms-action-subtle-text)] transition hover:border-[var(--ms-action-subtle-border)] hover:bg-[var(--ms-action-subtle-surface)] hover:text-[var(--ms-action-subtle-text-hover)] disabled:cursor-not-allowed disabled:opacity-60",
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
          ? "w-auto px-[0.95rem] py-[0.43rem] text-[0.67rem] uppercase tracking-[0.12em]"
          : "w-auto px-[0.95rem] py-[0.43rem]"
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

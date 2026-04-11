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
    shape === "circle" ? "rounded-full" : "rounded-[16px]",
    appearance === "admin"
      ? "h-10 w-10 backdrop-blur-xl"
      : "h-10 w-10 backdrop-blur-xl",
  );

  const toneClassName =
    tone === "primary"
      ? appearance === "admin"
        ? "border-[var(--ui-action-primary-border)] bg-[linear-gradient(135deg,var(--ui-action-primary-fill),var(--ui-action-primary-fill-strong))] text-[var(--ui-action-primary-text)] shadow-[var(--ui-shadow-button)] hover:brightness-[1.03]"
        : "border-[var(--ms-action-primary-border)] bg-[linear-gradient(135deg,var(--ms-action-primary-fill),var(--ms-action-primary-fill-strong))] text-[var(--ms-action-primary-text)] shadow-[var(--ms-shadow-button)] hover:-translate-y-0.5"
      : tone === "danger"
        ? appearance === "admin"
          ? "border-[var(--ui-action-danger-border)] bg-[var(--ui-action-danger-surface)] text-[var(--ui-action-danger-text)] hover:border-[var(--ui-action-danger-border-hover)] hover:bg-[var(--ui-action-danger-surface-hover)]"
          : "border-[var(--ms-action-danger-border)] bg-[var(--ms-action-danger-surface)] text-[var(--ms-action-danger-text)] hover:border-[var(--ms-action-danger-border-hover)] hover:bg-[var(--ms-action-danger-surface-hover)] hover:text-white"
        : tone === "favorite"
          ? "border-[rgba(255,126,166,0.38)] bg-[rgba(255,126,166,0.16)] text-[#ff8db3]"
          : appearance === "admin"
            ? "border-[var(--ui-action-subtle-border)] bg-[var(--ui-action-subtle-surface)] text-[var(--ui-action-subtle-text)] hover:border-[var(--ui-action-subtle-border-hover)] hover:bg-[var(--ui-action-subtle-surface-hover)] hover:text-[var(--ui-action-subtle-text-hover)]"
            : "border-[var(--ms-action-subtle-border)] bg-[var(--ms-action-subtle-surface)] text-[var(--ms-action-subtle-text)] hover:border-[var(--ms-action-subtle-border-hover)] hover:bg-[var(--ms-action-subtle-surface-hover)] hover:text-[var(--ms-action-subtle-text-hover)]";

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

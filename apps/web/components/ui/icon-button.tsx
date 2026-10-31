import type { ButtonHTMLAttributes, ComponentType } from "react";

import { buttonClassName } from "./button";
import { ControlTooltip } from "./control-tooltip";

import { cn } from "@/lib/utils";

export type IconButtonAppearance = "studio" | "admin";
export type IconButtonTone = "primary" | "subtle" | "danger" | "favorite";
export type IconButtonShape = "circle" | "soft";

function studioIconTone(tone: IconButtonTone) {
  return tone === "primary"
    ? "border-[var(--action-primary-border)] bg-[linear-gradient(135deg,var(--action-primary-fill),var(--action-primary-fill-strong))] text-[var(--action-primary-text)] shadow-[var(--shadow-button)] hover:-translate-y-0.5"
    : tone === "danger"
      ? "border-[var(--action-danger-border)] bg-[var(--action-danger-surface)] text-[var(--action-danger-text)] hover:border-[var(--action-danger-border-hover)] hover:bg-[var(--action-danger-surface-hover)] hover:text-white"
      : tone === "favorite"
        ? "border-[rgba(255,126,166,0.38)] bg-[rgba(255,126,166,0.16)] text-[#ff8db3]"
        : "border-[var(--action-subtle-border)] bg-[var(--action-subtle-surface)] text-[var(--action-subtle-text)] hover:border-[var(--action-subtle-border-hover)] hover:bg-[var(--action-subtle-surface-hover)] hover:text-[var(--action-subtle-text-hover)]";
}
function adminIconClasses(
  tone: IconButtonTone,
  quiet: boolean,
  size: "compact" | "default",
) {
  const variants = {
    primary: "primary",
    danger: "subtle",
    subtle: "subtle",
    favorite: "subtle",
  } as const;
  const quietTones = {
    primary: "admin-icon-control-accent",
    danger: "admin-icon-control-danger",
    subtle: "",
    favorite: "",
  };
  return cn(
    buttonClassName({
      appearance: "admin",
      variant: quiet ? "ghost" : variants[tone],
    }),
    "admin-icon-control group/icon relative",
    size === "compact" && "admin-icon-control-compact",
    quiet && quietTones[tone],
    !quiet && tone === "danger" && "admin-icon-control-danger",
  );
}
export function iconButtonClassName({
  appearance = "studio",
  tone = "subtle",
  shape = "circle",
  className,
  size = "default",
  quiet = false,
}: {
  appearance?: IconButtonAppearance;
  tone?: IconButtonTone;
  shape?: IconButtonShape;
  className?: string;
  size?: "compact" | "default";
  quiet?: boolean;
}) {
  if (appearance === "admin")
    return cn(adminIconClasses(tone, quiet, size), className);
  return cn(
    "inline-flex items-center justify-center border transition disabled:cursor-not-allowed disabled:opacity-60",
    shape === "circle"
      ? "rounded-full"
      : "rounded-[calc(var(--radius-control)-2px)]",
    size === "compact"
      ? "h-8 w-8 backdrop-blur-xl"
      : "h-10 w-10 backdrop-blur-xl",
    studioIconTone(tone),
    className,
  );
}

export function IconButton({
  icon: Icon,
  appearance = "studio",
  tone,
  shape,
  className,
  iconClassName,
  size,
  quiet,
  title,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ComponentType<{ className?: string }>;
  appearance?: IconButtonAppearance;
  tone?: IconButtonTone;
  shape?: IconButtonShape;
  iconClassName?: string;
  size?: "compact" | "default";
  quiet?: boolean;
}) {
  return (
    <button
      {...props}
      title={appearance === "studio" ? title : undefined}
      type={props.type ?? "button"}
      className={iconButtonClassName({
        appearance,
        tone,
        shape,
        size,
        quiet,
        className,
      })}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          appearance === "admin" ? "size-5" : "size-4",
          iconClassName,
        )}
      />
      {appearance === "admin" && title ? (
        <ControlTooltip>{title}</ControlTooltip>
      ) : null}
    </button>
  );
}

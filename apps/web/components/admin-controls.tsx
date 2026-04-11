import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { Button, buttonClassName } from "@/components/ui/button";
import { PillSelect, type PillSelectChoice } from "@/components/ui/pill-select";
import { cn } from "@/lib/utils";

export type AdminChoice = {
  value: string;
  label: string;
};

export const adminSubtleButtonClassName =
  buttonClassName({ appearance: "admin", variant: "subtle" });

export const adminPrimaryButtonClassName =
  buttonClassName({ appearance: "admin", variant: "primary" });

export const adminDangerButtonClassName =
  buttonClassName({ appearance: "admin", variant: "danger" });

export const adminInsetCardClassName =
  "rounded-[20px] border border-[var(--surface-border-soft)] bg-[color:var(--surface-muted)]/82 p-4";

export const adminInsetPanelClassName =
  "rounded-[24px] border border-[var(--surface-border-soft)] bg-[color:var(--surface-muted)]/82 p-5";

export const adminDashedCardClassName =
  "rounded-[18px] border border-dashed border-[var(--surface-border)] px-4 py-5 text-sm text-[var(--muted-strong)]";

type AdminButtonVariant = "primary" | "subtle" | "danger";
type AdminButtonSize = "default" | "compact";

export function adminButtonClassName({
  variant = "primary",
  size = "default",
  className,
}: {
  variant?: AdminButtonVariant;
  size?: AdminButtonSize;
  className?: string;
}) {
  const variantClassName =
    variant === "danger"
      ? adminDangerButtonClassName
      : variant === "subtle"
        ? adminSubtleButtonClassName
        : adminPrimaryButtonClassName;

  const sizeClassName =
    size === "compact"
      ? variant === "primary"
        ? "w-auto px-4 py-2 text-xs uppercase tracking-[0.12em]"
        : "w-auto px-4 py-2"
      : "";

  return cn(variantClassName, sizeClassName, className);
}

export function AdminButton({
  variant = "primary",
  size = "default",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: AdminButtonVariant;
  size?: AdminButtonSize;
}) {
  return <Button {...props} type={type} appearance="admin" variant={variant} size={size} className={className} />;
}

export function AdminField({
  label,
  description,
  children,
  className,
}: {
  label?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("grid gap-2", className)}>
      {label ? (
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted-strong)]">
          {label}
        </span>
      ) : null}
      {description ? <span className="text-sm leading-6 text-white/62">{description}</span> : null}
      {children}
    </label>
  );
}

export const AdminInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function AdminInput(props, ref) {
    return (
      <input
        {...props}
        ref={ref}
        className={cn(
          "w-full rounded-[18px] border border-white/10 bg-[rgba(11,14,13,0.94)] px-4 py-3 text-sm text-white shadow-[0_14px_30px_rgba(0,0,0,0.18)] outline-none placeholder:text-white/34 focus:border-[rgba(208,255,72,0.24)]",
          props.className,
        )}
      />
    );
  },
);

export const AdminTextarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function AdminTextarea(props, ref) {
    return (
      <textarea
        {...props}
        ref={ref}
        className={cn(
          "w-full rounded-[18px] border border-white/10 bg-[rgba(11,14,13,0.94)] px-4 py-3 text-sm leading-7 text-white shadow-[0_14px_30px_rgba(0,0,0,0.18)] outline-none placeholder:text-white/34 focus:border-[rgba(208,255,72,0.24)]",
          props.className,
        )}
      />
    );
  },
);

export function AdminToggle({
  checked,
  onToggle,
  ariaLabel,
}: {
  checked: boolean;
  onToggle: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onToggle}
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 rounded-full border transition",
        checked ? "border-[rgba(208,255,72,0.28)] bg-[rgba(208,255,72,0.18)]" : "border-white/10 bg-white/[0.06]",
      )}
    >
      <span
        className={cn(
          "absolute top-1 h-5 w-5 rounded-full transition",
          checked ? "left-6 bg-[rgba(208,255,72,0.94)]" : "left-1 bg-white/70",
        )}
      />
    </button>
  );
}

export function AdminPillSelect({
  pickerId = "admin-pill-select",
  open,
  onToggle,
  value,
  choices,
  onSelect,
  className,
}: {
  pickerId?: string;
  open: boolean;
  onToggle: () => void;
  value: string;
  choices: PillSelectChoice[];
  onSelect: (value: string) => void;
  className?: string;
}) {
  return (
    <PillSelect
      pickerId={pickerId}
      open={open}
      onToggle={onToggle}
      onClose={onToggle}
      appearance="admin"
      label={choices.find((choice) => choice.value === value)?.label ?? choices[0]?.label ?? "Select"}
      choices={choices}
      selectedValue={value}
      onSelect={onSelect}
      className={className}
    />
  );
}

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

export const adminInsetSurfaceClassName =
  "admin-surface-inset p-4";

export const adminInsetCardClassName = adminInsetSurfaceClassName;

export const adminInsetPanelClassName = adminInsetSurfaceClassName;

export const adminDashedCardClassName =
  "admin-surface-dashed px-4 py-5 text-sm text-[var(--muted-strong)]";

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
        ? "w-auto px-[0.9rem] py-[0.41rem] text-[0.64rem] leading-none uppercase tracking-[0.12em]"
        : "w-auto px-[0.9rem] py-[0.41rem]"
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
        <span className="admin-field-label">{label}</span>
      ) : null}
      {description ? <span className="admin-field-description">{description}</span> : null}
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
          "admin-input text-sm",
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
          "admin-textarea text-sm leading-7",
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
        "admin-toggle-control",
        checked ? "admin-toggle-control-active" : "",
      )}
    >
      <span
        className={cn(
          "admin-toggle-thumb",
          checked ? "admin-toggle-thumb-active" : "",
        )}
      />
    </button>
  );
}

export function AdminSelect({
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

export const AdminPillSelect = AdminSelect;

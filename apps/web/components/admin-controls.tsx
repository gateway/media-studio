import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { ControlTooltip } from "@/components/ui/control-tooltip";
import { Button, buttonClassName } from "@/components/ui/button";
import { PillSelect, type PillSelectChoice } from "@/components/ui/pill-select";
import { emptyStateClassName, surfaceInsetClassName } from "@/components/ui/surface-primitives";
import { cn } from "@/lib/utils";

export type AdminChoice = {
  value: string;
  label: string;
};

export const adminInsetSurfaceClassName =
  surfaceInsetClassName({ appearance: "admin", className: "p-4" });

export const adminInsetCardClassName = adminInsetSurfaceClassName;

export const adminInsetPanelClassName = adminInsetSurfaceClassName;

export const adminDashedCardClassName =
  emptyStateClassName({ appearance: "admin", density: "compact", className: "px-4 py-5 text-sm text-[var(--muted-strong)]" });

export const adminButtonIconLabelClassName = "inline-flex items-center gap-2";

export const adminInputWithIconClassName = "admin-input flex items-center gap-2 px-3";

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
  return buttonClassName({ appearance: "admin", variant, size, className });
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

export function AdminIconButton({
  label,
  tooltip = label,
  children,
  className,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "title"> & {
  label: string;
  tooltip?: string;
  children: ReactNode;
}) {
  return (
    <AdminButton
      {...props}
      variant="subtle"
      size="compact"
      aria-label={label}
      className={cn("admin-icon-button group/icon relative", className)}
    >
      {children}
      <ControlTooltip>{tooltip}</ControlTooltip>
    </AdminButton>
  );
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

export function AdminToggleRow({
  title,
  description,
  checked,
  ariaLabel,
  onToggle,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  checked: boolean;
  ariaLabel: string;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <label className={cn("admin-toggle-row text-sm", className)}>
      <span className="min-w-0">
        <span className="font-medium text-[var(--foreground)]">{title}</span>
        {description ? (
          <span className="mt-1 block text-sm leading-6 text-[var(--muted-strong)]">
            {description}
          </span>
        ) : null}
      </span>
      <AdminToggle checked={checked} ariaLabel={ariaLabel} onToggle={onToggle} />
    </label>
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

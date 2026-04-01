import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

export type AdminChoice = {
  value: string;
  label: string;
};

export const adminSubtleButtonClassName =
  "inline-flex items-center justify-center whitespace-nowrap rounded-full border border-white/10 bg-[rgba(255,255,255,0.05)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white/84 no-underline transition hover:border-white/18 hover:bg-[rgba(255,255,255,0.08)] hover:text-white visited:text-white/84 disabled:cursor-not-allowed disabled:opacity-60";

export const adminPrimaryButtonClassName =
  "inline-flex items-center justify-center whitespace-nowrap rounded-full bg-[linear-gradient(135deg,#d8ff2e,#b5f414)] px-5 py-3 text-sm font-semibold text-[#162400] no-underline shadow-[0_16px_32px_rgba(181,244,20,0.16)] transition hover:brightness-[1.04] hover:text-[#162400] hover:shadow-[0_20px_38px_rgba(181,244,20,0.22)] visited:text-[#162400] disabled:cursor-not-allowed disabled:opacity-60";

export const adminDangerButtonClassName =
  "inline-flex items-center justify-center whitespace-nowrap rounded-full border border-[rgba(201,102,82,0.22)] bg-[rgba(201,102,82,0.08)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#d88e7d] no-underline transition hover:border-[rgba(201,102,82,0.34)] hover:bg-[rgba(201,102,82,0.12)] hover:text-[#d88e7d] visited:text-[#d88e7d] disabled:cursor-not-allowed disabled:opacity-60";

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
  return <button {...props} type={type} className={adminButtonClassName({ variant, size, className })} />;
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
  open,
  onToggle,
  value,
  choices,
  onSelect,
  className,
}: {
  open: boolean;
  onToggle: () => void;
  value: string;
  choices: AdminChoice[];
  onSelect: (value: string) => void;
  className?: string;
}) {
  const selected = choices.find((choice) => choice.value === value) ?? choices[0] ?? null;

  return (
    <div className={cn("relative", open ? "z-40" : "z-10", className)}>
      <button
        type="button"
        onClick={onToggle}
        className="flex h-12 w-full items-center gap-3 rounded-[18px] border border-white/8 bg-white/[0.04] pl-3.5 pr-3.5 text-left text-[0.82rem] font-semibold text-white transition hover:border-[rgba(216,141,67,0.22)]"
      >
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? "Select"}</span>
        <ChevronDown className={cn("size-4 shrink-0 text-white/42 transition", open ? "rotate-180" : "")} />
      </button>

      {open ? (
        <div className="absolute left-0 top-[calc(100%+0.65rem)] z-30 w-full overflow-auto rounded-[20px] border border-white/10 bg-[rgba(17,20,19,0.98)] p-2 shadow-[0_24px_52px_rgba(0,0,0,0.44)] backdrop-blur-xl">
          <div className="grid gap-1">
            {choices.map((choice) => (
              <button
                key={choice.value}
                type="button"
                onClick={() => onSelect(choice.value)}
                className="rounded-[14px] px-3 py-2.5 text-left text-[0.82rem] font-medium text-white/84 transition hover:bg-white/[0.08] hover:text-white"
              >
                {choice.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

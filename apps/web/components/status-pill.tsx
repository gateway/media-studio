import { cn } from "@/lib/utils";

const styles = {
  healthy: "bg-[rgba(81,136,111,0.14)] text-[var(--success)] border-[rgba(81,136,111,0.18)]",
  warning: "bg-[rgba(204,135,51,0.15)] text-[var(--warning)] border-[rgba(204,135,51,0.18)]",
  danger: "bg-[rgba(175,79,64,0.14)] text-[var(--danger)] border-[rgba(175,79,64,0.18)]",
  neutral: "bg-[color:var(--surface-muted)] text-[var(--muted-strong)] border-[var(--surface-border-soft)]",
};

export function StatusPill({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: keyof typeof styles;
}) {
  return (
    <span
      className={cn(
        "admin-status-pill inline-flex items-center border px-3 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.14em]",
        styles[tone],
      )}
    >
      {label}
    </span>
  );
}

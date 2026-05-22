import { cn } from "@/lib/utils";

const styles = {
  healthy: "admin-status-healthy",
  warning: "admin-status-warning",
  danger: "admin-status-danger",
  neutral: "admin-status-neutral",
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
        "admin-status-badge inline-flex items-center border px-2 py-1 text-[0.64rem] font-semibold uppercase tracking-[0.12em]",
        styles[tone],
      )}
    >
      {label}
    </span>
  );
}

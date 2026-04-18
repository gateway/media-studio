export const adminThemeVarsClassName =
  "[--surface:rgba(14,17,16,0.72)] [--surface-muted:rgba(255,255,255,0.018)] [--surface-border:rgba(255,255,255,0.08)] [--surface-border-soft:rgba(255,255,255,0.06)] [--foreground:#f7f6f0] [--muted-strong:rgba(247,246,240,0.68)] [--accent-strong:rgba(208,255,72,0.94)] [--success:#bff36b] [--danger:#ffb5a6] [--warning:#f1b86a] [--shadow-soft:0_10px_24px_rgba(0,0,0,0.16)]";

export const adminThemeLayoutClassName = `grid min-w-0 gap-6 ${adminThemeVarsClassName}`;
export const adminThemeLayoutOverflowClassName = `${adminThemeLayoutClassName} overflow-x-hidden`;

export const adminSurfaceCardClassName =
  "rounded-[22px] border border-[var(--surface-border-soft)] bg-[color:var(--surface)] px-5 py-5";

export const adminStatCardClassName =
  "rounded-[16px] border border-[var(--surface-border-soft)] bg-[color:var(--surface-muted)] px-4 py-4";

export const adminInsetCompactClassName =
  "rounded-[14px] border border-[var(--surface-border-soft)] bg-[color:var(--surface-muted)] px-3 py-3";

export const adminThemeVarsClassName =
  "[--surface:rgba(17,20,19,0.9)] [--surface-muted:rgba(255,255,255,0.05)] [--surface-border:rgba(255,255,255,0.10)] [--surface-border-soft:rgba(255,255,255,0.08)] [--foreground:#f7f6f0] [--muted-strong:rgba(247,246,240,0.68)] [--accent-strong:rgba(208,255,72,0.94)] [--success:#bff36b] [--danger:#ffb5a6] [--warning:#f1b86a] [--shadow-soft:0_24px_60px_rgba(0,0,0,0.26)]";

export const adminThemeLayoutClassName = `grid min-w-0 gap-6 ${adminThemeVarsClassName}`;
export const adminThemeLayoutOverflowClassName = `${adminThemeLayoutClassName} overflow-x-hidden`;

export const adminSurfaceCardClassName =
  "rounded-[26px] border border-[var(--surface-border-soft)] bg-[color:var(--surface)]/92 p-5 shadow-[var(--shadow-soft)]";

export const adminStatCardClassName =
  "rounded-[18px] border border-[var(--surface-border-soft)] bg-[color:var(--surface-muted)]/82 px-4 py-4";

export const adminInsetCompactClassName =
  "rounded-[16px] border border-[var(--surface-border-soft)] bg-[color:var(--surface-muted)]/82 px-3 py-3";

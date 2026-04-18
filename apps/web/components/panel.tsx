import { cn } from "@/lib/utils";

export function Panel({
  children,
  className,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "admin-surface-panel px-5 py-5",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function PanelHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-[var(--surface-border-soft)] pb-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="space-y-2">
        <p className="admin-panel-eyebrow">{eyebrow}</p>
        <div>
          <h2 className="admin-panel-title">{title}</h2>
          {description ? (
            <p className="admin-panel-description">{description}</p>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

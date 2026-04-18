import { HeaderStatusStrip } from "@/components/header-status";

type SectionIntroProps = {
  eyebrow: string;
  title: string;
  description?: string;
  meta?: string;
};

export function SectionIntro({ eyebrow, title, description, meta }: SectionIntroProps) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="max-w-3xl">
        <p className="admin-panel-eyebrow">{eyebrow}</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-[var(--foreground)] lg:text-[2.5rem]">
          {title}
        </h1>
        {description ? (
          <p className="mt-3 text-sm leading-7 text-[var(--muted-strong)] lg:text-[1rem]">
            {description}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-start gap-3 lg:items-end">
        <HeaderStatusStrip />
        {meta ? (
          <div className="rounded-full border border-[var(--surface-border)] bg-[color:var(--surface-muted)]/85 px-4 py-2 text-xs font-medium uppercase tracking-[0.14em] text-[var(--muted-strong)]">
            {meta}
          </div>
        ) : null}
      </div>
    </div>
  );
}

"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type SharedLlmProviderIntroCardProps = {
  accentLabel: string;
  summaryLines: ReactNode[];
  picker: ReactNode;
  leadingContent?: ReactNode;
  trailingContent?: ReactNode;
};

export function SharedLlmProviderIntroCard({
  accentLabel,
  summaryLines,
  picker,
  leadingContent,
  trailingContent,
}: SharedLlmProviderIntroCardProps) {
  return (
    <div className="admin-surface-accent grid gap-4 p-4 sm:p-5">
      {leadingContent}
      <div className="admin-label-accent">{accentLabel}</div>
      <div className="max-w-[760px] text-sm leading-7 text-[var(--muted-strong)]">
        {summaryLines.map((line, index) => (
          <div key={index} className={index > 0 ? "mt-2" : undefined}>
            {line}
          </div>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,280px)_minmax(0,320px)] lg:items-start">
        <div className="hidden lg:block" aria-hidden="true" />
        {picker}
      </div>
      {trailingContent}
    </div>
  );
}

type SharedLlmProviderSectionProps = {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  children: ReactNode;
};

export function SharedLlmProviderSection({
  icon: Icon,
  title,
  description,
  children,
}: SharedLlmProviderSectionProps) {
  return (
    <div className="grid gap-3">
      <div className="admin-icon-label-row admin-label-muted">
        <Icon className="size-3.5" />
        {title}
      </div>
      {description ? (
        <div className="max-w-[760px] text-sm leading-6 text-[var(--muted-strong)]">{description}</div>
      ) : null}
      {children}
    </div>
  );
}

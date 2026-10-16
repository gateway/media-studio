"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { AdminField } from "@/components/admin-controls";
import { llmProviderLabel, type EnhancementProviderKind } from "@/lib/llm-provider-metadata";

type SharedLlmProviderIntroCardProps = {
  accentLabel: string;
  summaryLines: ReactNode[];
  picker?: ReactNode;
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
    <div className="surface-card-accent grid gap-4 p-4 sm:p-5">
      {leadingContent}
      <div className="admin-label-accent">{accentLabel}</div>
      <div className="max-w-[760px] text-sm leading-7 text-[var(--muted-strong)]">
        {summaryLines.map((line, index) => (
          <div key={index} className={index > 0 ? "mt-2" : undefined}>
            {line}
          </div>
        ))}
      </div>
      {picker ? <div className="grid max-w-[760px] gap-3">{picker}</div> : null}
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

export function SharedLlmProviderPicker<T extends EnhancementProviderKind>({
  value, onChange, includeHelper = false, disabled = false,
}: {
  value: T;
  onChange: (provider: T) => void;
  includeHelper?: boolean;
  disabled?: boolean;
}) {
  const providers: EnhancementProviderKind[] = ["codex_local", "openrouter", "local_openai"];
  if (includeHelper) providers.push("builtin");
  return (
    <AdminField label="AI provider">
      <select className="admin-input" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as T)}>
        {providers.map((provider) => <option key={provider} value={provider}>{llmProviderLabel(provider)}</option>)}
      </select>
    </AdminField>
  );
}

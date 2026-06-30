"use client";

import { studioBadgeClassName } from "@/components/studio/studio-theme";
import { SurfaceInset } from "@/components/ui/surface-primitives";
import { cn } from "@/lib/utils";

export function StudioMobileInputsSection({
  title,
  summary,
  children,
  className,
}: {
  title: string;
  summary?: string | null;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <SurfaceInset appearance="studio" density="compact" className={cn("studio-mobile-inputs-section-shell", className)}>
      <div className="studio-mobile-inputs-section-header">
        <div className="studio-mobile-inputs-section-title">{title}</div>
        {summary ? (
          <div className={studioBadgeClassName({ size: "compact", className: "studio-mobile-inputs-section-summary" })}>
            {summary}
          </div>
        ) : null}
      </div>
      {children}
    </SurfaceInset>
  );
}

export function StudioMobileInputsGroup({
  label,
  summary,
  children,
  className,
}: {
  label: string;
  summary?: string | null;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <SurfaceInset appearance="studio" density="compact" className={cn("rounded-[20px]", className)}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-dim)]">{label}</div>
        {summary ? (
          <div className={studioBadgeClassName({ size: "compact", className: "px-2 py-0.5 text-[0.52rem] text-[var(--text-dim)] shadow-none" })}>
            {summary}
          </div>
        ) : null}
      </div>
      {children}
    </SurfaceInset>
  );
}

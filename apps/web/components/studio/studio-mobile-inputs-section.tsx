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
    <SurfaceInset appearance="studio" density="compact" className={cn("mt-4 rounded-[24px] text-white lg:hidden", className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[var(--text-dim)]">{title}</div>
        {summary ? (
          <div className={studioBadgeClassName({ size: "compact", className: "px-3 py-1 text-[0.58rem] text-[var(--text-muted)] shadow-none" })}>
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

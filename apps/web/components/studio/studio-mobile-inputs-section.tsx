"use client";

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
    <div
      className={cn(
        "mt-4 rounded-[24px] border border-white/8 bg-[rgba(255,255,255,0.04)] p-3 text-white lg:hidden",
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-white/46">{title}</div>
        {summary ? (
          <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[0.58rem] font-semibold uppercase tracking-[0.12em] text-white/62">
            {summary}
          </div>
        ) : null}
      </div>
      {children}
    </div>
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
    <div className={cn("rounded-[20px] border border-white/8 bg-white/[0.03] p-3", className)}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-white/52">{label}</div>
        {summary ? (
          <div className="rounded-full border border-white/8 bg-black/18 px-2 py-0.5 text-[0.52rem] font-semibold uppercase tracking-[0.12em] text-white/44">
            {summary}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

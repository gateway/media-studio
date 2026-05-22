"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type StudioCreateStageProps = {
  immersive: boolean;
  children: ReactNode;
};

export function StudioCreateStage({ immersive, children }: StudioCreateStageProps) {
  return (
    <div
      id="create"
      className={cn(
        "overflow-x-hidden overflow-y-visible bg-[#121413] px-0 py-0 text-white",
        immersive
          ? "min-h-dvh"
          : "rounded-[34px] border border-[rgba(22,26,24,0.9)] shadow-[0_38px_90px_rgba(19,24,21,0.3)]",
      )}
    >
      <div className={cn("relative overflow-x-hidden overflow-y-visible", immersive ? "min-h-dvh" : "min-h-[920px]")}>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(216,141,67,0.16),transparent_24%),radial-gradient(circle_at_top_right,rgba(82,110,106,0.2),transparent_28%),linear-gradient(180deg,#181c1a,#111412_52%,#171917)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,9,8,0.12),rgba(7,9,8,0.52)),radial-gradient(circle_at_center,transparent_40%,rgba(4,4,4,0.42)_100%)]" />
        {children}
      </div>
    </div>
  );
}

"use client";

import { Coins } from "lucide-react";

import { cn } from "@/lib/utils";

export function StudioMetricPill({
  icon: Icon,
  value,
  accent = "default",
}: {
  icon: typeof Coins;
  value: string;
  accent?: "default" | "highlight" | "project";
}) {
  return (
    <div
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-[14px] border px-3 text-[0.72rem] font-semibold",
        accent === "highlight"
          ? "border-[rgba(216,255,46,0.22)] bg-[rgba(14,18,15,0.99)] text-[#f4ffd3] shadow-[0_14px_24px_rgba(0,0,0,0.24)]"
          : accent === "project"
            ? "border-[rgba(255,183,107,0.28)] bg-[rgba(29,18,10,0.96)] text-[#ffe2ba] shadow-[0_14px_24px_rgba(0,0,0,0.28)]"
            : "border-white/14 bg-[rgba(14,18,15,0.99)] text-white/92 shadow-[0_14px_24px_rgba(0,0,0,0.26)]",
      )}
    >
      <span
        className={cn(
          "inline-flex h-5 w-5 items-center justify-center rounded-full",
          accent === "highlight"
            ? "bg-[rgba(216,255,46,0.22)] text-[#d8ff2e]"
            : accent === "project"
              ? "bg-[rgba(255,183,107,0.18)] text-[#ffb76b]"
              : "bg-[rgba(216,255,46,0.18)] text-[#d8ff2e]",
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <span>{value}</span>
    </div>
  );
}

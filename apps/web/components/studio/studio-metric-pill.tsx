"use client";

import { Coins } from "lucide-react";

import { studioBadgeClassName, studioBadgeIconClassName } from "@/components/studio/studio-theme";

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
      className={studioBadgeClassName({
        tone: accent === "project" ? "project" : "default",
        className: "h-10 px-3 text-[0.72rem] font-semibold",
      })}
    >
      <span className={studioBadgeIconClassName({ tone: accent === "project" ? "project" : accent === "highlight" ? "accent" : "default" })}>
        <Icon className="size-3.5" />
      </span>
      <span>{value}</span>
    </div>
  );
}

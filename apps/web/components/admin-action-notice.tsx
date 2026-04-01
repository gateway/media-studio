"use client";

import { CheckCircle2, AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";

export function AdminActionNotice({
  tone,
  text,
}: {
  tone: "healthy" | "danger";
  text: string;
}) {
  return (
    <div className="fixed inset-x-0 top-6 z-[200] flex justify-center px-4">
      <div
        className={cn(
          "inline-flex min-w-[280px] max-w-[640px] items-center gap-3 rounded-[20px] border px-4 py-3 text-sm shadow-[0_24px_60px_rgba(0,0,0,0.36)] backdrop-blur-xl",
          tone === "healthy"
            ? "border-[rgba(81,136,111,0.2)] bg-[rgba(10,19,14,0.94)] text-[var(--success)]"
            : "border-[rgba(175,79,64,0.22)] bg-[rgba(24,12,10,0.94)] text-[var(--danger)]",
        )}
      >
        {tone === "healthy" ? <CheckCircle2 className="size-4.5 shrink-0" /> : <AlertTriangle className="size-4.5 shrink-0" />}
        <span>{text}</span>
      </div>
    </div>
  );
}

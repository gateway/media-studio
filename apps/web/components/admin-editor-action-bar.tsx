"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function AdminEditorActionBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap justify-end gap-3", className)}>
      {children}
    </div>
  );
}

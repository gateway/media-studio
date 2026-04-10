"use client";

import { FolderOpen } from "lucide-react";

type StudioLibraryButtonProps = {
  onClick: () => void;
  label?: string;
  testId?: string;
};

export function StudioLibraryButton({
  onClick,
  label = "Library",
  testId,
}: StudioLibraryButtonProps) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="inline-flex h-8 items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-white/68 transition hover:border-[rgba(216,141,67,0.24)] hover:text-white"
    >
      <FolderOpen className="size-3.5 text-[rgba(208,255,72,0.88)]" />
      <span>{label}</span>
    </button>
  );
}

"use client";

import { FolderOpen } from "lucide-react";

import { Button } from "@/components/ui/button";

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
    <Button
      data-testid={testId}
      onClick={onClick}
      appearance="studio"
      variant="subtle"
      size="compact"
      className="h-8 gap-2 rounded-full px-3 text-[0.64rem] tracking-[0.14em]"
    >
      <FolderOpen className="size-3.5 text-[var(--accent-strong)]" />
      <span>{label}</span>
    </Button>
  );
}

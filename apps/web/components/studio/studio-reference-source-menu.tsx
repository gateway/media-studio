"use client";

import { FolderOpen, Plus, Upload } from "lucide-react";
import { useId, useRef, useState } from "react";

import { PillSelect } from "@/components/ui/pill-select";

const sourceChoices = [
  { value: "upload", label: "Upload file" },
  { value: "library", label: "Choose from library" },
];

export function StudioReferenceSourceMenu({
  action,
  label,
  accept,
  testId,
  onPickFiles,
  onOpenLibrary,
}: {
  action: "Add" | "Replace";
  label: string;
  accept: string;
  testId: string;
  onPickFiles: (files: FileList | null, input: HTMLInputElement) => void;
  onOpenLibrary: () => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <PillSelect
        pickerId={`reference-source-${id}`}
        triggerClassName="studio-reference-source-trigger"
        viewportOverlay
        open={open}
        onToggle={() => setOpen((current) => !current)}
        onClose={() => setOpen(false)}
        label={label}
        triggerLabel={action}
        icon={action === "Add" ? Plus : undefined}
        choices={sourceChoices}
        menuTitle={label}
        choiceIcon={({ value }) => (value === "upload" ? Upload : FolderOpen)}
        onSelect={(value) => {
          if (value === "upload") input.current?.click();
          if (value === "library") onOpenLibrary();
        }}
      />
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        multiple={action === "Add"}
        aria-label={label}
        data-testid={testId}
        onChange={({ currentTarget }) =>
          onPickFiles(currentTarget.files, currentTarget)
        }
      />
    </>
  );
}

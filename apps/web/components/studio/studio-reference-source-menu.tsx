"use client";

import { ChevronDown, FolderOpen, Plus, Upload } from "lucide-react";
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
  multiple = action === "Add",
  testId,
  onPickFiles,
  onOpenLibrary,
}: {
  action: "Add" | "Replace";
  label: string;
  accept: string;
  multiple?: boolean;
  testId: string;
  onPickFiles: (files: FileList | null, input: HTMLInputElement) => void;
  onOpenLibrary: (trigger: HTMLButtonElement) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const replacing = action === "Replace";

  return (
    <>
      <PillSelect
        pickerId={`reference-source-${id}`}
        triggerRef={trigger}
        triggerClassName={
          replacing
            ? "studio-reference-replace-trigger"
            : "studio-reference-source-trigger"
        }
        viewportOverlay
        viewportMenuMinWidth={220}
        open={open}
        onToggle={() => setOpen((current) => !current)}
        onClose={() => setOpen(false)}
        label={label}
        triggerLabel={action}
        icon={replacing ? ChevronDown : Plus}
        iconOnly={replacing}
        choices={sourceChoices}
        menuTitle={label}
        choiceIcon={({ value }) => (value === "upload" ? Upload : FolderOpen)}
        onSelect={(value) => {
          if (value === "upload") input.current?.click();
          if (value === "library" && trigger.current)
            onOpenLibrary(trigger.current);
        }}
      />
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        aria-label={label}
        data-testid={testId}
        onChange={({ currentTarget }) =>
          onPickFiles(currentTarget.files, currentTarget)
        }
      />
    </>
  );
}

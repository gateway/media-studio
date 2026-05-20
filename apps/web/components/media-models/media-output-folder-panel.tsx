"use client";

import { FolderOpen } from "lucide-react";

import { AdminButton, AdminInput } from "@/components/admin-controls";
import { Panel, PanelHeader } from "@/components/panel";
import { surfaceCardClassName } from "@/components/ui/surface-primitives";
import { cn } from "@/lib/utils";

type MediaOutputFolderPanelProps = {
  mediaOutputsPath: string;
  mobileControlDevice: boolean;
  onOpen: () => void;
};

export function MediaOutputFolderPanel({
  mediaOutputsPath,
  mobileControlDevice,
  onOpen,
}: MediaOutputFolderPanelProps) {
  return (
    <Panel>
      <PanelHeader
        eyebrow="Studio Settings"
        title="Media Output Folder"
        description="Open the folder where Media Studio saves finished files on this machine."
      />
      <div className={cn(surfaceCardClassName({ appearance: "admin", className: "mt-5 px-5 py-5" }))}>
        <div className="admin-icon-label-row admin-label-muted">
          <FolderOpen className="size-3.5" />
          Media output folder
        </div>
        <div className="mt-3">
          <AdminInput value={mediaOutputsPath} readOnly className="text-[var(--muted-strong)]" />
        </div>
        <div className="mt-3 text-sm leading-6 text-[var(--muted-strong)]">
          This opens the local output folder on the current machine. It is useful while working locally and is not meant for mobile control.
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <AdminButton
            onClick={onOpen}
            disabled={mobileControlDevice}
            size="compact"
            className="disabled:cursor-not-allowed disabled:opacity-55"
          >
            Open
          </AdminButton>
        </div>
      </div>
    </Panel>
  );
}

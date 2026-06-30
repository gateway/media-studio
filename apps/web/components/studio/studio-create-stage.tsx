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
        "studio-create-stage",
        immersive ? "studio-create-stage-immersive" : "studio-create-stage-framed",
      )}
    >
      <div
        className={cn(
          "studio-create-stage-body",
          immersive ? "studio-create-stage-body-immersive" : "studio-create-stage-body-framed",
        )}
      >
        <div className="studio-create-stage-atmosphere" />
        <div className="studio-create-stage-vignette" />
        {children}
      </div>
    </div>
  );
}

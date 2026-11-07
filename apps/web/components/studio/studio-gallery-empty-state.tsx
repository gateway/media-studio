"use client";

import { Image as ImageIcon } from "lucide-react";
import { EmptyState } from "@/components/ui/surface-primitives";
import { cn } from "@/lib/utils";

type StudioGalleryEmptyStateProps = {
  apiHealthy: boolean;
  immersive: boolean;
};

export function StudioGalleryEmptyState({
  apiHealthy,
  immersive,
}: StudioGalleryEmptyStateProps) {
  return (
    <div
      data-testid="studio-gallery"
      className={cn(
        "studio-gallery-grid-shell studio-gallery-empty-shell p-px",
        immersive
          ? "min-h-dvh pb-[270px] pt-0 md:pb-[290px]"
          : "min-h-[920px] pt-20",
      )}
    >
      <EmptyState
        appearance="studio"
        eyebrow={
          apiHealthy ? (
            <ImageIcon aria-hidden="true" className="mx-auto size-10" />
          ) : (
            "Studio Starting"
          )
        }
        title={apiHealthy ? "No media yet" : "Media Studio is connecting."}
        description={
          apiHealthy
            ? "Pick a model, write a prompt, and generate your first image or video. Finished work will appear here."
            : "This page is up, but the media backend is still coming online. Once it is ready, your recent renders and tools will appear here."
        }
        className="studio-gallery-empty-state"
      />
    </div>
  );
}

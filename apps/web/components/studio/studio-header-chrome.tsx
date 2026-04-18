"use client";

import {
  Clapperboard,
  FolderOpen,
  Heart,
  Image as ImageIcon,
  Monitor,
  Settings2,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import { StatusPill } from "@/components/status-pill";
import { IconButton } from "@/components/ui/icon-button";

type StudioHeaderChromeProps = {
  immersive: boolean;
  apiHealthy: boolean;
  galleryModelFilter: string;
  models: Array<{ key: string; label: string }>;
  favoritesOnly: boolean;
  galleryKindFilter: "all" | "image" | "video";
  metrics?: React.ReactNode;
  onGalleryModelFilterChange: (value: string) => void;
  onActivateGalleryKindFilter: (value: "all" | "image" | "video") => void;
  onToggleFavoritesFilter: () => void;
  onOpenPresets: () => void;
  onOpenLibrary: () => void;
  showLibraryButton?: boolean;
  onOpenSettings: () => void;
};

function FilterButton({
  active,
  icon: Icon,
  label,
  testId,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  testId?: string;
  onClick: () => void;
}) {
  return (
    <IconButton
      icon={Icon}
      data-testid={testId}
      onClick={onClick}
      aria-label={label}
      tone={active ? "primary" : "subtle"}
    />
  );
}

export function StudioHeaderChrome({
  immersive,
  apiHealthy,
  galleryModelFilter,
  models,
  favoritesOnly,
  galleryKindFilter,
  metrics,
  onGalleryModelFilterChange,
  onActivateGalleryKindFilter,
  onToggleFavoritesFilter,
  onOpenPresets,
  onOpenLibrary,
  showLibraryButton = true,
  onOpenSettings,
}: StudioHeaderChromeProps) {
  if (!immersive) {
    return (
      <div className="absolute left-4 right-4 top-4 z-10 flex items-center justify-end gap-3 md:left-6 md:right-6 md:top-6">
        <div className="flex items-center gap-2 rounded-full bg-black/26 px-3 py-2 backdrop-blur-xl">
          <StatusPill label={apiHealthy ? "api live" : "api down"} tone={apiHealthy ? "healthy" : "danger"} />
          <select
            value={galleryModelFilter}
            onChange={(event) => onGalleryModelFilterChange(event.target.value)}
            className="rounded-full border border-white/10 bg-white/8 px-3 py-2 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-white outline-none"
          >
            <option value="all">All models</option>
            {models.map((model) => (
              <option key={model.key} value={model.key}>
                {model.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none fixed left-5 right-5 top-5 z-30 flex flex-col gap-2 md:left-7 md:right-7 md:top-7 md:flex-row md:items-start md:justify-between">
      <div className="pointer-events-auto flex items-center gap-2">
        <FilterButton
          active={!favoritesOnly && galleryKindFilter === "all"}
          icon={Monitor}
          label="All media"
          testId="studio-filter-all"
          onClick={() => onActivateGalleryKindFilter("all")}
        />
        <FilterButton
          active={!favoritesOnly && galleryKindFilter === "image"}
          icon={ImageIcon}
          label="Images"
          testId="studio-filter-images"
          onClick={() => onActivateGalleryKindFilter("image")}
        />
        <FilterButton
          active={!favoritesOnly && galleryKindFilter === "video"}
          icon={Clapperboard}
          label="Videos"
          testId="studio-filter-videos"
          onClick={() => onActivateGalleryKindFilter("video")}
        />
        <FilterButton
          active={favoritesOnly}
          icon={Heart}
          label="Favorites only"
          testId="studio-filter-favorites"
          onClick={onToggleFavoritesFilter}
        />
        <FilterButton
          active={false}
          icon={Sparkles}
          label="Presets"
          testId="studio-filter-presets"
          onClick={onOpenPresets}
        />
        {showLibraryButton ? (
          <FilterButton
            active={false}
            icon={FolderOpen}
            label="Reference library"
            testId="studio-filter-library"
            onClick={onOpenLibrary}
          />
        ) : null}
        <FilterButton
          active={false}
          icon={Settings2}
          label="Settings"
          testId="studio-filter-settings"
          onClick={onOpenSettings}
        />
      </div>
      <div className="pointer-events-auto flex items-center justify-end gap-2 md:max-w-[calc(100vw-3.5rem)]">
        {metrics}
      </div>
    </div>
  );
}

"use client";

import {
  Clapperboard,
  FolderOpen,
  Folders,
  Heart,
  Image as ImageIcon,
  Monitor,
  Settings2,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import { StatusPill } from "@/components/status-pill";
import { IconButton } from "@/components/ui/icon-button";
import { connectingStatus, readyStatus } from "@/lib/status-language";

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
  onOpenProjects: () => void;
  projectWorkspaceActive?: boolean;
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
      className={active ? undefined : "studio-badge"}
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
  onOpenProjects,
  projectWorkspaceActive = false,
  onOpenPresets,
  onOpenLibrary,
  showLibraryButton = true,
  onOpenSettings,
}: StudioHeaderChromeProps) {
  const apiStatus = apiHealthy ? readyStatus() : connectingStatus();
  if (!immersive) {
    return (
      <div className="absolute left-4 right-4 top-4 z-10 flex items-center justify-end gap-3 md:left-6 md:right-6 md:top-6">
        <div className="flex items-center gap-2 rounded-full bg-black/26 px-3 py-2 backdrop-blur-xl">
          <StatusPill label={apiStatus.label} tone={apiStatus.tone} />
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
    <div className="studio-header-chrome-root">
      <div className="studio-header-filter-row">
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
          active={projectWorkspaceActive}
          icon={Folders}
          label="Projects"
          testId="studio-filter-projects"
          onClick={onOpenProjects}
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
      <div className="studio-header-metrics-row">
        {metrics}
      </div>
    </div>
  );
}

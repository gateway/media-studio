"use client";

import {
  FolderOpen,
  Folders,
  Heart,
  Image as ImageIcon,
  Layers,
  Monitor,
  Play,
  Settings2,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { StatusPill } from "@/components/status-pill";
import { IconButton } from "@/components/ui/icon-button";
import { PillSelect } from "@/components/ui/pill-select";
import { connectingStatus, readyStatus } from "@/lib/status-language";
import type { GalleryKindFilter } from "@/lib/media-studio-contract";
import { StudioCreditBalance } from "@/components/studio/studio-metric-pill";

const galleryFilters = [
  { value: "all", label: "All media", icon: Monitor },
  { value: "image", label: "Images", icon: ImageIcon },
  { value: "video", label: "Videos", icon: Play },
  { value: "favorites", label: "Favorites", icon: Heart },
] as const;

const libraryActions = [
  { value: "presets", label: "Media Presets", icon: Layers },
  { value: "references", label: "Reference library", icon: ImageIcon },
];

type StudioHeaderChromeProps = {
  immersive: boolean;
  apiHealthy: boolean;
  galleryModelFilter: string;
  models: Array<{ key: string; label: string }>;
  favoritesOnly: boolean;
  galleryKindFilter: GalleryKindFilter;
  project?: { project_id: string; name: string } | null;
  remainingCredits?: number | null;
  onGalleryModelFilterChange: (value: string) => void;
  onActivateGalleryKindFilter: (value: GalleryKindFilter) => void;
  onToggleFavoritesFilter: () => void;
  onOpenStudio: () => void;
  onOpenGraph: () => void;
  onOpenProjects: () => void;
  onOpenProjectWorkspace: (projectId: string | null) => void;
  onOpenPresets: () => void;
  onOpenLibrary: () => void;
  showLibraryButton?: boolean;
  onOpenSettings: () => void;
};

function HeaderIcon({
  active = false,
  icon,
  label,
  testId,
  onClick,
}: {
  active?: boolean;
  icon: LucideIcon;
  label: string;
  testId?: string;
  onClick: () => void;
}) {
  return (
    <IconButton
      icon={icon}
      data-testid={testId}
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-current={label === "Studio" ? "page" : undefined}
      tone={active ? "primary" : "subtle"}
      size="compact"
      shape="soft"
      className="studio-header-icon"
      iconClassName="size-5"
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
  project,
  remainingCredits,
  onGalleryModelFilterChange,
  onActivateGalleryKindFilter,
  onToggleFavoritesFilter,
  onOpenStudio,
  onOpenGraph,
  onOpenProjects,
  onOpenProjectWorkspace,
  onOpenPresets,
  onOpenLibrary,
  showLibraryButton = true,
  onOpenSettings,
}: StudioHeaderChromeProps) {
  const [openMenu, setOpenMenu] = useState<"media" | "library" | null>(null);
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

  function toggleMenu(menu: "media" | "library") {
    setOpenMenu(openMenu === menu ? null : menu);
  }
  return (
    <header className="studio-header-chrome-root">
      <nav className="studio-header-filter-row" aria-label="Studio navigation">
        <div className="studio-header-view-switch">
          <HeaderIcon
            active
            icon={ImageIcon}
            label="Studio"
            onClick={onOpenStudio}
          />
          <HeaderIcon icon={Workflow} label="Graph" onClick={onOpenGraph} />
        </div>
        <HeaderIcon
          active={Boolean(project)}
          icon={Folders}
          label="Projects"
          testId="studio-filter-projects"
          onClick={onOpenProjects}
        />
        <StudioGalleryFilterMenu
          selected={favoritesOnly ? "favorites" : galleryKindFilter}
          open={openMenu === "media"}
          onToggle={() => toggleMenu("media")}
          onClose={() => setOpenMenu(null)}
          onActivate={onActivateGalleryKindFilter}
          onToggleFavorites={onToggleFavoritesFilter}
        />
      </nav>
      <div className="studio-header-project">
        <StudioHeaderProject
          project={project}
          onOpenProject={onOpenProjectWorkspace}
        />
      </div>
      <div className="studio-header-metrics-row">
        <StudioLibraryMenu
          open={openMenu === "library"}
          onToggle={() => toggleMenu("library")}
          onClose={() => setOpenMenu(null)}
          onOpenPresets={onOpenPresets}
          onOpenLibrary={showLibraryButton ? onOpenLibrary : undefined}
        />
        <HeaderIcon
          icon={Settings2}
          label="Settings"
          testId="studio-filter-settings"
          onClick={onOpenSettings}
        />
        <StudioCreditBalance
          remaining={remainingCredits}
          className="studio-header-balance"
        />
      </div>
    </header>
  );
}

function StudioGalleryFilterMenu({
  selected,
  open,
  onToggle,
  onClose,
  onActivate,
  onToggleFavorites,
}: {
  selected: GalleryKindFilter | "favorites";
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onActivate: (kind: GalleryKindFilter) => void;
  onToggleFavorites: () => void;
}) {
  return (
    <div className="studio-header-menu-group">
      <PillSelect
        pickerId="gallery-media"
        className="studio-header-menu"
        open={open}
        onToggle={onToggle}
        onClose={onClose}
        label={
          galleryFilters.find(({ value }) => value === selected)?.label ??
          "All media"
        }
        choices={[...galleryFilters]}
        choiceIcon={(choice) =>
          galleryFilters.find(({ value }) => value === choice.value)?.icon
        }
        selectedValue={selected}
        selectedChoiceFirst={false}
        onSelect={(value) => {
          const filter = galleryFilters.find(
            (filter) => filter.value === value,
          );
          if (!filter) return;
          if (filter.value === "favorites") onToggleFavorites();
          else onActivate(filter.value);
        }}
      />
    </div>
  );
}

function StudioLibraryMenu({
  open,
  onToggle,
  onClose,
  onOpenPresets,
  onOpenLibrary,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onOpenPresets: () => void;
  onOpenLibrary?: () => void;
}) {
  return (
    <PillSelect
      pickerId="studio-library"
      className="studio-header-menu studio-header-library"
      open={open}
      onToggle={onToggle}
      onClose={onClose}
      icon={FolderOpen}
      label="Library"
      choices={onOpenLibrary ? libraryActions : libraryActions.slice(0, 1)}
      choiceIcon={(choice) =>
        libraryActions.find(({ value }) => value === choice.value)?.icon
      }
      onSelect={(value) => {
        if (value === "presets") onOpenPresets();
        else if (value === "references") onOpenLibrary?.();
      }}
    />
  );
}

function StudioHeaderProject({
  project,
  onOpenProject,
}: {
  project: StudioHeaderChromeProps["project"];
  onOpenProject: StudioHeaderChromeProps["onOpenProjectWorkspace"];
}) {
  if (!project) return null;
  return (
    <div className="studio-project-metric">
      <button
        type="button"
        onClick={() => onOpenProject(project.project_id)}
        className="studio-project-metric-name"
        aria-label={`Open project ${project.name}`}
        title={project.name}
      >
        {project.name}
      </button>
      <button
        type="button"
        onClick={() => onOpenProject(null)}
        className="studio-project-metric-close"
        aria-label="Exit project workspace"
        title="Exit project workspace"
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  );
}

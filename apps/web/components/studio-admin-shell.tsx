import Link from "next/link";
import type { ReactNode } from "react";

import {
  studioAdminNavClassName,
  studioAdminPageIntroClassName,
  studioAdminShellClassName,
} from "@/components/admin-theme";
import { buildStudioScopedHref } from "@/lib/studio-navigation";
import { MEDIA_STUDIO_VERSION } from "@/lib/app-version";

type StudioAdminShellProps = {
  section: "setup" | "studio" | "graph" | "settings" | "models" | "presets" | "jobs" | "pricing";
  title: string;
  description: string;
  eyebrow?: string;
  children: ReactNode;
  aside?: ReactNode;
  currentProjectId?: string | null;
};

const navItems = [
  { key: "studio", label: "Studio", href: "/studio" },
  { key: "graph", label: "Graph", href: "/graph-studio" },
  { key: "settings", label: "Settings", href: "/settings" },
  { key: "models", label: "Image / Video Models", href: "/models" },
  { key: "presets", label: "Presets", href: "/presets" },
  { key: "jobs", label: "Jobs", href: "/jobs" },
  { key: "pricing", label: "Pricing", href: "/pricing" },
] as const;

export function StudioAdminShell({
  section,
  title,
  description,
  eyebrow = "Studio Admin",
  children,
  aside,
  currentProjectId = null,
}: StudioAdminShellProps) {
  return (
    <div className="admin-theme-root admin-page-background">
    <div className={studioAdminShellClassName}>
      <header>
        <nav className={studioAdminNavClassName} aria-label="Main navigation">
          <span className="admin-brand">Media Studio</span>
          <div className="admin-nav-links">
          {navItems.map((item) => {
            const active = item.key === section;
            return (
              <Link
                key={item.key}
                href={buildStudioScopedHref(item.href, currentProjectId)}
                className="admin-nav-link"
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
          </div>
          <div className="ml-auto flex items-center gap-3">
            {aside ? aside : null}
            <span
              className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]"
              title="Media Studio version"
            >
              {MEDIA_STUDIO_VERSION}
            </span>
          </div>
        </nav>
        <div className={studioAdminPageIntroClassName}>
          <div className="admin-page-eyebrow">{eyebrow}</div>
          <h1 className="admin-page-title">
            {title}
          </h1>
          <p className="admin-page-description">{description}</p>
        </div>
      </header>
      <main className="admin-section-stack">{children}</main>
    </div>
    </div>
  );
}

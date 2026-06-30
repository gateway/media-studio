import Link from "next/link";
import type { ReactNode } from "react";

import {
  adminSectionStackClassName,
  studioAdminNavClassName,
  studioAdminPageIntroClassName,
  studioAdminShellClassName,
} from "@/components/admin-theme";
import { buildStudioScopedHref } from "@/lib/studio-navigation";
import { MEDIA_STUDIO_VERSION } from "@/lib/app-version";
import { cn } from "@/lib/utils";

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
  { key: "models", label: "Models", href: "/models" },
  { key: "presets", label: "Presets", href: "/presets" },
  { key: "jobs", label: "Jobs", href: "/jobs" },
  { key: "pricing", label: "Pricing", href: "/pricing" },
  { key: "setup", label: "Setup", href: "/setup" },
] as const;

const adminNavLinkBaseClassName = "text-sm font-semibold tracking-[-0.01em] transition";
const adminNavLinkActiveClassName = "text-[var(--ms-accent)]";
const adminNavLinkInactiveClassName = "text-[var(--muted-strong)] hover:text-[var(--foreground)]";

function adminNavLinkClassName(active: boolean) {
  return cn(
    adminNavLinkBaseClassName,
    active ? adminNavLinkActiveClassName : adminNavLinkInactiveClassName,
  );
}

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
    <div className={studioAdminShellClassName}>
      <div className={adminSectionStackClassName}>
        <div className={studioAdminNavClassName}>
          {navItems.map((item) => {
            const active = item.key === section;
            return (
              <Link
                key={item.key}
                href={buildStudioScopedHref(item.href, currentProjectId)}
                className={adminNavLinkClassName(active)}
              >
                {item.label}
              </Link>
            );
          })}
          <div className="ml-auto flex items-center gap-3">
            {aside ? aside : null}
            <span
              className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]"
              title="Media Studio version"
            >
              {MEDIA_STUDIO_VERSION}
            </span>
          </div>
        </div>
        <div className={studioAdminPageIntroClassName}>
          <div className="admin-page-eyebrow">{eyebrow}</div>
          <h1 className="admin-page-title sm:text-[2.4rem]">
            {title}
          </h1>
          <p className="admin-page-description sm:text-[0.98rem]">{description}</p>
        </div>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

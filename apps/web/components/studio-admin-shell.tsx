import Link from "next/link";
import type { ReactNode } from "react";

import { buildStudioScopedHref } from "@/lib/studio-navigation";
import { MEDIA_STUDIO_VERSION } from "@/lib/app-version";
import { cn } from "@/lib/utils";

type StudioAdminShellProps = {
  section: "setup" | "studio" | "settings" | "models" | "presets" | "jobs" | "pricing";
  title: string;
  description: string;
  eyebrow?: string;
  children: ReactNode;
  aside?: ReactNode;
  currentProjectId?: string | null;
};

const navItems = [
  { key: "studio", label: "Studio", href: "/studio" },
  { key: "settings", label: "Settings", href: "/settings" },
  { key: "models", label: "Models", href: "/models" },
  { key: "presets", label: "Presets", href: "/presets" },
  { key: "jobs", label: "Jobs", href: "/jobs" },
  { key: "pricing", label: "Pricing", href: "/pricing" },
  { key: "setup", label: "Setup", href: "/setup" },
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
    <div className="admin-theme-root mx-auto flex min-h-screen w-full max-w-[1560px] flex-col gap-8 px-4 pb-10 pt-8 sm:px-6 lg:px-8">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-white/8 pb-3">
          {navItems.map((item) => {
            const active = item.key === section;
            return (
              <Link
                key={item.key}
                href={buildStudioScopedHref(item.href, currentProjectId)}
                className={cn(
                  "text-sm font-semibold tracking-[-0.01em] transition",
                  active ? "text-[var(--ms-accent)]" : "text-white/66 hover:text-white",
                )}
              >
                {item.label}
              </Link>
            );
          })}
          <div className="ml-auto flex items-center gap-3">
            {aside ? aside : null}
            <span
              className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-white/54"
              title="Media Studio version"
            >
              {MEDIA_STUDIO_VERSION}
            </span>
          </div>
        </div>
        <div className="space-y-3">
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

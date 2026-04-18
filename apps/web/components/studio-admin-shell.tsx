import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type StudioAdminShellProps = {
  section: "setup" | "studio" | "settings" | "models" | "presets" | "jobs" | "pricing";
  title: string;
  description: string;
  eyebrow?: string;
  children: ReactNode;
  aside?: ReactNode;
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
                href={item.href}
                className={cn(
                  "text-sm font-semibold tracking-[-0.01em] transition",
                  active ? "text-[var(--ms-accent)]" : "text-white/66 hover:text-white",
                )}
              >
                {item.label}
              </Link>
            );
          })}
          {aside ? <div className="ml-auto">{aside}</div> : null}
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

"use client";

import { useRouter } from "next/navigation";

import { buildStudioScopedHref } from "@/lib/studio-navigation";

export function AdminSectionTabs({ items, activeKey, currentProjectId = null }: {
  items: readonly { key: string; label: string; href: string }[];
  activeKey: string;
  currentProjectId?: string | null;
}) {
  const router = useRouter();
  return (
    <nav className="admin-tabs" aria-label="Section navigation">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className="admin-tab"
          aria-current={item.key === activeKey ? "page" : undefined}
          disabled={item.key === activeKey}
          onClick={() => router.push(buildStudioScopedHref(item.href, currentProjectId))}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}

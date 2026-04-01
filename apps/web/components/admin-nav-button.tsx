"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { AdminButton } from "@/components/admin-controls";

export function AdminNavButton({
  href,
  children,
  variant = "primary",
  size = "default",
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "subtle" | "danger";
  size?: "default" | "compact";
  className?: string;
}) {
  const router = useRouter();

  return (
    <AdminButton variant={variant} size={size} className={className} onClick={() => router.push(href)}>
      {children}
    </AdminButton>
  );
}

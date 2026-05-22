"use client";

import { useRouter } from "next/navigation";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { AdminButton } from "@/components/admin-controls";

export function AdminNavButton({
  href,
  children,
  variant = "primary",
  size = "default",
  className,
  external = false,
  onClick,
  ...props
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "subtle" | "danger";
  size?: "default" | "compact";
  className?: string;
  external?: boolean;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  const router = useRouter();

  return (
    <AdminButton
      {...props}
      variant={variant}
      size={size}
      className={className}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) {
          return;
        }
        if (external) {
          window.open(href, "_blank", "noopener,noreferrer");
          return;
        }
        router.push(href);
      }}
    >
      {children}
    </AdminButton>
  );
}

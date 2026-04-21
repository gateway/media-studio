import { surfaceCardClassName, surfaceInsetClassName } from "@/components/ui/surface-primitives";

export const adminThemeVarsClassName = "admin-theme-root";

export const adminThemeLayoutClassName = `grid min-w-0 gap-6 ${adminThemeVarsClassName}`;
export const adminThemeLayoutOverflowClassName = `${adminThemeLayoutClassName} overflow-x-hidden`;

export const adminSurfaceCardClassName =
  surfaceCardClassName({ appearance: "admin" });

export const adminStatCardClassName =
  surfaceInsetClassName({ appearance: "admin" });

export const adminInsetCompactClassName =
  surfaceInsetClassName({ appearance: "admin", density: "compact" });

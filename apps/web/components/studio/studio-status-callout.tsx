"use client";

import type { ReactNode } from "react";

import { CalloutPanel } from "@/components/ui/surface-primitives";
import type { SurfaceTone } from "@/components/ui/surface-primitives";
import { cn } from "@/lib/utils";

type StudioStatusCalloutProps = {
  tone?: SurfaceTone;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
  titleClassName?: string;
  descriptionClassName?: string;
};

export function StudioStatusCallout({
  tone = "muted",
  title,
  description,
  action,
  icon,
  className,
  titleClassName,
  descriptionClassName,
}: StudioStatusCalloutProps) {
  return (
    <CalloutPanel tone={tone} className={cn("rounded-[24px] px-5 py-6", className)}>
      <div className="grid gap-4">
        {icon ? <div className="flex justify-center">{icon}</div> : null}
        <div className="grid gap-2">
          <div className={cn("text-sm font-semibold text-white/88", icon ? "text-center" : "", titleClassName)}>{title}</div>
          {description ? (
            <div className={cn("text-sm leading-7 text-white/64", icon ? "text-center" : "", descriptionClassName)}>
              {description}
            </div>
          ) : null}
        </div>
        {action ? <div className={icon ? "flex justify-center" : ""}>{action}</div> : null}
      </div>
    </CalloutPanel>
  );
}

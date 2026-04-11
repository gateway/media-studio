"use client";

import { ToastBanner } from "@/components/ui/toast-banner";

export function AdminActionNotice({
  tone,
  text,
}: {
  tone: "healthy" | "danger";
  text: string;
}) {
  return (
    <div className="fixed inset-x-0 top-6 z-[200] flex justify-center px-4">
      <ToastBanner tone={tone} message={text} appearance="admin" className="min-w-[280px] max-w-[640px]" />
    </div>
  );
}

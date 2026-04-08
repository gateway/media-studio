"use client";

import { startTransition, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { useRouter } from "next/navigation";

import { AdminActionNotice } from "@/components/admin-action-notice";
import { AdminButton } from "@/components/admin-controls";
import { useAdminActionNotice } from "@/hooks/use-admin-action-notice";
import { cn } from "@/lib/utils";

export function PricingRefreshAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { notice, showNotice } = useAdminActionNotice();

  async function handleRefresh() {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/control/media/pricing/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        let errorText = "Pricing refresh failed.";
        try {
          const payload = (await response.json()) as { detail?: string; error?: string; message?: string };
          errorText = payload.error || payload.detail || payload.message || errorText;
        } catch {
          // keep generic message
        }
        showNotice("danger", errorText, 4200);
        return;
      }

      showNotice("healthy", "Pricing catalog refreshed.");
      startTransition(() => {
        router.refresh();
      });
    } catch {
      showNotice("danger", "Pricing refresh failed.", 4200);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AdminButton variant="primary" size="compact" onClick={() => void handleRefresh()} disabled={busy}>
        <RefreshCcw className={cn("mr-2 size-3.5", busy ? "animate-[spin_1.1s_linear_infinite]" : "")} />
        {busy ? "Refreshing" : "Refresh pricing"}
      </AdminButton>
      {notice ? <AdminActionNotice tone={notice.tone} text={notice.text} /> : null}
    </>
  );
}

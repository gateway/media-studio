"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdminActionNotice } from "@/components/admin-action-notice";
import { AdminButton } from "@/components/admin-controls";
import { useAdminActionNotice } from "@/hooks/use-admin-action-notice";

export function MediaBatchActions({
  batchId,
  canCancelQueued,
}: {
  batchId: string;
  canCancelQueued: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const { notice, showNotice } = useAdminActionNotice(2200);

  if (!canCancelQueued) {
    return null;
  }

  async function cancelQueued() {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(`/api/control/media-batches/${batchId}`, {
        method: "POST",
      });
      if (!response.ok) {
        showNotice("danger", "Unable to cancel queued jobs for this batch.");
        return;
      }
      showNotice("healthy", "Queued jobs cancelled.");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {notice ? <AdminActionNotice tone={notice.tone} text={notice.text} /> : null}
      <AdminButton onClick={() => void cancelQueued()} disabled={submitting} variant="danger">
        {submitting ? "Cancelling…" : "Cancel Queued"}
      </AdminButton>
    </>
  );
}

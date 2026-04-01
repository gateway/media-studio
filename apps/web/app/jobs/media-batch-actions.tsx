"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdminActionNotice } from "@/components/admin-action-notice";
import { AdminButton } from "@/components/admin-controls";

export function MediaBatchActions({
  batchId,
  canCancelQueued,
}: {
  batchId: string;
  canCancelQueued: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ tone: "healthy" | "danger"; text: string } | null>(null);

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
        setNotice({ tone: "danger", text: "Unable to cancel queued jobs for this batch." });
        return;
      }
      setNotice({ tone: "healthy", text: "Queued jobs cancelled." });
      router.refresh();
    } finally {
      setSubmitting(false);
      window.setTimeout(() => setNotice(null), 2200);
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

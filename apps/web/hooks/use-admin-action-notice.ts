"use client";

import { useCallback, useEffect, useState } from "react";

export type AdminActionNoticeState = {
  tone: "healthy" | "danger";
  text: string;
  autoHideMs: number;
};

export function useAdminActionNotice(defaultAutoHideMs = 2400) {
  const [notice, setNotice] = useState<AdminActionNoticeState | null>(null);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timeoutId = window.setTimeout(() => setNotice(null), notice.autoHideMs);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const showNotice = useCallback(
    (tone: "healthy" | "danger", text: string, autoHideMs = defaultAutoHideMs) => {
      setNotice({ tone, text, autoHideMs });
    },
    [defaultAutoHideMs],
  );

  const clearNotice = useCallback(() => {
    setNotice(null);
  }, []);

  return {
    notice,
    setNotice,
    showNotice,
    clearNotice,
  };
}

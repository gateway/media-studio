"use client";

import { useEffect, useState } from "react";

import { AdminActionNotice } from "@/components/admin-action-notice";
import { AdminButton, adminInsetCardClassName } from "@/components/admin-controls";

type RuntimeServiceState = {
  service: "api" | "web";
  supervisor: "launchd" | "manual" | "unknown";
  status: "running" | "failed" | "inactive";
  manageable: boolean;
  detail: string;
};

type RuntimePayload = {
  ok: boolean;
  services: {
    api: RuntimeServiceState;
    web: RuntimeServiceState;
  };
};

export function RuntimeControls() {
  const [services, setServices] = useState<RuntimePayload["services"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [restarting, setRestarting] = useState<"api" | "web" | null>(null);
  const [notice, setNotice] = useState<{ tone: "healthy" | "danger"; text: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/control/runtime", { cache: "no-store" });
      const payload = (await response.json()) as RuntimePayload;
      if (!response.ok || !payload.ok) {
        throw new Error("Unable to load runtime controls.");
      }
      setServices(payload.services);
    } catch (error) {
      setNotice({
        tone: "danger",
        text: error instanceof Error ? error.message : "Unable to load runtime controls.",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timeout = window.setTimeout(() => setNotice(null), 2400);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  async function restartService(service: "api" | "web") {
    if (restarting) {
      return;
    }
    setRestarting(service);
    try {
      const response = await fetch("/api/control/runtime", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ service, action: "restart" }),
      });
      const payload = (await response.json()) as { ok: boolean; message?: string; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? `Unable to restart ${service}.`);
      }
      setNotice({ tone: "healthy", text: payload.message ?? `Restart scheduled for ${service}.` });
      window.setTimeout(() => {
        void load();
      }, 1800);
    } catch (error) {
      setNotice({
        tone: "danger",
        text: error instanceof Error ? error.message : `Unable to restart ${service}.`,
      });
    } finally {
      setRestarting(null);
    }
  }

  if (loading && !services) {
    return (
      <div className={`${adminInsetCardClassName} text-sm text-[var(--muted-strong)]`}>
        Loading runtime controls…
      </div>
    );
  }

  if (!services) {
    return null;
  }

  return (
    <>
      {notice ? <AdminActionNotice tone={notice.tone} text={notice.text} /> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {([services.api, services.web] as RuntimeServiceState[]).map((service) => (
          <div key={service.service} className={adminInsetCardClassName}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white/54">
                  {service.service === "api" ? "API runtime" : "Web runtime"}
                </div>
                <div className="mt-1 text-sm font-medium text-[var(--foreground)]">
                  {service.supervisor === "unknown" ? "Unknown" : service.supervisor}
                </div>
                <div className="mt-1 text-sm text-[var(--muted-strong)]">{service.detail}</div>
              </div>
              <div className="text-right text-xs uppercase tracking-[0.12em] text-[var(--muted-strong)]">
                {service.status}
              </div>
            </div>
            <div className="mt-3">
              <AdminButton
                variant="primary"
                size="compact"
                onClick={() => void restartService(service.service)}
                disabled={!service.manageable || restarting != null}
              >
                {restarting === service.service ? "Restarting…" : `Restart ${service.service}`}
              </AdminButton>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

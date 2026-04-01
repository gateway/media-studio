"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";

type GlobalActivityTone = "warning" | "healthy" | "danger";

type GlobalActivityPayload = {
  tone: GlobalActivityTone;
  message: string;
  progress?: number | null;
  spinning?: boolean;
};

type GlobalActivityContextValue = {
  showActivity: (activity: GlobalActivityPayload, options?: { autoHideMs?: number }) => void;
  clearActivity: () => void;
};

const GlobalActivityContext = createContext<GlobalActivityContextValue | null>(null);

function toneClasses(tone: GlobalActivityTone) {
  if (tone === "healthy") {
    return "border-[rgba(81,136,111,0.2)] bg-[rgba(235,245,240,0.96)] text-[var(--success)]";
  }

  if (tone === "danger") {
    return "border-[rgba(175,79,64,0.22)] bg-[rgba(255,242,239,0.97)] text-[var(--danger)]";
  }

  return "border-[rgba(204,135,51,0.2)] bg-[rgba(255,249,239,0.97)] text-[var(--warning)]";
}

function titleForTone(tone: GlobalActivityTone) {
  if (tone === "healthy") {
    return "Completed";
  }

  if (tone === "danger") {
    return "Needs attention";
  }

  return "Working";
}

export function GlobalActivityProvider({ children }: { children: React.ReactNode }) {
  const [activity, setActivity] = useState<GlobalActivityPayload | null>(null);
  const hideTimer = useRef<number | null>(null);

  const clearActivity = useCallback(() => {
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setActivity(null);
  }, []);

  const showActivity = useCallback(
    (next: GlobalActivityPayload, options?: { autoHideMs?: number }) => {
      if (hideTimer.current) {
        window.clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }

      setActivity(next);

      if (options?.autoHideMs) {
        hideTimer.current = window.setTimeout(() => {
          setActivity(null);
          hideTimer.current = null;
        }, options.autoHideMs);
      }
    },
    [],
  );

  useEffect(() => clearActivity, [clearActivity]);

  return (
    <GlobalActivityContext.Provider value={{ showActivity, clearActivity }}>
      {children}
      {activity ? (
        <div className="pointer-events-none fixed right-4 top-4 z-[90] w-[min(28rem,calc(100vw-2rem))]">
          <div
            aria-live="polite"
            className={cn(
              "rounded-[24px] border px-4 py-4 shadow-[0_24px_48px_rgba(67,51,33,0.16)] backdrop-blur-xl",
              toneClasses(activity.tone),
            )}
          >
            <div className="flex items-start gap-3">
              {activity.spinning ? (
                <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent" />
              ) : (
                <span className="mt-1 inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-current" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] opacity-75">
                  Dashboard activity
                </div>
                <div className="mt-1 text-sm font-semibold tracking-[-0.02em]">
                  {titleForTone(activity.tone)}
                </div>
                <p className="mt-1 text-sm leading-6 text-[var(--foreground)]">{activity.message}</p>
                {typeof activity.progress === "number" ? (
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/6">
                    <div
                      className="h-full rounded-full bg-current transition-[width] duration-300"
                      style={{ width: `${Math.max(8, Math.min(100, activity.progress))}%` }}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </GlobalActivityContext.Provider>
  );
}

export function useGlobalActivity() {
  const context = useContext(GlobalActivityContext);

  if (context) {
    return context;
  }

  return {
    showActivity: () => undefined,
    clearActivity: () => undefined,
  };
}

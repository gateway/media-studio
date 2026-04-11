"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { ToastBanner, type FeedbackIntent } from "@/components/ui/toast-banner";

type GlobalActivityTone = FeedbackIntent;

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

function titleForTone(tone: GlobalActivityTone) {
  if (tone === "healthy") {
    return "Done";
  }

  if (tone === "danger") {
    return "Heads up";
  }

  if (tone === "warning") {
    return "Notice";
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
        <div className="pointer-events-none fixed right-5 top-5 z-[90] w-[min(28rem,calc(100vw-2.5rem))] md:right-7 md:top-7 md:w-[min(28rem,calc(100vw-3.5rem))]">
          <div aria-live="polite">
            <ToastBanner
              tone={activity.tone}
              title={`Studio update · ${titleForTone(activity.tone)}`}
              message={activity.message}
              appearance="admin"
              spinning={activity.spinning ?? activity.tone === "working"}
              progress={activity.progress}
              className="rounded-[24px]"
            />
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

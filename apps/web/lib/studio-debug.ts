"use client";

const STUDIO_DEBUG_STORAGE_KEY = "media-studio-debug-console";

declare global {
  interface Window {
    __mediaStudioDebug?: {
      enable: () => void;
      disable: () => void;
      enabled: () => boolean;
      log: (channel: string, payload: unknown) => void;
    };
  }
}

function readStoredDebugFlag() {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(STUDIO_DEBUG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function isStudioDebugEnabled() {
  if (process.env.NEXT_PUBLIC_MEDIA_STUDIO_DEBUG === "1") {
    return true;
  }
  return readStoredDebugFlag();
}

export function setStudioDebugEnabled(enabled: boolean) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (enabled) {
      window.localStorage.setItem(STUDIO_DEBUG_STORAGE_KEY, "1");
    } else {
      window.localStorage.removeItem(STUDIO_DEBUG_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures in locked-down browsers.
  }
}

export function studioDebug(channel: string, payload: unknown) {
  if (!isStudioDebugEnabled()) {
    return;
  }
  globalThis.console?.debug?.(`[Media Studio][${channel}]`, payload);
}

export function installStudioDebugConsole() {
  if (typeof window === "undefined") {
    return;
  }
  if (window.__mediaStudioDebug) {
    return;
  }
  window.__mediaStudioDebug = {
    enable: () => {
      setStudioDebugEnabled(true);
      globalThis.console?.info?.("[Media Studio][debug] enabled");
    },
    disable: () => {
      setStudioDebugEnabled(false);
      globalThis.console?.info?.("[Media Studio][debug] disabled");
    },
    enabled: () => isStudioDebugEnabled(),
    log: (channel, payload) => studioDebug(channel, payload),
  };
}

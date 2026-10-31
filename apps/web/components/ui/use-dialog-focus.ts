"use client";
import { useEffect, useRef } from "react";

function isVisibleControl(element: HTMLElement, panel: HTMLElement) {
  for (let current: HTMLElement | null = element; current && current !== panel; current = current.parentElement) {
    const style = window.getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
}

function containTabFocus(event: KeyboardEvent, panel: HTMLElement) {
  const controls = Array.from(
    panel.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
    ),
  ).filter(
    (element) =>
      !element.closest("[hidden], [inert]") &&
      element.getAttribute("aria-hidden") !== "true" &&
      isVisibleControl(element, panel),
  );
  const first = controls[0];
  const last = controls.at(-1);
  if (!first) {
    event.preventDefault();
    return;
  }
  const active = document.activeElement;
  if (event.shiftKey && [first, panel].includes(active as HTMLElement)) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && [last, panel].includes(active as HTMLElement)) {
    event.preventDefault();
    first.focus();
  }
}

/** Own keyboard focus only while this is the topmost dialog. */
export function useDialogFocus(onClose: () => void, suspended = false) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const returnFocus = useRef<HTMLElement | null>(null);
  const resumeFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (suspended) return;
    const panel = panelRef.current;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    returnFocus.current ??= previousFocus;
    const target = resumeFocus.current;
    if (target && panel?.contains(target)) target.focus();
    else panel?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || !panel) return;
      if (event.key === "Escape") {
        // A picker owns the first Escape while its menu is open.
        if (panel.querySelector('[data-studio-picker] [aria-expanded="true"]'))
          return;
        event.preventDefault();
        closeRef.current();
      }
      if (event.key === "Tab") containTabFocus(event, panel);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      const active = document.activeElement;
      if (active instanceof HTMLElement && panel?.contains(active))
        resumeFocus.current = active;
      returnFocus.current?.focus();
    };
  }, [suspended]);
  return panelRef;
}

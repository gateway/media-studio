export type StudioComposerRevealOptions = {
  focusPresetField?: boolean;
  scroll?: boolean;
};

export function mobileComposerCollapsedForProgrammaticExpand(isCoarsePointer: boolean) {
  return !isCoarsePointer;
}

type RevealComposerElements = {
  composerRoot: HTMLElement | null;
  promptInput: HTMLElement | null;
};

function focusElement(element: HTMLElement | null, preventScroll: boolean) {
  if (!element) {
    return;
  }

  if (preventScroll) {
    element.focus({ preventScroll: true });
    return;
  }

  element.focus();
}

export function revealStudioComposer(elements: RevealComposerElements, options: StudioComposerRevealOptions = {}) {
  const { composerRoot, promptInput } = elements;
  if (!composerRoot) {
    return;
  }

  const shouldScroll = options.scroll ?? true;
  if (shouldScroll) {
    composerRoot.scrollIntoView({ block: "end", behavior: "smooth" });
  }

  const focusTarget = options.focusPresetField
    ? ((composerRoot.querySelector("input[placeholder], input[type='text'], textarea") as HTMLElement | null) ?? promptInput)
    : promptInput;

  focusElement(focusTarget, !shouldScroll);
}

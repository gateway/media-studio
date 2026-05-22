export type StudioShortcutAction = "open-graph" | "open-projects" | "open-presets" | "open-settings" | "open-library" | null;

export function resolveStudioShortcutAction({
  key,
  hasModifier,
  typing,
  overlayOpen,
}: {
  key: string;
  hasModifier: boolean;
  typing: boolean;
  overlayOpen: boolean;
}): StudioShortcutAction {
  if (hasModifier || typing || overlayOpen) {
    return null;
  }
  switch (key.toLowerCase()) {
    case "g":
      return "open-projects";
    case "n":
      return "open-graph";
    case "p":
      return "open-presets";
    case "s":
      return "open-settings";
    case "i":
      return "open-library";
    default:
      return null;
  }
}

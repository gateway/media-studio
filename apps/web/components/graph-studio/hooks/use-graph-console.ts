import { useCallback, useState } from "react";

export function useGraphConsole(initialLine = "Graph Studio ready.") {
  const [consoleLines, setConsoleLines] = useState<string[]>([initialLine]);
  const appendConsole = useCallback((line: string) => {
    setConsoleLines((current) => [line, ...current].slice(0, 80));
  }, []);
  return { consoleLines, setConsoleLines, appendConsole };
}

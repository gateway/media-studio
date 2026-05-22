export type GraphHandleDirection = "input" | "output";

const INPUT_PREFIX = "in:";
const OUTPUT_PREFIX = "out:";

export function inputGraphHandleId(portId: string | null | undefined): string {
  return `${INPUT_PREFIX}${portId ?? ""}`;
}

export function outputGraphHandleId(portId: string | null | undefined): string {
  return `${OUTPUT_PREFIX}${portId ?? ""}`;
}

export function graphHandleDirection(handleId: string | null | undefined): GraphHandleDirection | null {
  if (!handleId) return null;
  if (handleId.startsWith(INPUT_PREFIX)) return "input";
  if (handleId.startsWith(OUTPUT_PREFIX)) return "output";
  return null;
}

export function graphPortIdFromHandle(handleId: string | null | undefined): string | null {
  if (!handleId) return null;
  if (handleId.startsWith(INPUT_PREFIX)) return handleId.slice(INPUT_PREFIX.length);
  if (handleId.startsWith(OUTPUT_PREFIX)) return handleId.slice(OUTPUT_PREFIX.length);
  return handleId;
}

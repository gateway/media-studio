export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function formatDateTime(value?: string | null) {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatNumber(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a";
  }

  return new Intl.NumberFormat("en-US", {
    notation: value > 999 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatPercent(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a";
  }

  return `${value.toFixed(1)}%`;
}

export function formatDurationMs(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a";
  }

  if (value < 1000) {
    return `${Math.round(value)} ms`;
  }

  const totalSeconds = Math.round(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}

export function formatBytes(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  const units = ["KB", "MB", "GB"];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

export function truncate(text: string, max = 180) {
  if (text.length <= max) {
    return text;
  }

  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export function stripMarkdown(text: string) {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/[`*_>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugify(text: string) {
  return slugifyKey(text, 48);
}

export function slugifyKey(text: string, max = 80) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
}

export function formatUsdAmount(
  value: unknown,
  fallback: string | null = "n/a",
  {
    minimumFractionDigits,
    maximumFractionDigits,
  }: {
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
  } = {},
) {
  const amount = toFiniteNumber(value);
  if (amount == null) {
    return fallback;
  }
  const resolvedMinimumFractionDigits = minimumFractionDigits ?? (amount < 1 ? 2 : 0);
  const resolvedMaximumFractionDigits = maximumFractionDigits ?? (amount < 1 ? 2 : 2);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: resolvedMinimumFractionDigits,
    maximumFractionDigits: resolvedMaximumFractionDigits,
  }).format(amount);
}

export function formatCreditsAmount(
  value: unknown,
  { fallback = "n/a", suffix = "" }: { fallback?: string | null; suffix?: string } = {},
) {
  const amount = toFiniteNumber(value);
  if (amount == null) {
    return fallback;
  }
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: amount % 1 === 0 ? 0 : 1,
  }).format(amount);
  return suffix ? `${formatted}${suffix}` : formatted;
}

export function splitSummary(text: string) {
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function firstSentence(text: string) {
  const clean = stripMarkdown(text);
  const match = clean.match(/(.+?[.!?])(\s|$)/);
  return match ? match[1] : truncate(clean, 140);
}

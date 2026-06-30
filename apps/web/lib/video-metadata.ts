export type VideoMetadataSourceKind = "file" | "blob-url" | "asset" | "reference" | "remote-url";

export type VideoMetadata = {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  mimeType: string | null;
  sizeBytes: number | null;
  sourceKind: VideoMetadataSourceKind;
};

export type KnownVideoMetadataInput = {
  durationSeconds?: unknown;
  duration_seconds?: unknown;
  width?: unknown;
  height?: unknown;
  mimeType?: unknown;
  mime_type?: unknown;
  sizeBytes?: unknown;
  size_bytes?: unknown;
  file_size_bytes?: unknown;
  sourceKind?: VideoMetadataSourceKind | null;
};

export type VideoObjectUrlFactory = {
  createObjectURL(source: Blob): string;
  revokeObjectURL(url: string): void;
};

export type ProbeVideoMetadataOptions = {
  timeoutMs?: number;
  objectUrlFactory?: VideoObjectUrlFactory;
};

const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

const COMMON_ASPECT_RATIOS = [
  ["1:1", 1],
  ["2:3", 2 / 3],
  ["3:2", 3 / 2],
  ["3:4", 3 / 4],
  ["4:3", 4 / 3],
  ["4:5", 4 / 5],
  ["5:4", 5 / 4],
  ["9:16", 9 / 16],
  ["16:9", 16 / 9],
  ["21:9", 21 / 9],
] as const;

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function nonNegativeNumber(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed != null && parsed >= 0 ? parsed : null;
}

function positiveNumber(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function emptyVideoMetadata(sourceKind: VideoMetadataSourceKind, partial: Partial<VideoMetadata> = {}): VideoMetadata {
  return {
    durationSeconds: null,
    width: null,
    height: null,
    mimeType: null,
    sizeBytes: null,
    sourceKind,
    ...partial,
  };
}

function defaultObjectUrlFactory(): VideoObjectUrlFactory | null {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function" || typeof URL.revokeObjectURL !== "function") {
    return null;
  }
  return {
    createObjectURL: URL.createObjectURL.bind(URL),
    revokeObjectURL: URL.revokeObjectURL.bind(URL),
  };
}

function sourceKindForProbeSource(source: File | Blob | string): VideoMetadataSourceKind {
  if (typeof source === "string") {
    return source.startsWith("blob:") ? "blob-url" : "remote-url";
  }
  if (typeof File !== "undefined" && source instanceof File) {
    return "file";
  }
  return "blob-url";
}

function sourceMimeType(source: File | Blob | string): string | null {
  return typeof source === "string" ? null : stringValue(source.type);
}

function sourceSizeBytes(source: File | Blob | string): number | null {
  return typeof source === "string" ? null : nonNegativeNumber(source.size);
}

export function normalizeKnownVideoMetadata(
  input: KnownVideoMetadataInput | null | undefined,
  fallbackSourceKind: VideoMetadataSourceKind = "reference",
): VideoMetadata {
  return emptyVideoMetadata(input?.sourceKind ?? fallbackSourceKind, {
    durationSeconds: nonNegativeNumber(input?.durationSeconds ?? input?.duration_seconds),
    width: positiveNumber(input?.width),
    height: positiveNumber(input?.height),
    mimeType: stringValue(input?.mimeType ?? input?.mime_type),
    sizeBytes: nonNegativeNumber(input?.sizeBytes ?? input?.size_bytes ?? input?.file_size_bytes),
  });
}

export function formatVideoDuration(seconds: number | null | undefined): string | null {
  const value = nonNegativeNumber(seconds);
  if (value == null) return null;
  if (value < 60) {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded}s` : `${rounded.toFixed(1)}s`;
  }

  const totalSeconds = Math.round(value);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  return `${minutes}m ${String(remainingSeconds).padStart(2, "0")}s`;
}

export function formatVideoResolution(width: number | null | undefined, height: number | null | undefined): string | null {
  const normalizedWidth = positiveNumber(width);
  const normalizedHeight = positiveNumber(height);
  if (normalizedWidth == null || normalizedHeight == null) return null;
  return `${Math.round(normalizedWidth)}x${Math.round(normalizedHeight)}`;
}

export function formatVideoAspectRatio(width: number | null | undefined, height: number | null | undefined): string | null {
  const normalizedWidth = positiveNumber(width);
  const normalizedHeight = positiveNumber(height);
  if (normalizedWidth == null || normalizedHeight == null) return null;

  const ratio = normalizedWidth / normalizedHeight;
  const nearest = COMMON_ASPECT_RATIOS.reduce(
    (best, item) => (Math.abs(item[1] - ratio) < Math.abs(best[1] - ratio) ? item : best),
    COMMON_ASPECT_RATIOS[0],
  );
  if (Math.abs(nearest[1] - ratio) < 0.025) return nearest[0];
  return `${Math.round(normalizedWidth)}:${Math.round(normalizedHeight)}`;
}

export function videoMetadataLabels(metadata: Pick<VideoMetadata, "durationSeconds" | "width" | "height">) {
  return {
    durationLabel: formatVideoDuration(metadata.durationSeconds),
    aspectLabel: formatVideoAspectRatio(metadata.width, metadata.height),
    resolutionLabel: formatVideoResolution(metadata.width, metadata.height),
  };
}

export function probeVideoMetadata(
  source: File | Blob | string,
  options: ProbeVideoMetadataOptions = {},
): Promise<VideoMetadata> {
  const sourceKind = sourceKindForProbeSource(source);
  const baseMetadata = emptyVideoMetadata(sourceKind, {
    mimeType: sourceMimeType(source),
    sizeBytes: sourceSizeBytes(source),
  });

  if (typeof document === "undefined") {
    return Promise.resolve(baseMetadata);
  }

  const objectUrlFactory = options.objectUrlFactory ?? defaultObjectUrlFactory();
  const ownsObjectUrl = typeof source !== "string";
  if (ownsObjectUrl && !objectUrlFactory) {
    return Promise.resolve(baseMetadata);
  }

  const url = typeof source === "string" ? source : objectUrlFactory!.createObjectURL(source);
  const timeoutMs = Math.max(0, options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS);

  return new Promise((resolve) => {
    const video = document.createElement("video");
    let settled = false;
    let timeout: number | null = null;

    const cleanup = () => {
      if (timeout != null) {
        window.clearTimeout(timeout);
        timeout = null;
      }
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("error", handleError);
      video.removeAttribute("src");
      if (ownsObjectUrl && objectUrlFactory) {
        objectUrlFactory.revokeObjectURL(url);
      }
    };

    const finish = (metadata: VideoMetadata) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(metadata);
    };

    function handleLoadedMetadata() {
      finish({
        ...baseMetadata,
        durationSeconds: nonNegativeNumber(video.duration),
        width: positiveNumber(video.videoWidth),
        height: positiveNumber(video.videoHeight),
      });
    }

    function handleError() {
      finish(baseMetadata);
    }

    timeout = window.setTimeout(() => finish(baseMetadata), timeoutMs);
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("error", handleError);
    video.src = url;
    video.load();
  });
}

import type { MediaModelSummary } from "@/lib/types";

const MAX_IMAGE_UPLOAD_DIMENSION = 4096;
const IMAGE_UPLOAD_QUALITIES = [0.92, 0.86, 0.8, 0.74, 0.68];
const MAX_IMAGE_PREVIEW_DIMENSION = 320;

export function resolveImageMaxBytes(model: MediaModelSummary | null): number | null {
  const inputConstraints = model?.input_constraints;
  if (!inputConstraints || typeof inputConstraints !== "object" || Array.isArray(inputConstraints)) {
    return null;
  }
  const raw = inputConstraints.image_max_mb;
  const imageMaxMb = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(imageMaxMb) || imageMaxMb <= 0) {
    return null;
  }
  return Math.trunc(imageMaxMb * 1024 * 1024);
}

async function loadImageBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file);
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Unable to decode image for upload optimization."));
      element.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function renameFileExtension(name: string, nextExtension: string) {
  const extension = nextExtension.startsWith(".") ? nextExtension : `.${nextExtension}`;
  return name.replace(/\.[^.]+$/, "") + extension;
}

async function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function normalizeImageFileForUpload(file: File, maxBytes: number): Promise<File> {
  if (!file.type.startsWith("image/") || file.size <= maxBytes) {
    return file;
  }

  const source = await loadImageBitmap(file);
  const sourceWidth = "width" in source ? source.width : 0;
  const sourceHeight = "height" in source ? source.height : 0;
  if (!sourceWidth || !sourceHeight) {
    return file;
  }

  let scale = Math.min(1, MAX_IMAGE_UPLOAD_DIMENSION / Math.max(sourceWidth, sourceHeight));
  let bestBlob: Blob | null = null;
  const preferWebp = file.type === "image/png" || file.type === "image/webp";
  const outputType = preferWebp ? "image/webp" : "image/jpeg";
  const outputName = renameFileExtension(file.name, preferWebp ? "webp" : "jpg");

  try {
    for (let index = 0; index < IMAGE_UPLOAD_QUALITIES.length; index += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(sourceWidth * scale));
      canvas.height = Math.max(1, Math.round(sourceHeight * scale));
      const context = canvas.getContext("2d", { alpha: preferWebp });
      if (!context) {
        return file;
      }
      context.drawImage(source as CanvasImageSource, 0, 0, canvas.width, canvas.height);
      const blob = await canvasToBlob(canvas, outputType, IMAGE_UPLOAD_QUALITIES[index]);
      if (!blob) {
        continue;
      }
      if (!bestBlob || blob.size < bestBlob.size) {
        bestBlob = blob;
      }
      if (blob.size <= maxBytes) {
        return new File([blob], outputName, {
          type: outputType,
          lastModified: file.lastModified,
        });
      }
      if (index % 2 === 1) {
        scale *= 0.88;
      }
    }
  } finally {
    if ("close" in source && typeof source.close === "function") {
      source.close();
    }
  }

  if (!bestBlob || bestBlob.size >= file.size) {
    return file;
  }

  return new File([bestBlob], outputName, {
    type: outputType,
    lastModified: file.lastModified,
  });
}

export async function buildAttachmentPreviewUrl(file: File) {
  if (!file.type.startsWith("image/")) {
    return URL.createObjectURL(file);
  }
  const source = await loadImageBitmap(file);
  const sourceWidth = "width" in source ? source.width : 0;
  const sourceHeight = "height" in source ? source.height : 0;
  if (!sourceWidth || !sourceHeight) {
    if ("close" in source && typeof source.close === "function") {
      source.close();
    }
    return URL.createObjectURL(file);
  }
  const scale = Math.min(1, MAX_IMAGE_PREVIEW_DIMENSION / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) {
    if ("close" in source && typeof source.close === "function") {
      source.close();
    }
    return URL.createObjectURL(file);
  }
  context.drawImage(source as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  if ("close" in source && typeof source.close === "function") {
    source.close();
  }
  return canvas.toDataURL(file.type === "image/png" ? "image/png" : "image/webp", 0.84);
}

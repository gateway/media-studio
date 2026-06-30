import { useCallback, useRef, useState } from "react";

import {
  generatedImagePickerPageUrl,
  referenceImagePickerPageUrl,
} from "@/components/media/media-image-picker-sources";
import type { MediaAsset, MediaReference } from "@/lib/types";
import { creditBalanceFromPayload, jsonFetch } from "../utils/graph-api";

const MEDIA_LIBRARY_REFRESH_TTL_MS = 4000;
const GRAPH_MEDIA_LIBRARY_PAGE_LIMIT = 40;
const GRAPH_MEDIA_LIBRARY_INITIAL_ASSET_PAGES = 2;

function mergeAssets(
  current: MediaAsset[],
  next: MediaAsset[],
  preserveAssetIds: string[] = [],
) {
  const byId = new Map(current.map((asset) => [String(asset.asset_id), asset]));
  next.forEach((asset) => byId.set(String(asset.asset_id), asset));
  const sorted = Array.from(byId.values()).sort((left, right) => String(right.created_at ?? "").localeCompare(String(left.created_at ?? "")));
  if (!preserveAssetIds.length) return sorted.slice(0, 80);
  const preserveSet = new Set(preserveAssetIds);
  const preserved = preserveAssetIds
    .map((assetId) => byId.get(assetId))
    .filter((asset): asset is MediaAsset => Boolean(asset));
  return [
    ...preserved,
    ...sorted.filter((asset) => !preserveSet.has(String(asset.asset_id))),
  ].slice(0, 80);
}

function mergeReferences(
  current: MediaReference[],
  next: MediaReference[],
  preserveReferenceIds: string[] = [],
) {
  const byId = new Map(current.map((reference) => [reference.reference_id, reference]));
  next.forEach((reference) => byId.set(reference.reference_id, reference));
  const sorted = Array.from(byId.values()).sort((left, right) => String(right.created_at ?? "").localeCompare(String(left.created_at ?? "")));
  if (!preserveReferenceIds.length) return sorted.slice(0, 80);
  const preserveSet = new Set(preserveReferenceIds);
  const preserved = preserveReferenceIds
    .map((referenceId) => byId.get(referenceId))
    .filter((reference): reference is MediaReference => Boolean(reference));
  return [
    ...preserved,
    ...sorted.filter((reference) => !preserveSet.has(reference.reference_id)),
  ].slice(0, 80);
}

export function useGraphMediaLibrary() {
  const [references, setReferences] = useState<MediaReference[]>([]);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [availableCredits, setAvailableCredits] = useState<number | null>(null);
  const [creditsUnavailable, setCreditsUnavailable] = useState(false);
  const imageAssetsPromiseRef = useRef<Promise<void> | null>(null);
  const referenceMediaPromiseRef = useRef<Promise<void> | null>(null);
  const mediaLibraryPromiseRef = useRef<Promise<void> | null>(null);
  const imageAssetsFetchedAtRef = useRef(0);
  const referenceMediaFetchedAtRef = useRef(0);
  const imageAssetsLoadedRef = useRef(false);
  const referenceMediaLoadedRef = useRef(false);

  const refreshCredits = useCallback(async () => {
    try {
      const payload = await jsonFetch<Record<string, unknown>>("/api/control/media/credits");
      setAvailableCredits(creditBalanceFromPayload(payload));
      setCreditsUnavailable(false);
    } catch {
      setCreditsUnavailable(true);
    }
  }, []);

  const refreshImageAssets = useCallback(async (options?: { force?: boolean }) => {
    const force = options?.force ?? false;
    const freshEnough =
      imageAssetsLoadedRef.current &&
      Date.now() - imageAssetsFetchedAtRef.current < MEDIA_LIBRARY_REFRESH_TTL_MS;
    if (!force && freshEnough) {
      return;
    }
    if (!force && imageAssetsPromiseRef.current) {
      return imageAssetsPromiseRef.current;
    }
    imageAssetsPromiseRef.current = (async () => {
      const nextAssets: MediaAsset[] = [];
      let nextOffset: number | null = 0;
      for (
        let pageIndex = 0;
        pageIndex < GRAPH_MEDIA_LIBRARY_INITIAL_ASSET_PAGES && nextOffset != null;
        pageIndex += 1
      ) {
        const payload: { assets?: MediaAsset[]; next_offset?: number | null } = await jsonFetch(
          generatedImagePickerPageUrl(nextOffset, null, GRAPH_MEDIA_LIBRARY_PAGE_LIMIT),
        );
        nextAssets.push(...(payload.assets ?? []));
        nextOffset = typeof payload.next_offset === "number" ? payload.next_offset : null;
      }
      setAssets((current) => mergeAssets(current, nextAssets));
      imageAssetsLoadedRef.current = true;
      imageAssetsFetchedAtRef.current = Date.now();
    })().finally(() => {
      imageAssetsPromiseRef.current = null;
    });
    return imageAssetsPromiseRef.current;
  }, []);

  const refreshAssetsByIds = useCallback(async (assetIds: string[]) => {
    const uniqueIds = Array.from(new Set(assetIds.filter(Boolean)));
    if (!uniqueIds.length) return;
    const loaded = await Promise.all(
      uniqueIds.map((assetId) =>
        jsonFetch<{ asset?: MediaAsset }>(`/api/control/media-assets/${encodeURIComponent(assetId)}`)
          .then((payload) => payload.asset ?? null)
          .catch(() => null),
      ),
    );
    const found = loaded.filter((asset): asset is MediaAsset => Boolean(asset?.asset_id));
    if (!found.length) return;
    setAssets((current) => mergeAssets(current, found, uniqueIds));
  }, []);

  const refreshReferencesByIds = useCallback(async (referenceIds: string[]) => {
    const uniqueIds = Array.from(new Set(referenceIds.filter(Boolean)));
    if (!uniqueIds.length) return;
    const loaded = await Promise.all(
      uniqueIds.map((referenceId) =>
        jsonFetch<{ item?: MediaReference }>(`/api/control/reference-media/${encodeURIComponent(referenceId)}`)
          .then((payload) => payload.item ?? null)
          .catch(() => null),
      ),
    );
    const found = loaded.filter((reference): reference is MediaReference => Boolean(reference?.reference_id));
    if (!found.length) return;
    setReferences((current) => mergeReferences(current, found, uniqueIds));
  }, []);

  const refreshReferenceMedia = useCallback(async (options?: { force?: boolean }) => {
    const force = options?.force ?? false;
    const freshEnough =
      referenceMediaLoadedRef.current &&
      Date.now() - referenceMediaFetchedAtRef.current < MEDIA_LIBRARY_REFRESH_TTL_MS;
    if (!force && freshEnough) {
      return;
    }
    if (!force && referenceMediaPromiseRef.current) {
      return referenceMediaPromiseRef.current;
    }
    referenceMediaPromiseRef.current = (async () => {
      const payload = await jsonFetch<{ items?: MediaReference[] }>(
        referenceImagePickerPageUrl(0, null, GRAPH_MEDIA_LIBRARY_PAGE_LIMIT),
      );
      setReferences(payload.items ?? []);
      referenceMediaLoadedRef.current = true;
      referenceMediaFetchedAtRef.current = Date.now();
    })().finally(() => {
      referenceMediaPromiseRef.current = null;
    });
    return referenceMediaPromiseRef.current;
  }, []);

  const refreshMediaLibrary = useCallback(async (options?: { force?: boolean }) => {
    const force = options?.force ?? false;
    if (!force && mediaLibraryPromiseRef.current) {
      return mediaLibraryPromiseRef.current;
    }
    mediaLibraryPromiseRef.current = Promise.all([
      refreshReferenceMedia({ force }).catch(() => undefined),
      refreshImageAssets({ force }).catch(() => undefined),
    ]).then(() => undefined).finally(() => {
      mediaLibraryPromiseRef.current = null;
    });
    return mediaLibraryPromiseRef.current;
  }, [refreshImageAssets, refreshReferenceMedia]);

  const importImageFile = useCallback(async (file: File) => {
    const data = new FormData();
    data.append("file", file);
    const response = await fetch("/api/control/reference-media/import", { method: "POST", body: data });
    if (!response.ok) {
      throw new Error("Image import failed.");
    }
    const payload = (await response.json()) as { item?: MediaReference };
    if (!payload.item?.reference_id) {
      throw new Error("Image import did not return a reference.");
    }
    setReferences((current) => [payload.item as MediaReference, ...current.filter((item) => item.reference_id !== payload.item?.reference_id)].slice(0, 40));
    referenceMediaLoadedRef.current = true;
    referenceMediaFetchedAtRef.current = Date.now();
    return payload.item;
  }, []);

  return {
    references,
    setReferences,
    assets,
    setAssets,
    availableCredits,
    creditsUnavailable,
    refreshCredits,
    refreshImageAssets,
    refreshAssetsByIds,
    refreshReferencesByIds,
    refreshReferenceMedia,
    refreshMediaLibrary,
    importImageFile,
  };
}

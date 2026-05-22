import { useCallback, useRef, useState } from "react";

import type { MediaAsset, MediaReference } from "@/lib/types";
import { creditBalanceFromPayload, jsonFetch } from "../utils/graph-api";

const MEDIA_LIBRARY_REFRESH_TTL_MS = 4000;

function mergeAssets(current: MediaAsset[], next: MediaAsset[]) {
  const byId = new Map(current.map((asset) => [String(asset.asset_id), asset]));
  next.forEach((asset) => byId.set(String(asset.asset_id), asset));
  return Array.from(byId.values()).sort((left, right) => String(right.created_at ?? "").localeCompare(String(left.created_at ?? ""))).slice(0, 80);
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
      const payload = await jsonFetch<{ assets?: MediaAsset[] }>("/api/control/media-assets?limit=40");
      setAssets((current) => mergeAssets(current, payload.assets ?? []));
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
    setAssets((current) => mergeAssets(current, found));
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
      const payload = await jsonFetch<{ items?: MediaReference[] }>("/api/control/reference-media?limit=40");
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
    refreshReferenceMedia,
    refreshMediaLibrary,
    importImageFile,
  };
}

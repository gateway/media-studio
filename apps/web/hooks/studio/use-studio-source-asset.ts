"use client";

import { useCallback, useRef, useState, type SetStateAction } from "react";

type SourceAssetId = string | number | null;

export function useStudioSourceAsset() {
  const [sourceAssetId, setSourceAsset] = useState<SourceAssetId>(null);
  // Track staging changes synchronously so a late file decode cannot claim a
  // source removed and re-staged before React renders.
  const sourceIdentity = useRef<{ assetId: SourceAssetId }>({ assetId: null });
  const setSourceAssetId = useCallback(
    (update: SetStateAction<SourceAssetId>) => {
      const current = sourceIdentity.current;
      const assetId =
        typeof update === "function" ? update(current.assetId) : update;
      if (assetId !== current.assetId) sourceIdentity.current = { assetId };
      setSourceAsset(assetId);
    },
    [],
  );

  function prepareSourceReplacement(
    assetId: string | number,
    clearSource: () => void,
  ) {
    const expected = sourceIdentity.current;
    return () => {
      if (
        sourceIdentity.current !== expected ||
        expected.assetId === null ||
        String(expected.assetId) !== String(assetId)
      )
        return false;
      clearSource();
      return true;
    };
  }

  return { sourceAssetId, setSourceAssetId, prepareSourceReplacement };
}

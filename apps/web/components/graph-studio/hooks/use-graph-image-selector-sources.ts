import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchGeneratedMediaPickerPage,
  fetchReferenceMediaPickerPage,
  generatedMediaPickerItem,
  referenceMediaPickerItem,
} from "@/components/media/media-image-picker-sources";
import type { MediaImagePickerItem, MediaPickerMediaType } from "@/components/media/media-image-picker-types";
import type { MediaProject } from "@/lib/types";
import type {
  GraphImageSelectorProjectOption,
  GraphImageSelectorSource,
  GraphImageSelectorSourceState,
} from "../graph-image-selector-dialog";
import { jsonFetch } from "../utils/graph-api";

const GRAPH_IMAGE_SELECTOR_PAGE_LIMIT = 40;

export type GraphMediaSelectorMediaType = MediaPickerMediaType;

type GraphImageSelectorSources = Record<
  GraphImageSelectorSource,
  GraphImageSelectorSourceState
>;

type LoadSourceOptions = {
  append?: boolean;
  query?: string;
  projectId?: string | null;
};

function emptySourceState(): GraphImageSelectorSourceState {
  return {
    items: [],
    loading: false,
    loadingMore: false,
    nextOffset: null,
    selectionId: null,
    error: null,
  };
}

function emptySources(): GraphImageSelectorSources {
  return {
    generated: emptySourceState(),
    imported: emptySourceState(),
  };
}

function mergeItems(
  current: MediaImagePickerItem[],
  next: MediaImagePickerItem[],
) {
  const byId = new Map(current.map((item) => [item.id, item]));
  next.forEach((item) => byId.set(item.id, item));
  return Array.from(byId.values());
}

function projectOption(project: MediaProject): GraphImageSelectorProjectOption {
  return {
    projectId: project.project_id,
    label: project.name?.trim() || project.project_id,
    status: project.status,
    hiddenFromGlobalGallery: Boolean(project.hidden_from_global_gallery),
  };
}

export function useGraphImageSelectorSources(
  mediaType: GraphMediaSelectorMediaType = "image",
) {
  const [sources, setSources] =
    useState<GraphImageSelectorSources>(emptySources);
  const [searchQuery, setSearchQueryState] = useState("");
  const [projectId, setProjectIdState] = useState<string | null>(null);
  const [projectOptions, setProjectOptions] = useState<
    GraphImageSelectorProjectOption[]
  >([]);
  const [loadingProjectOptions, setLoadingProjectOptions] = useState(false);
  const sourcesRef = useRef(sources);
  const searchQueryRef = useRef(searchQuery);
  const projectIdRef = useRef(projectId);
  const mediaTypeRef = useRef<GraphMediaSelectorMediaType>(mediaType);
  const projectOptionsLoadedRef = useRef(false);
  const requestCountersRef = useRef<Record<GraphImageSelectorSource, number>>({
    generated: 0,
    imported: 0,
  });

  useEffect(() => {
    sourcesRef.current = sources;
  }, [sources]);

  useEffect(() => {
    if (mediaTypeRef.current === mediaType) return;
    mediaTypeRef.current = mediaType;
    setSources(emptySources());
  }, [mediaType]);

  const setSearchQuery = useCallback((query: string) => {
    searchQueryRef.current = query;
    setSearchQueryState(query);
  }, []);

  const setProjectId = useCallback((nextProjectId: string | null) => {
    projectIdRef.current = nextProjectId;
    setProjectIdState(nextProjectId);
    setSources(emptySources());
  }, []);

  const loadProjects = useCallback(async (options?: { force?: boolean }) => {
    if (!options?.force && projectOptionsLoadedRef.current) return;
    setLoadingProjectOptions(true);
    try {
      const payload = await jsonFetch<{ projects?: MediaProject[] }>(
        "/api/control/media/projects?status=all",
      );
      setProjectOptions(
        (payload.projects ?? [])
          .filter((project) => project.project_id)
          .map(projectOption),
      );
      projectOptionsLoadedRef.current = true;
    } finally {
      setLoadingProjectOptions(false);
    }
  }, []);

  const loadSource = useCallback(
    async (source: GraphImageSelectorSource, options?: LoadSourceOptions) => {
      const append = options?.append ?? false;
      const currentSource = sourcesRef.current[source];
      if (append && currentSource.nextOffset == null) return;
      const offset = append ? currentSource.nextOffset ?? 0 : 0;
      const query = options?.query ?? searchQueryRef.current;
      const selectedProjectId =
        options && "projectId" in options
          ? options.projectId ?? null
          : projectIdRef.current;
      const requestId = requestCountersRef.current[source] + 1;
      requestCountersRef.current[source] = requestId;

      setSources((current) => ({
        ...current,
        [source]: {
          ...current[source],
          items: append ? current[source].items : [],
          loading: !append,
          loadingMore: append,
          error: null,
        },
      }));

      try {
        let items: MediaImagePickerItem[];
        let nextOffset: number | null;
        if (source === "generated") {
          const page = await fetchGeneratedMediaPickerPage(
            mediaType,
            offset,
            query,
            selectedProjectId,
            GRAPH_IMAGE_SELECTOR_PAGE_LIMIT,
          );
          items = page.items
            .map((item) => generatedMediaPickerItem(item, mediaType))
            .filter((item): item is MediaImagePickerItem => Boolean(item));
          nextOffset = page.nextOffset;
        } else {
          const page = await fetchReferenceMediaPickerPage(
            mediaType,
            offset,
            query,
            selectedProjectId,
            GRAPH_IMAGE_SELECTOR_PAGE_LIMIT,
          );
          items = page.items
            .map((item) => referenceMediaPickerItem(item, mediaType))
            .filter((item): item is MediaImagePickerItem => Boolean(item));
          nextOffset = page.nextOffset;
        }
        if (requestCountersRef.current[source] !== requestId) return;
        setSources((current) => ({
          ...current,
          [source]: {
            ...current[source],
            items: append ? mergeItems(current[source].items, items) : items,
            loading: false,
            loadingMore: false,
            nextOffset,
            error: null,
          },
        }));
      } catch (error) {
        if (requestCountersRef.current[source] !== requestId) return;
        setSources((current) => ({
          ...current,
          [source]: {
            ...current[source],
            loading: false,
            loadingMore: false,
            error:
              error instanceof Error
                ? error.message
                : `Unable to load ${mediaType} assets.`,
          },
        }));
      }
    },
    [mediaType],
  );

  return {
    generated: sources.generated,
    imported: sources.imported,
    searchQuery,
    setSearchQuery,
    projectId,
    setProjectId,
    projectOptions,
    loadingProjectOptions,
    loadProjects,
    loadSource,
  };
}

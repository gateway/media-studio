import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createStudioGalleryPageActions,
  type GalleryPageRequestOwner,
} from "@/hooks/studio/use-studio-gallery-page-actions";
import type { AssetPagePayload } from "@/lib/media-studio-contract";

type ActionParams = Parameters<typeof createStudioGalleryPageActions>[0];

function requestOwner(): GalleryPageRequestOwner {
  return { pendingAppends: new Set(), appendedOffsets: new Set(), inFlight: new Map(), cursors: new Map() };
}

function actions(overrides: Partial<ActionParams> = {}) {
  const params = {
    requestOwner: requestOwner(), isCurrentQuery: () => true, activeProjectId: null,
    assetPageLimit: 18, assetFeedHasMore: true, assetFeedNextOffset: 18,
    loadingMoreAssets: false, firstGalleryPageFailed: false, prefetchedAssetPage: null,
    favoritesOnly: false, favoriteAssetFeedHasMore: false, favoriteAssetFeedNextOffset: null,
    loadingMoreFavoriteAssets: false, prefetchedFavoriteAssetPage: null,
    galleryKindFilter: "all", galleryModelFilter: "all", onMessage: vi.fn(),
    setLocalAssets: vi.fn(), setAssetFeedHasMore: vi.fn(), setAssetFeedNextOffset: vi.fn(),
    setPrefetchedAssetPage: vi.fn(), setLocalLatestAsset: vi.fn(), setLoadingMoreAssets: vi.fn(),
    setFavoriteAssets: vi.fn(), setFavoriteAssetFeedHasMore: vi.fn(), setFavoriteAssetFeedNextOffset: vi.fn(),
    setPrefetchedFavoriteAssetPage: vi.fn(), setLoadingMoreFavoriteAssets: vi.fn(), setFirstGalleryPageFailed: vi.fn(),
    ...overrides,
  } satisfies ActionParams;
  return { ...createStudioGalleryPageActions(params), params };
}

function page(offset = 0): AssetPagePayload {
  return { ok: true, assets: [], offset, has_more: false, next_offset: null };
}

function response(payload: unknown = page(), ok = true) {
  return { ok, json: vi.fn().mockResolvedValue(payload) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

afterEach(() => vi.unstubAllGlobals());

describe("Studio gallery pending page requests through public actions", () => {
  it("shares one pending GET and JSON parse across overlapping callers", async () => {
    const pending = deferred<ReturnType<typeof response>>();
    const fetchPage = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetchPage);
    const gallery = actions();
    const first = gallery.fetchAssetPage({ offset: 0, silent: true });
    const second = gallery.fetchAssetPage({ offset: 0 });
    expect(fetchPage).toHaveBeenCalledExactlyOnceWith(
      "/api/control/media-assets?limit=18&offset=0&view=summary&pagination=cursor",
      { method: "GET", headers: { Accept: "application/json" }, cache: "no-store" },
    );
    const payload = page();
    const result = response(payload);
    pending.resolve(result);
    expect(await Promise.all([first, second])).toEqual([payload, payload]);
    expect(result.json).toHaveBeenCalledTimes(1);
    expect(gallery.params.onMessage).not.toHaveBeenCalled();
  });

  it("makes a fresh same-key request after success instead of retaining a resolved page", async () => {
    const initial = page(0);
    const refreshed = { ...page(0), has_more: true, next_offset: 18, next_cursor: "new-page" };
    const fetchPage = vi.fn().mockResolvedValueOnce(response(initial)).mockResolvedValueOnce(response(refreshed));
    vi.stubGlobal("fetch", fetchPage);
    const gallery = actions();
    expect(await gallery.fetchAssetPage({ offset: 0 })).toBe(initial);
    expect(await gallery.fetchAssetPage({ offset: 0 })).toBe(refreshed);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it.each([
    { name: "offset", next: { offset: 18 } },
    { name: "Favorites", next: { offset: 0, favorited: true } },
    { name: "limit", next: { offset: 0, limitOverride: 12 } },
  ])("keeps pending $name queries separate", async ({ next }) => {
    const fetchPage = vi.fn().mockResolvedValue(response());
    vi.stubGlobal("fetch", fetchPage);
    const gallery = actions();
    await Promise.all([gallery.fetchAssetPage({ offset: 0 }), gallery.fetchAssetPage(next)]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage.mock.calls[0][0]).not.toBe(fetchPage.mock.calls[1][0]);
  });

  it.each([
    { name: "project", scope: { activeProjectId: "project-2" } },
    { name: "kind", scope: { galleryKindFilter: "image" as const } },
    { name: "model", scope: { galleryModelFilter: "model-2" } },
  ])("keeps $name scopes separate even within the same request owner", async ({ scope }) => {
    const fetchPage = vi.fn().mockResolvedValue(response());
    vi.stubGlobal("fetch", fetchPage);
    const owner = requestOwner();
    const first = actions({ requestOwner: owner });
    const second = actions({ requestOwner: owner, ...scope });
    await Promise.all([first.fetchAssetPage({ offset: 0 }), second.fetchAssetPage({ offset: 0 })]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage.mock.calls[0][0]).not.toBe(fetchPage.mock.calls[1][0]);
  });

  it("uses the opaque cursor in the key when the same offset has a new continuation", async () => {
    const fetchPage = vi.fn().mockResolvedValue(response(page(18)));
    vi.stubGlobal("fetch", fetchPage);
    const gallery = actions();
    gallery.params.requestOwner.cursors.set(18, "first+cursor");
    const first = gallery.fetchAssetPage({ offset: 18 });
    gallery.params.requestOwner.cursors.set(18, "second+cursor");
    const second = gallery.fetchAssetPage({ offset: 18 });
    await Promise.all([first, second]);
    expect(fetchPage.mock.calls.map(call => call[0])).toEqual([
      "/api/control/media-assets?limit=18&offset=18&view=summary&pagination=cursor&cursor=first%2Bcursor",
      "/api/control/media-assets?limit=18&offset=18&view=summary&pagination=cursor&cursor=second%2Bcursor",
    ]);
  });

  it("does not share identical keys across different request owners", async () => {
    const fetchPage = vi.fn().mockResolvedValue(response());
    vi.stubGlobal("fetch", fetchPage);
    await Promise.all([actions().fetchAssetPage({ offset: 0 }), actions().fetchAssetPage({ offset: 0 })]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage.mock.calls[0][0]).toBe(fetchPage.mock.calls[1][0]);
  });

  it.each([
    { name: "HTTP error", ok: false, payload: { ...page(), error: "HTTP refused" }, text: "HTTP refused" },
    { name: "payload error", ok: true, payload: { ...page(), ok: false, error: "Page refused" }, text: "Page refused" },
    { name: "missing error", ok: false, payload: page(), text: "Unable to load media assets from the dashboard." },
    { name: "null error", ok: true, payload: { ...page(), ok: false, error: null }, text: "Unable to load media assets from the dashboard." },
    { name: "empty error", ok: false, payload: { ...page(), error: "" }, text: "" },
  ])("releases a rejected $name request for retry and preserves its message", async ({ ok, payload, text }) => {
    const recovered = page();
    const fetchPage = vi.fn().mockResolvedValueOnce(response(payload, ok)).mockResolvedValueOnce(response(recovered));
    vi.stubGlobal("fetch", fetchPage);
    const gallery = actions();
    expect(await gallery.fetchAssetPage({ offset: 0 })).toBeNull();
    expect(gallery.params.onMessage).toHaveBeenCalledExactlyOnceWith({ tone: "danger", text });
    expect(await gallery.fetchAssetPage({ offset: 0 })).toBe(recovered);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it.each([
    { name: "network Error", failure: new Error("Offline"), json: false, text: "Offline" },
    { name: "network non-Error", failure: "Offline", json: false, text: "The dashboard could not load more media assets." },
    { name: "JSON Error", failure: new Error("Bad JSON"), json: true, text: "Bad JSON" },
    { name: "JSON non-Error", failure: "Bad JSON", json: true, text: "The dashboard could not load more media assets." },
  ])("releases a $name rejection and permits a new request", async ({ failure, json, text }) => {
    const failed = json
      ? Promise.resolve({ ok: true, json: vi.fn().mockRejectedValue(failure) })
      : Promise.reject(failure);
    const recovered = page();
    const fetchPage = vi.fn().mockReturnValueOnce(failed).mockResolvedValueOnce(response(recovered));
    vi.stubGlobal("fetch", fetchPage);
    const gallery = actions();
    expect(await gallery.fetchAssetPage({ offset: 0 })).toBeNull();
    expect(gallery.params.onMessage).toHaveBeenCalledExactlyOnceWith({ tone: "danger", text });
    expect(await gallery.fetchAssetPage({ offset: 0 })).toBe(recovered);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("keeps silent and foreground notification policy per caller of a shared rejection", async () => {
    const pending = deferred<ReturnType<typeof response>>();
    const fetchPage = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetchPage);
    const gallery = actions();
    const silent = gallery.fetchAssetPage({ offset: 0, silent: true });
    const foreground = gallery.fetchAssetPage({ offset: 0 });
    pending.reject(new Error("Offline"));
    expect(await Promise.all([silent, foreground])).toEqual([null, null]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(gallery.params.onMessage).toHaveBeenCalledExactlyOnceWith({ tone: "danger", text: "Offline" });
  });

  it("does not collapse two foreground notifications into a per-request notification", async () => {
    const pending = deferred<ReturnType<typeof response>>();
    const fetchPage = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetchPage);
    const gallery = actions();
    const first = gallery.fetchAssetPage({ offset: 0 });
    const second = gallery.fetchAssetPage({ offset: 0 });
    pending.reject(new Error("Offline"));
    await Promise.all([first, second]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(gallery.params.onMessage).toHaveBeenCalledTimes(2);
  });

  it("does not fetch for an already stale caller", async () => {
    const fetchPage = vi.fn();
    vi.stubGlobal("fetch", fetchPage);
    const gallery = actions({ isCurrentQuery: () => false });
    expect(await gallery.fetchAssetPage({ offset: 0 })).toBeNull();
    expect(fetchPage).not.toHaveBeenCalled();
    expect(gallery.params.onMessage).not.toHaveBeenCalled();
  });

  it("does not clear or accept cursors from a response that becomes stale", async () => {
    let current = true;
    const pending = deferred<ReturnType<typeof response>>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending.promise));
    const gallery = actions({ isCurrentQuery: () => current });
    gallery.params.requestOwner.cursors.set(99, "keep");
    const result = gallery.fetchAssetPage({ offset: 0 });
    current = false;
    pending.resolve(response({ ...page(), next_offset: 18, next_cursor: "discard" }));
    expect(await result).toBeNull();
    expect([...gallery.params.requestOwner.cursors]).toEqual([[99, "keep"]]);
  });

  it("clears first-page cursors and records the next opaque continuation for a current caller", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ...page(), next_offset: 18, next_cursor: "next" })));
    const gallery = actions();
    gallery.params.requestOwner.cursors.set(99, "old");
    await gallery.fetchAssetPage({ offset: 0 });
    expect([...gallery.params.requestOwner.cursors]).toEqual([[18, "next"]]);
  });

  it("settles an old owner without evicting the new scope's still-pending request", async () => {
    let oldCurrent = true;
    const oldPending = deferred<ReturnType<typeof response>>();
    const newPending = deferred<ReturnType<typeof response>>();
    const fetchPage = vi.fn().mockReturnValueOnce(oldPending.promise).mockReturnValueOnce(newPending.promise);
    vi.stubGlobal("fetch", fetchPage);
    const oldScope = actions({ isCurrentQuery: () => oldCurrent });
    const newScope = actions();
    const oldResult = oldScope.fetchAssetPage({ offset: 0 });
    oldCurrent = false;
    const newResult = newScope.fetchAssetPage({ offset: 0 });
    oldPending.resolve(response());
    expect(await oldResult).toBeNull();
    expect(newScope.params.requestOwner.inFlight.size).toBe(1);
    const payload = page();
    newPending.resolve(response(payload));
    expect(await newResult).toBe(payload);
    expect(newScope.params.requestOwner.inFlight.size).toBe(0);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it.each([
    { currentAfter: true, silent: false, notifications: 1 },
    { currentAfter: true, silent: true, notifications: 0 },
    { currentAfter: false, silent: false, notifications: 0 },
    { currentAfter: false, silent: true, notifications: 0 },
  ])("preserves late-failure policy for $currentAfter current / $silent silent", async ({ currentAfter, silent, notifications }) => {
    let current = true;
    const pending = deferred<ReturnType<typeof response>>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending.promise));
    const gallery = actions({ isCurrentQuery: () => current });
    const result = gallery.fetchAssetPage({ offset: 0, silent });
    current = currentAfter;
    pending.reject(new Error("Offline"));
    expect(await result).toBeNull();
    expect(gallery.params.onMessage).toHaveBeenCalledTimes(notifications);
  });
});

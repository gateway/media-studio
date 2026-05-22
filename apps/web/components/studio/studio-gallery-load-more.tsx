"use client";

type StudioGalleryLoadMoreProps = {
  loading: boolean;
  galleryLoadMoreRef: React.MutableRefObject<HTMLDivElement | null>;
  onLoadMore: () => void;
};

export function StudioGalleryLoadMore({ loading, galleryLoadMoreRef, onLoadMore }: StudioGalleryLoadMoreProps) {
  return (
    <div
      ref={galleryLoadMoreRef}
      className="studio-gallery-load-more col-span-full flex min-h-16 items-center justify-center px-4 py-4 text-[0.7rem] font-semibold uppercase tracking-[0.16em]"
    >
      {loading ? (
        "Loading more gallery items"
      ) : (
        <button
          type="button"
          onClick={onLoadMore}
          className="studio-icon-button min-h-11 px-4 py-2 text-[0.7rem] font-semibold uppercase tracking-[0.16em]"
        >
          Scroll or tap to load more
        </button>
      )}
    </div>
  );
}

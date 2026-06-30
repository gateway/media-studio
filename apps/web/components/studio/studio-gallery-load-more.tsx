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
      className="studio-gallery-load-more"
    >
      {loading ? (
        "Loading more gallery items"
      ) : (
        <button
          type="button"
          onClick={onLoadMore}
          className="studio-icon-button studio-gallery-load-more-button"
        >
          Scroll or tap to load more
        </button>
      )}
    </div>
  );
}

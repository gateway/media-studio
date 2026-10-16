// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobsBatchCard } from "@/app/jobs/jobs-batch-card";
import type { JobsBatchCardView } from "@/app/jobs/jobs-batch-card-view";

vi.mock("@/app/jobs/media-batch-actions", () => ({ MediaBatchActions: ({ canCancelQueued }: { canCancelQueued: boolean }) => canCancelQueued ? <button>Cancel queued</button> : null }));
vi.mock("@/components/studio/studio-lightbox", () => ({ StudioLightbox: ({ selectedAsset, onNavigate, onClose }: { selectedAsset: { asset_id: string }; onNavigate: (direction: 1) => void; onClose: () => void }) => <div role="dialog">{selectedAsset.asset_id}<button onClick={() => onNavigate(1)}>Next output</button><button onClick={onClose}>Close</button></div> }));
const batch: JobsBatchCardView = { batch_id: "batch-1", model_key: "model", status: "completed", created_at: "2026-10-16T00:00:00Z", requested_outputs: 2, queued_count: 0, running_count: 0, failed_count: 0, prompt_summary: "A mountain at sunset", pricing_summary: null, jobs: [{ job_id: "j1", batch_index: 1 }, { job_id: "j2", batch_index: 2 }] };
const assets = [1, 2].map((i) => ({ asset_id: `asset-${i}`, job_id: `j${i}`, created_at: batch.created_at, hero_web_url: `/files/output-${i}.png`, hero_original_url: `/files/original-${i}.png`, generation_kind: "image" }));
afterEach(cleanup);
describe("Job output disclosure", () => {
  it("keeps previews behind a disclosure and preserves lightbox navigation and close", () => {
    const { container } = render(<JobsBatchCard batch={batch} assets={assets} />);
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    fireEvent.click(container.querySelector("summary")!);
    expect(details.open).toBe(true);
    fireEvent.click(screen.getByTitle("Open output 1"));
    expect(screen.getByRole("dialog").textContent).toContain("asset-1");
    fireEvent.click(screen.getByText("Next output"));
    expect(screen.getByRole("dialog").textContent).toContain("asset-2");
    fireEvent.click(screen.getByText("Close"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("retains error and cancellation access for a partially failed active batch", () => {
    const { container } = render(<JobsBatchCard batch={{ ...batch, status: "processing", queued_count: 1, failed_count: 1, jobs: [{ job_id: "j1", error: "Provider unavailable" }] }} assets={[]} />);
    fireEvent.click(container.querySelector("summary")!);
    expect(screen.getByText("Provider unavailable")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel queued" })).toBeTruthy();
    expect(screen.getByTitle("Output 1").hasAttribute("disabled")).toBe(true);
  });
});

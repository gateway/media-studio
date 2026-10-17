// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobsBatchCard } from "@/app/jobs/jobs-batch-card";
import type { JobsBatchCardView } from "@/app/jobs/jobs-batch-card-view";

vi.mock("@/app/jobs/media-batch-actions", () => ({ MediaBatchActions: ({ canCancelQueued }: { canCancelQueued: boolean }) => canCancelQueued ? <button>Cancel queued</button> : null }));
vi.mock("@/components/studio/studio-lightbox", () => ({ StudioLightbox: ({ selectedAsset, onNavigate, onClose }: { selectedAsset: { asset_id: string }; onNavigate: (direction: 1) => void; onClose: () => void }) => <div role="dialog">{selectedAsset.asset_id}<button onClick={() => onNavigate(1)}>Next output</button><button onClick={onClose}>Close</button></div> }));
const batch: JobsBatchCardView = { batch_id: "batch-1", model_key: "model", status: "completed", created_at: "2026-10-16T00:00:00Z", requested_outputs: 2, queued_count: 0, running_count: 0, failed_count: 0, prompt_summary: "A mountain at sunset", pricing_summary: null, jobs: [{ job_id: "j1", batch_index: 0 }, { job_id: "j2", batch_index: 1 }] };
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
  it("keeps zero estimates, prompt context and run metadata available when expanded", () => {
    const { container } = render(<JobsBatchCard batch={{ ...batch, pricing_summary: { totalUsd: 0, totalCredits: 0, perOutputUsd: 0, perOutputCredits: 0, outputCount: 2 } }} assets={assets} modelLabel="Readable model name" />);
    const summary = container.querySelector("summary")!;
    expect(summary.textContent).toContain("Readable model name");
    expect(summary.textContent).toContain("$0.00");
    fireEvent.click(summary);
    expect(screen.getByText("Prompt summary")).toBeTruthy();
    expect(screen.getAllByText("0 credits")).toHaveLength(2);
    expect(container.querySelectorAll("figure")).toHaveLength(2);
    const metadata = container.querySelector<HTMLDetailsElement>(".admin-job-run-details")!;
    expect(metadata.open).toBe(false);
    fireEvent.click(within(metadata).getByText("Run details"));
    expect(metadata.open).toBe(true);
    expect(within(metadata).getByText("batch-1")).toBeTruthy();
    expect(within(metadata).getByText("model")).toBeTruthy();
    expect(within(metadata).getByText("0 queued · 0 processing · 0 failed")).toBeTruthy();
  });
  it("opens outputs in batch order from the primary action", () => {
    const { container } = render(<JobsBatchCard batch={{ ...batch, jobs: [...batch.jobs].reverse() }} assets={assets} />);
    fireEvent.click(container.querySelector("summary")!);
    fireEvent.click(screen.getByRole("button", { name: "Open first output" }));
    expect(screen.getByRole("dialog").textContent).toContain("asset-1");
    fireEvent.click(screen.getByText("Next output"));
    expect(screen.getByRole("dialog").textContent).toContain("asset-2");
  });
  it.each(["video", "audio"])("keeps a %s output playable when it has no poster", (generation_kind) => {
    const playable = { ...assets[0], generation_kind, hero_web_url: null, hero_original_url: `/files/output.${generation_kind === "video" ? "mp4" : "mp3"}` };
    const { container } = render(<JobsBatchCard batch={batch} assets={[playable, { ...assets[1], hero_web_url: null, hero_original_url: null }]} />);
    fireEvent.click(container.querySelector("summary")!);
    expect(screen.getByTitle("Open output 1").hasAttribute("disabled")).toBe(false);
    expect(screen.getByTitle("Output 2").hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Open output" }));
    expect(screen.getByRole("dialog").textContent).toContain("asset-1");
    fireEvent.click(screen.getByText("Next output"));
    expect(screen.getByRole("dialog").textContent).toContain("asset-1");
  });
  it("handles an empty batch without exposing an unusable output action", () => {
    const { container } = render(<JobsBatchCard batch={{ ...batch, jobs: [] }} assets={[]} />);
    fireEvent.click(container.querySelector("summary")!);
    expect(screen.getByText("No outputs recorded for this batch.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open output" })).toBeNull();
  });

});

import { chromium } from "@playwright/test";
import sharp from "sharp";
import { expect, it } from "vitest";

it("exposes Chromium from the declared Playwright dependency without launching a browser", () => {
  expect(chromium.name()).toBe("chromium");
  expect(typeof chromium.launch).toBe("function");
});

it("processes an image in memory with Sharp's installed platform dependencies", async () => {
  const buffer = await sharp({
    create: { width: 2, height: 3, channels: 3, background: "#123456" },
  }).png().toBuffer();
  const metadata = await sharp(buffer).metadata();
  expect(metadata.width).toBe(2);
  expect(metadata.height).toBe(3);
  expect(metadata.format).toBe("png");
});

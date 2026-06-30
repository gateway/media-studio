import test from "node:test";
import assert from "node:assert/strict";

import {
  candidateReasonForStrategy,
  classifyPreset,
  normalize,
  protectionReason,
} from "./archive_smoke_media_presets.mjs";

function preset(overrides = {}) {
  return {
    preset_id: "preset_custom",
    key: "custom_real_preset",
    label: "Custom Real Preset",
    source_kind: "custom",
    thumbnail_path: "",
    thumbnail_url: "",
    ...overrides,
  };
}

function context(keys = []) {
  return { studioImageKeys: new Set(keys.map(normalize)) };
}

test("protects real-looking presets that are referenced by Studio images", () => {
  const candidate = preset({ key: "client_campaign_final" });

  assert.equal(
    protectionReason(candidate, new Set(), context(["client_campaign_final"])),
    "referenced by Studio image asset",
  );
  assert.equal(classifyPreset(candidate), null);
});

test("protects thumbnail-backed and default install presets from archive classification", () => {
  assert.equal(
    protectionReason(preset({ thumbnail_path: "outputs/example/thumb.webp" }), new Set(), context()),
    "has preset thumbnail / Studio image",
  );
  assert.equal(
    protectionReason(preset({ preset_id: "media-preset-photo-restoration-shared", key: "photo-restoration" }), new Set(), context()),
    "default install preset key",
  );
});

test("classifies obvious smoke-looking presets without touching ambiguous presets", () => {
  assert.equal(
    classifyPreset(preset({ key: "assistant_prefix_style_12_test" })),
    "assistant prefix style smoke preset",
  );
  assert.equal(
    classifyPreset(preset({ label: "Project Cover Smoke", key: "project_cover" })),
    "explicit smoke/test preset",
  );
  assert.equal(
    classifyPreset(preset({ source_kind: "smoke_test", key: "generated_candidate" })),
    "test source kind",
  );
  assert.equal(classifyPreset(preset({ key: "client_campaign_final", label: "Client Campaign Final" })), null);
});

test("unattached strategy uses only the reviewed unattached reason after protection checks", () => {
  const candidate = preset({ key: "client_campaign_draft", label: "Client Campaign Draft" });
  const keep = new Set();

  assert.equal(protectionReason(candidate, keep, context()), null);
  assert.equal(
    candidateReasonForStrategy(candidate, "unattached"),
    "unattached preset: no Studio image asset, no thumbnail, not default install, not keep-listed",
  );
  assert.equal(candidateReasonForStrategy(candidate, "smoke"), null);
});

test("keep-list entries protect ids, keys, or labels case-insensitively", () => {
  const keep = new Set(["preset_custom", "custom_real_preset", "custom real preset"].map(normalize));

  assert.equal(protectionReason(preset(), keep, context()), "keep-list protected");
});

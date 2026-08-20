import assert from "node:assert/strict";
import test from "node:test";

import {
  scoreFieldUsefulness,
  scoreImageSlots,
} from "./media_assistant_audit_scoring.mjs";


test("field audit accepts a concrete evidence-backed style choice", () => {
  const result = scoreFieldUsefulness({
    fields: [{
      key: "outfit_style",
      label: "Outfit Style",
      placeholder: "e.g. tailored flight suit",
      help_text: "Changes the clothing shown on the central subject.",
    }],
    prompt: "Show the central subject wearing {{outfit_style}}.",
    minScore: 9,
  });

  assert.equal(result.score, 10);
  assert.equal(result.passed, true);
  assert.deepEqual(result.issues, []);
});


test("field audit rejects missing visible-outcome guidance", () => {
  const result = scoreFieldUsefulness({
    fields: [{
      key: "subject_brief",
      label: "Subject Brief",
      placeholder: "Describe anything",
    }],
    prompt: "Create {{subject_brief}}.",
    minScore: 9,
  });

  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => issue.includes("visible outcome")));
});


test("image-slot audit requires a clear user-facing asset role", () => {
  const result = scoreImageSlots({
    slots: [{ key: "user_asset", label: "User Asset", required: true }],
    mode: "image-to-image",
    prompt: "Use [[user_asset]] and preserve its recognizable shape and details.",
    minScore: 9,
  });

  assert.equal(result.passed, false);
  assert.ok(result.issues.some((issue) => issue.includes("visible asset role")));
});


test("image-slot audit accepts one explained runtime portrait", () => {
  const result = scoreImageSlots({
    slots: [{
      key: "portrait",
      label: "Portrait",
      help_text: "Provides the identity and likeness to preserve in the generated image.",
      required: true,
    }],
    mode: "image-to-image",
    prompt: "Use [[portrait]] as the identity and likeness source; preserve recognizable facial details.",
    minScore: 9,
  });

  assert.equal(result.score, 10);
  assert.equal(result.passed, true);
  assert.deepEqual(result.issues, []);
});

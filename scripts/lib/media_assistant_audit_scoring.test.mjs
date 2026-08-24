import assert from "node:assert/strict";
import test from "node:test";

import {
  auditPromptQuality,
  scoreFieldUsefulness,
  scoreImageSlots,
} from "./media_assistant_audit_scoring.mjs";


test("structural audit accepts strong natural visual language without taxonomy labels", () => {
  const traits = ["one", "two", "three"];
  const result = auditPromptQuality({
    prompt: `
      Vertical travel poster for {{destination}} with a dense layered paper-cut skyline, a large torn cream title card,
      oversized regional lettering, and a shallow foreground of landmarks, local transport, food, flowers, stamps,
      clouds, and postcard fragments. Use forest green, warm cream, brick red, turquoise water, terracotta buildings,
      ochre details, faded ink grain, worn painted type, deckled edges, subtle halftone, and soft paper shadows.
      Keep the title dominant and legible, place the landmark silhouettes high in the frame, cluster the lifestyle
      objects below, and leave deliberate breathing room around every text zone. Bright Mediterranean daylight,
      joyful nostalgic energy, playful scale, pale cutout borders, romantic handmade character, and abundant detail.
      Avoid copied logos, stray lettering, duplicated landmarks, glossy digital surfaces, sparse modern styling,
      photorealistic perspective, and weak title hierarchy. The destination must remain the unmistakable regional focus.
    `,
    brief: {
      visual_analysis: {
        medium: traits,
        palette: traits,
        line_shape_language: traits,
        composition: traits,
        subject_treatment: traits,
        environment_props: traits,
        texture_lighting: traits,
        typography_text_energy: traits,
        mood: traits,
      },
    },
    fields: [{ key: "destination", label: "Destination" }],
    slots: [],
    minScore: 9,
  });

  assert.equal(result.score, 9);
  assert.equal(result.passed, true);
  assert.deepEqual(result.issues, []);
});


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

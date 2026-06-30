export function briefCoverage(brief) {
  const analysis = brief?.visual_analysis || {};
  const categories = [
    "medium",
    "palette",
    "line_shape_language",
    "composition",
    "subject_treatment",
    "environment_props",
    "texture_lighting",
    "typography_text_energy",
    "mood",
  ];
  return categories.reduce((acc, key) => {
    acc[key] = Array.isArray(analysis[key]) ? analysis[key].length : 0;
    return acc;
  }, {});
}

export function auditPromptQuality({ prompt, brief, fields, slots, minScore }) {
  const text = String(prompt || "");
  const lowered = text.toLowerCase();
  const coverage = briefCoverage(brief);
  const populatedCategories = Object.values(coverage).filter((count) => count > 0).length;
  const totalTraits = Object.values(coverage).reduce((sum, count) => sum + count, 0);
  const blocked = [
    "media preset",
    "graph studio",
    "temporary sandbox",
    "temporary test",
    "runtime image input",
    "prior chat",
    "extract style",
    "attached references",
  ].filter((term) => lowered.includes(term));
  const fieldMisses = fields.filter((field) => {
    const key = String(field.key || "");
    const label = String(field.label || key || "").toLowerCase();
    const normalizedKey = key.replaceAll("_", " ").toLowerCase();
    return !(
      text.includes(`{{${key}}}`) ||
      (normalizedKey && lowered.includes(normalizedKey)) ||
      (label && lowered.includes(label))
    );
  });
  const slotMisses = slots.filter((slot) => {
    const label = String(slot.label || slot.key || "").toLowerCase();
    return !text.includes(`[[${slot.key}]]`) && !(label && lowered.includes(label) && lowered.includes("image"));
  });
  let score = 0;
  if (text.split(/\s+/).length >= 90 && populatedCategories >= 7 && totalTraits >= 20) score += 2;
  if (fieldMisses.length === 0) score += 1;
  if (slotMisses.length === 0) score += 2;
  if (blocked.length === 0) score += 1;
  if (lowered.includes("do not") || lowered.includes("avoid") || lowered.includes("negative constraints")) score += 1;
  if (!slots.length || ["preserve", "identity", "recognizable", "provided image content"].some((term) => lowered.includes(term))) score += 1;
  if (["composition", "palette", "texture", "lighting", "typography", "mood"].filter((term) => lowered.includes(term)).length >= 3) score += 1;
  const compilerTerms = [
    "render it as",
    "shape the image with",
    "compose it with",
    "treat the subject as",
    "visual direction",
    "visual mechanics",
    "fixed visual style",
    "signature style locks",
  ].filter((term) => lowered.includes(term));
  score -= Math.min(3, compilerTerms.length);
  const issues = [];
  if (text.split(/\s+/).length < 90) issues.push("prompt is short for a reusable style preset");
  if (populatedCategories < 7 || totalTraits < 20) issues.push("style brief coverage is thin");
  if (fieldMisses.length) issues.push(`missing field guidance: ${fieldMisses.map((field) => field.key).join(", ")}`);
  if (slotMisses.length) issues.push(`missing image-slot tokens: ${slotMisses.map((slot) => slot.key).join(", ")}`);
  if (blocked.length) issues.push(`blocked wording: ${blocked.join(", ")}`);
  if (compilerTerms.length) issues.push(`compiler-sounding wording: ${compilerTerms.join(", ")}`);
  if (/^create an? [a-z0-9\-\s]{2,90}\s+using\b/i.test(text)) {
    score -= 1;
    issues.push("starts with create/title/using wrapper");
  }
  if (slots.length && !["preserve", "identity", "recognizable", "provided image content"].some((term) => lowered.includes(term))) {
    issues.push("I2I prompt lacks preservation guidance");
  }
  const finalScore = Math.max(0, Math.min(10, score));
  return { score: finalScore, passed: finalScore >= minScore && issues.length === 0, issues };
}

export function scoreFixMyPhotoPlanner({ prompt, fields, slots, brief, minScore }) {
  const text = String(prompt || "");
  const lowered = text.toLowerCase();
  let score = 10;
  const issues = [];
  if (text.split(/\s+/).length < 75) {
    score -= 2;
    issues.push("prompt is too short for a reusable preset");
  }
  if (fields.length > 4) {
    score -= 2;
    issues.push("too many fields");
  } else if (fields.length > 3) {
    score -= 1;
    issues.push("field count should usually stay at three or fewer");
  }
  if (slots.length && !["identity", "likeness", "shape", "material", "branding", "layout", "source", "reference"].some((term) => lowered.includes(term))) {
    score -= 2;
    issues.push("image slot role is not clear");
  }
  const coverage = briefCoverage(brief);
  if (Object.values(coverage).filter((count) => count > 0).length < 7) {
    score -= 2;
    issues.push("style analysis has too few populated categories");
  }
  if (!fields.length) {
    score -= 1;
    issues.push("no high-signal fields suggested");
  }
  if (["media preset", "graph studio", "sandbox", "runtime image input", "prior chat", "attached references"].some((term) => lowered.includes(term))) {
    score -= 3;
    issues.push("product/planner wording leaked into prompt");
  }
  const finalScore = Math.max(0, Math.min(10, score));
  return { score: finalScore, passed: finalScore >= minScore && issues.length === 0, issues };
}

export function scoreGenerationDirectness({ prompt, slots, minScore }) {
  const text = String(prompt || "");
  const lowered = text.toLowerCase();
  let score = 10;
  const issues = [];
  const compilerTerms = [
    "render it as",
    "shape the image with",
    "compose it with",
    "treat the subject as",
    "visual direction",
    "visual mechanics",
    "fixed visual style",
    "signature style locks",
  ].filter((term) => lowered.includes(term));
  if (compilerTerms.length) {
    score -= Math.min(4, compilerTerms.length);
    issues.push(`compiler-sounding wording: ${compilerTerms.join(", ")}`);
  }
  if (/^create an? [a-z0-9\-\s]{2,90}\s+using\b/i.test(text)) {
    score -= 2;
    issues.push("starts with create/title/using wrapper");
  }
  if (slots.length && !lowered.startsWith("use ") && !lowered.startsWith("edit ") && !lowered.startsWith("transform ")) {
    score -= 1;
    issues.push("image-edit prompt should start with slot/edit intent");
  }
  if (!slots.length && ["uploaded image", "provided image", "[[", "attached reference", "style source"].some((term) => lowered.includes(term))) {
    score -= 2;
    issues.push("text-to-image prompt depends on hidden/uploaded reference");
  }
  if (["composition", "palette", "lighting", "texture", "typography", "line", "shape", "mood"].filter((term) => lowered.includes(term)).length < 3) {
    score -= 1;
    issues.push("not enough direct visual mechanics");
  }
  if (!["avoid", "do not", "must not"].some((term) => lowered.includes(term))) {
    score -= 1;
    issues.push("missing negative constraints");
  }
  const finalScore = Math.max(0, Math.min(10, score));
  return { score: finalScore, passed: finalScore >= minScore && issues.length === 0, issues };
}

function fieldText(field) {
  return [field.label, field.key, field.description, field.placeholder, field.default_value]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");
}

export function scoreFieldUsefulness({ fields, prompt, minScore }) {
  const issues = [];
  let score = 10;
  if (!fields.length) {
    score -= 2;
    issues.push("no fields suggested; confirm this is intentional for the style");
  }
  if (fields.length > 3) {
    score -= fields.length > 4 ? 3 : 1;
    issues.push("more than three fields makes the preset feel unfocused");
  }
  for (const field of fields) {
    const label = String(field.label || field.key || "").trim();
    const key = String(field.key || "").trim();
    const joined = fieldText(field).toLowerCase();
    const words = label.split(/[\s/_-]+/).filter(Boolean);
    if (!label || !key) {
      score -= 2;
      issues.push("field is missing a label or key");
      continue;
    }
    if (words.length > 5) {
      score -= 1;
      issues.push(`field "${label}" is too wordy for normal users`);
    }
    if (!/[a-z][a-z0-9_]*$/i.test(key)) {
      score -= 1;
      issues.push(`field "${label}" has a weak key`);
    }
    if (/(brief|notes?|details?|style|archetype|palette|vibe|direction|concept)$/i.test(label)) {
      score -= 2;
      issues.push(`field "${label}" reads abstract; rewrite it as a concrete replaceable element`);
    }
    if (!/(title|text|headline|word|phrase|quote|copy|banner|name|model|year|era|marker|code|label|destination|location|landmark|route|road|highway|drive|animal|pet|creature|companion|cast|class|role|prop|product|vehicle|car|logo|team|outfit|wardrobe|footwear|shoe|sneaker|gear|accessory|accessories|color|moon|sun|disc|planet|portal|sky|cloud|star|symbol|symbols|spirit|room|decor|collectible|foreground|landscape|message|number|slogan|tagline|setting|background|character|subject|mascot|snack|treat|weapon|sword|blade|brand|damage|wear|weathering|scratch|scratches|scuff|scuffs|dent|dents|augmentation|augmentations|prosthetic|prosthetics|implant|implants)/i.test(joined)) {
      score -= 1;
      issues.push(`field "${label}" may not be concrete enough for a user to fill quickly`);
    }
    if (prompt && !String(prompt).toLowerCase().includes(label.toLowerCase()) && !String(prompt).includes(`{{${key}}}`)) {
      score -= 1;
      issues.push(`field "${label}" is not clearly used in the prompt`);
    }
  }
  const finalScore = Math.max(0, Math.min(10, score));
  return { score: finalScore, passed: finalScore >= minScore && issues.length === 0, issues };
}

export function scoreImageSlots({ slots, mode, prompt, minScore }) {
  const issues = [];
  let score = 10;
  const isI2I = mode === "image-to-image";
  if (isI2I && !slots.length) {
    score -= 4;
    issues.push("image-to-image request needs at least one clear runtime image slot");
  }
  if (!isI2I && slots.length) {
    score -= 4;
    issues.push("text-to-image request should not define runtime image slots");
  }
  if (slots.length > 3) {
    score -= 2;
    issues.push("more than three image slots should require explicit user confirmation");
  }
  for (const slot of slots) {
    const label = String(slot.label || slot.key || "").trim();
    const key = String(slot.key || "").trim();
    const joined = [label, key, slot.description].map((value) => String(value || "").toLowerCase()).join(" ");
    if (!label || !key) {
      score -= 2;
      issues.push("image slot is missing a label or key");
      continue;
    }
    if (/(reference|image|subject)$/i.test(label) && !/(face|body|person|character|subject|creature|product|vehicle|car|pet|animal|logo|room|background|location|wardrobe|outfit|prop|object|brand|identity|pose)/i.test(joined)) {
      score -= 1;
      issues.push(`slot "${label}" needs a clearer role than a generic reference image`);
    }
    if (prompt && !String(prompt).includes(`[[${key}]]`) && !String(prompt).toLowerCase().includes(label.toLowerCase())) {
      score -= 2;
      issues.push(`slot "${label}" is not clearly used in the prompt`);
    }
  }
  if (slots.length && !/(preserve|recognizable|identity|likeness|shape|proportions|details|do not invent)/i.test(prompt || "")) {
    score -= 2;
    issues.push("image-to-image prompt lacks preservation/control language");
  }
  const finalScore = Math.max(0, Math.min(10, score));
  return { score: finalScore, passed: finalScore >= minScore && issues.length === 0, issues };
}

export function scoreConversation({ assistantReply, fields, slots, minScore }) {
  const text = String(assistantReply || "");
  const issues = [];
  let score = 10;
  if (!text.trim()) {
    return { score: 0, passed: false, issues: ["assistant reply is empty"] };
  }
  if (text.length > 900) {
    score -= 2;
    issues.push("assistant reply is too long for preset intake");
  }
  if (!/\?/.test(text)) {
    score -= 1;
    issues.push("assistant reply should ask a clear next-step question");
  }
  if (fields.length && !/field/i.test(text)) {
    score -= 1;
    issues.push("assistant reply does not clearly present fields");
  }
  if (slots.length && !/(image input|image slot|input image)/i.test(text)) {
    score -= 1;
    issues.push("assistant reply does not clearly present image input role");
  }
  if (/(sandbox|plan preview|graph studio|runtime image input|internal)/i.test(text)) {
    score -= 2;
    issues.push("assistant reply includes product/internal wording");
  }
  const finalScore = Math.max(0, Math.min(10, score));
  return { score: finalScore, passed: finalScore >= minScore && issues.length === 0, issues };
}

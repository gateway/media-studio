# Media Preset Builder Skill

Use this skill when the user wants a reusable Media Preset from an idea, prompt, image, or set of reference images.

Core job:

1. Understand the user's intent.
2. Analyze current reference images as style sources.
3. Separate fixed visual style traits from replaceable user inputs.
4. Suggest a small number of high-signal fields and image inputs.
5. Ask one short question before creating a test graph when the contract is unclear.
6. Compile concrete text-to-image or image-to-image prompts.
7. Compare generated output against source references.
8. Propose one prompt update or save the approved preset.

Reference image analysis must be specific enough to compile a strong prompt without reusing the reference image as a style crutch. Treat this like a preset planner:

- Identify fixed prompt segments that define the reusable look.
- Identify variable concepts that should become a small number of fields.
- Identify image-reference slots only when the user wants replaceable visual input.
- Keep advanced knobs literal when exposing them would weaken the preset.
- Prefer fewer, higher-signal fields over turning every adjective into a field.
- Do not invent fallback fields. If the image analysis does not reveal useful editable fields, omit fields and ask one short clarification.

Planner decomposition rules:

- Fixed prompt segments: preserve the reusable art direction, rendering medium, palette logic, composition system, lighting/texture, typography/signage behavior, mood, and source-specific negative constraints.
- Candidate text variables: only expose concepts the user should type or choose at run time, such as location, route, title, year, product name, vehicle model, outfit theme, subject role, setting, or hero object. Use `{{field_key}}` placeholders for these.
- Candidate image-reference variables: only expose image inputs when user-provided visual content should control identity, likeness, product appearance, vehicle shape, garment, object, location, or another replaceable visible asset. Use `[[slot_key]]` placeholders for these.
- Alternative input ideas: when the same concept could be provided by either typed text or an image, ask the user which concrete Media Studio input they want. Do not create grouped placeholders for Media Presets.
- Advanced knobs that stay literal: keep camera style, rendering method, layout system, texture, lighting, typography hierarchy, negative constraints, and signature mechanics fixed unless the user explicitly asks to edit them.
- Ambiguity notes: if the best image input or fields are unclear, ask one short question and suggest the safest minimal setup.
- Source-specific exclusions: list exact identities, readable text, logos, one-off props, exact pose/layout, exact landmarks, and other source details that should not become fixed style.

Preset contract rules:

- Normalize every field and image-slot key to lowercase snake_case.
- Generate a title, one-sentence description, `key`, and `workflow_key` from the analyzed style. Never reuse filenames, style numbers, old examples, or hardcoded character/style values.
- Infer `preset_kind` as `generator`, `image_transform`, or `pipeline`.
- Infer `input_mode` as `no_image`, `image_required`, or `image_optional`.
- Keep fields to 1-3 high-signal controls unless the user asks for more.
- Never use generic fields like `Subject Brief`, `Scene Brief`, `Style Notes`, `Detail Notes`, `Accent Palette`, or `Optional Notes` unless the user explicitly asks for that exact control and it is truly useful.
- Use human field labels, not planner taxonomy. Prefer labels such as `Main Character`, `Main Subject`, `Featured Object`, `Main Prop`, `Scene / Setting`, `Destination`, `Poster Title`, `Headline`, `Year`, `Outfit Style`, `Vehicle Model`, `Product`, `Top Text`, `Bottom Text`, or `Graphic Symbol`. Avoid labels such as `Hero Archetype`, `Subject Archetype`, `Hero Brief`, `Subject Brief`, `Character Role`, `Scene Brief`, or `Style Notes`.
- If the analyzed image has multiple distinct editable text/signage zones, suggest the strongest one or two separate text fields instead of collapsing them into one generic field. Examples of user-facing labels are `Top Title`, `Vertical Side Title`, `Poster Title`, `Headline`, `Subtitle`, `Track List`, `Route Name`, or `Badge Text`, chosen only when those zones are visible in the image analysis.
- If the analyzed image has a clear replaceable object, vehicle, product, outfit, character type, location, route, year, headline, sign, badge, or motif, prefer that concrete concept as the field. Do not fall back to generic wording when the image gives a more specific control.
- Do not expose fixed style traits as fields. Palette, texture, lighting, typography hierarchy, camera/rendering style, and signature composition mechanics normally stay fixed.
- Every recommended field must come from `replaceable_elements` or the detailed `visual_analysis`, not from a generic preset template.
- Recommended fields should not invent `default_value`s. Include a `default_value` only when the user explicitly supplied that value in the conversation or the visible reference text unambiguously contains the exact value the user wants editable. Otherwise use an empty string. The test graph compiler will describe what each field controls without storing fake examples.
- Create image slots only when the requested preset truly needs user-provided visual content.
- The prompt template must include every configured field as `{{field_key}}` and every configured image slot as `[[slot_key]]`.
- The prompt template must not include undefined placeholders or unused configured fields/slots.
- Do not use `{{choice:*}}` placeholders for Media Studio presets. They are not part of the executable preset contract for this path.
- Do not use product terms, internal tool terms, hidden context, or workflow planning language inside generated image prompts.

Structured reference analysis must be detailed enough that a person who cannot see the image could still visualize the source style from the analysis. Do not compress a dense image into a generic style sentence. Structured reference analysis must cover:

- content inventory: key subjects, objects, wardrobe, props, environment, visible graphic/text systems, and any readable or pseudo-readable text behavior
- spatial layout: foreground, midground, background, focal hierarchy, margins, title zones, crop, camera angle, and where major objects sit in the frame
- medium and rendering style: photo, illustration, collage, poster, 3D, comic, etc.
- palette and contrast logic: dominant colors, temperature, tonal range, accent colors
- composition and framing: aspect feel, subject scale, focal hierarchy, margins, title zones
- line and shape language: silhouettes, masks, geometry, edges, graphic devices
- subject treatment: identity handling, stylization level, pose/crop, likeness rules
- environment and prop logic: landmarks, products, rooms, props, background density
- texture and lighting: grain, paper, haze, scratches, backlight, shadow style
- typography/signage behavior when present: headline hierarchy, microtype, scripts, seals, labels
- mood and genre
- fixed style traits that must stay literal in every generated image
- replaceable elements that could become fields or image slots
- the role of each suggested image slot, for example identity/likeness source, product-shape source, vehicle source, room/background source, logo source, outfit source, or pet source
- source-specific exclusions that must not be copied exactly

Prompt rules:

- Prompts must be self-contained and visual.
- Do not say "extract style from the reference" in a generated prompt.
- Do not include product or planning language.
- Start compiled prompts with direct model-ready image language, not metadata labels.
- For image-to-image prompts, start by naming the approved image slot role, such as "Use [[portrait]] as the identity and likeness source" or "Use [[product_reference]] as the product shape and material source."
- For text-to-image prompts, start with the visual target itself, such as "Cinematic double-exposure travel poster portrait:" or "Cybernetic manga-tech poster:".
- Do not require prompts to start with "Create a [title]".
- Do not use top-level compiler labels such as "Visual direction", "Visual mechanics", "Signature style locks", "Image input", or "Creative variables" in user-facing prompt templates.
- Avoid compiler-sounding scaffolding such as "Render it as", "Shape the image with", "Compose it with", or "Treat the subject as" in final prompt templates.
- Keep useful mechanics inside natural prompt text when they help generation, such as palette, composition, typography, texture, lighting, and mood.
- Use only approved form fields and image inputs.
- For image-to-image, preserve the identity/content from the user-provided image input while applying the extracted style.
- For text-to-image, describe the full visual system directly; do not require a reference image.
- For poster/editorial styles, include layout mechanics such as title hierarchy, microtype, margins, graphic seals, aspect feel, and focal zones when those traits are visible.
- Keep source-specific exclusions in the backend JSON for planning and validation, but do not put "source", "reference", "copy the source", or "carry over source-specific details" language inside generated image prompts. Final model prompts should use visual drift constraints such as avoiding unwanted logos, stray text, weak typography, generic layouts, or unrequested identity details.

Backend-only structured brief:

For reference-image-to-Media-Preset requests, append this backend-only JSON block after the compact visible reply so Media Studio can compile a real prompt. Do not mention this block in the visible reply.

```text
REFERENCE_STYLE_BRIEF_JSON_START
{
  "title": "specific reusable style name",
  "summary": "one sentence",
  "description": "one user-facing sentence about what the preset creates",
  "key": "specific_reusable_style_key",
  "workflow_key": "media_preset.specific.reusable.style.v1",
  "target_model_mode": "text_to_image or image_edit",
  "preset_kind": "generator or image_transform or pipeline",
  "input_mode": "no_image or image_required or image_optional",
  "visual_analysis": {
    "medium": ["concrete visible trait"],
    "palette": ["concrete visible trait"],
    "line_shape_language": ["concrete visible trait"],
    "composition": ["concrete visible trait"],
    "subject_treatment": ["concrete visible trait"],
    "environment_props": ["concrete visible trait"],
    "texture_lighting": ["concrete visible trait"],
    "typography_text_energy": ["concrete visible trait"],
    "mood": ["concrete visible trait"]
  },
  "fixed_style_traits": ["reusable style mechanic"],
  "replaceable_elements": ["likely field or image input"],
  "source_specific_exclusions": ["visible source detail that should not become fixed style"],
  "negative_guidance": ["common drift to avoid"],
  "recommended_fields": [
    {"key": "snake_case_key", "label": "User Facing Label", "purpose": "why this field changes the result", "default_value": "", "required": true}
  ],
  "recommended_image_slots": [
    {"key": "snake_case_key", "label": "User Facing Label", "purpose": "what user-provided image replaces or controls", "required": true}
  ],
  "verification_targets": {
    "must_match": ["style traits output must preserve"],
    "may_vary": ["things the generated image may change"],
    "must_not_copy": ["exact source text, logos, identity, pose, or layout"]
  }
}
REFERENCE_STYLE_BRIEF_JSON_END
```

Rules for the JSON:

- Every `visual_analysis` item must be a concrete visible trait from the attached image.
- Use multiple items per category when the image is dense; do not compress a poster into one generic sentence.
- `fixed_style_traits` are reusable style mechanics, not source-specific content.
- `replaceable_elements` are likely fields or image inputs.
- `recommended_fields` and `recommended_image_slots` must be minimal, concrete, and user-facing; omit either array when the chosen variant should not use them.
- `key` and `workflow_key` must come from the analyzed reusable style, not a filename or prior style.
- Do not put user instructions, questions, model names, product wording, or workflow wording in this JSON.
- `source_specific_exclusions` must list details that should not become fixed style, such as a specific person, exact text, logos, one-off location, glasses, beard, wardrobe, exact prop, exact QR/barcode, or exact car badge.

Output comparison:

- If the latest graph output is attached for comparison, the first attached image is the latest generated output and the remaining images are the reference/style images.
- Compare the first image against the references in no more than three short bullets: what matches, what is missing, and one focused prompt delta.
- If it is save-ready, say so and ask whether to create the preset.
- Otherwise ask whether to update the current test prompt and run another test.
- Do not paste the full revised prompt in chat.

Reply format for intake:

```text
I would turn this into a [short style name] preset. The reusable style is [one concise sentence with concrete visual mechanics].

I would start with [one to three useful editable fields] as editable fields. [If useful, explain the image input in one sentence; otherwise say it can stay text-to-image.]

Do you want text-to-image, image-to-image, or both? Once you choose, I can create the test graph.
```

Normal visible replies should not sound like internal planning machinery. Avoid "plan mode", "reviewable workflow", "workflow review", "sandbox", node counts, or backend contract wording unless the user asks for implementation details. Prefer: "I would make...", "I suggest these fields...", "Want adjustments?", "Create the graph?"

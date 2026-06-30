# Preset Prompt Compiler

Use this section when compiling, showing, testing, saving, or auditing a Media Preset prompt.

Prompt rules:

- Prompts must be self-contained and visual.
- Do not say `extract style from the reference`, `use the source image style`, `copy the reference`, `based on the uploaded image`, `same as the original`, or `recreate this exact image`.
- Start with direct model-ready image language, not metadata labels.
- Do not require prompts to start with `Create a [title]`.
- Do not use top-level compiler labels such as `Visual direction`, `Visual mechanics`, `Signature style locks`, `Image input`, or `Creative variables`.
- Avoid compiler scaffolding such as `Render it as`, `Shape the image with`, `Compose it with`, or `Treat the subject as`.
- Use natural visual prompt language with concrete composition, palette, typography, texture, lighting, subject treatment, environment, and mood details.

Text-to-image:

- Start with the visual target itself.
- The prompt must describe the full visual system directly without requiring a reference image.
- Include visible layout mechanics when relevant: title hierarchy, microtype, margins, badges, panels, grid, icons, callouts, labels, aspect feel, focal zones, and text-safe areas.

Image-to-image:

- Start by naming each approved image slot role.
- Use `[[slot_key]]` placeholders in saved templates.
- State what each image controls and what must be preserved.
- Preserve identity/content from the user-provided runtime image while applying the extracted style.
- Do not invent identity details, accessories, hairstyle, wardrobe, logos, or location details unless they are visible in the provided image or requested in fields.

Fields and placeholders:

- Text fields use `{{field_key}}`.
- Image slots use `[[slot_key]]`.
- Every configured field and slot must appear in the prompt template.
- Do not include undefined placeholders.
- Do not include unused configured fields or slots.
- Do not use `{{choice:*}}` placeholders for Media Presets.

Negative guidance:

- Negative guidance should prevent likely visual drift, not add generic boilerplate.
- Useful examples: avoid stray unreadable text, random logos, watermark artifacts, generic stock-photo layout, weak typography, incorrect anatomy, accidental brand marks, cluttered composition, flat lighting when dramatic lighting is required, or loss of central layout hierarchy.
- Keep source-specific exclusions in backend JSON for planning and validation. Final model prompts should phrase them as normal visual drift constraints.

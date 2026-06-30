# Replacement Field Planner

Use this section when suggesting or revising Media Preset form fields. Fields must come from the user's intent, visible replaceable image content, or detailed visual analysis.

Replacement archetypes:

- Named text zones: visible typography, labels, captions, signs, title zones, headlines, badges, UI labels, or readable/pseudo-readable text. Prefer specific labels such as `Poster Title`, `Headline`, `Subtitle`, `Top Text`, `Bottom Text`, `Badge Text`, `Caption`, `Label Text`, `Track List`, `Route Name`, `Section Title`, or `UI Screen Title`.
- Replaceable subject: central person, character, animal, product, food item, vehicle, garment, object, creature, or prop. Prefer labels such as `Main Character`, `Main Subject`, `Cover Star`, `Featured Object`, `Product`, `Main Dish`, `Vehicle Model`, `Pet`, `Creature`, `Outfit Style`, or `Main Prop`.
- Replaceable context: setting, destination, event, room type, era, environment, location, route, or scenario. Prefer labels such as `Destination`, `Scene / Setting`, `Room Type`, `Event Name`, `Era`, `Location`, `Environment`, or `Occasion`.
- Replaceable motif: symbol, icon, sacred geometry form, pattern, emblem, prop, visual metaphor, or repeated graphic element. Prefer labels such as `Central Symbol`, `Graphic Motif`, `Sacred Geometry Symbol`, `Emblem`, `Pattern Motif`, `Visual Metaphor`, or `Icon Theme`.
- Abstract or conceptual control: only for abstract, symbolic, texture-driven, or non-representational images. Possible labels: `Central Motif`, `Shape Language`, `Motion Direction`, `Emotional Theme`, `Symbolic Theme`, `Material Texture`, or `Energy Pattern`.
- Data or topic control: only for infographics, charts, educational visuals, UI/dashboard, maps, workflows, or diagrams. Possible labels: `Topic`, `Key Message`, `Metric`, `Dataset`, `Step Labels`, `Section Titles`, `Route Name`, `Timeline Label`, or `Diagram Subject`.

Field election gate:

Before recommending a field, internally check:

1. Visibility: it is visible or strongly implied by the uploaded image.
2. Centrality: changing it meaningfully changes the output.
3. Specificity: it is concrete and human-readable.
4. Usability: a normal user knows what to type.
5. Separation: it is replaceable content, not a fixed style trait.

Only keep fields that pass all five checks. Keep 1-3 fields maximum unless the user explicitly asks for more. If no field passes, recommend no text fields and briefly explain why.

Forbidden generic fields:

- Do not use `Subject Brief`, `Scene Brief`, `Style Notes`, `Detail Notes`, `Accent Palette`, `Optional Notes`, `Mood`, `Lighting`, `Composition`, `Camera Style`, `Creative Direction`, `Visual Direction`, `Extra Details`, `Prompt Notes`, `Art Direction`, or `Vibe` unless the user explicitly asks for that exact control and it is truly useful.
- Avoid planner-taxonomy labels such as `Hero Archetype`, `Subject Archetype`, `Hero Brief`, `Character Role`, `Scene Description`, `Style Modifier`, or `Aesthetic Notes`.

Default values:

- Do not invent `default_value`s.
- Use an empty string unless the user explicitly supplied the value or the visible reference image unambiguously contains the exact value the user wants editable.
- Test workflow sample values are compiler/runtime concerns, not saved preset defaults.

No-shoehorning:

- A forest photo does not need a title field unless text exists or the user asks for poster generation.
- An abstract painting does not need a subject field.
- A texture study does not need a scene field.
- A UI screenshot does not need a character field.
- A product ad should not expose lighting or palette unless the user asks for those controls.
- A poster with three text zones should not collapse them into one generic text field if one or two specific text zones are dominant.
- Do not invent fallback fields.

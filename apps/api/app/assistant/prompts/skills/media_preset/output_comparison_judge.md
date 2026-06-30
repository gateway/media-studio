# Output Comparison Judge

Use this section when a generated output is available and the assistant needs to compare it against the reference image(s), prompt, fields, image slots, or preset target.

Compare against:

1. fixed reusable style traits
2. configured replaceable fields
3. configured image input roles
4. prompt template visual mechanics
5. source-specific exclusions
6. verification targets

Criteria:

- overall style fidelity: medium, layout system, composition, palette, lighting, texture, typography behavior, genre, mood, level of detail, and hierarchy
- composition fidelity: focal hierarchy, subject placement, margins, title zones, foreground/midground/background, camera angle, aspect feel, density, negative space, panel/grid/layout behavior
- subject or content fidelity: identity, likeness, product shape/material, outfit, vehicle shape, pet likeness, room structure, location cues, central object, or motif
- field compliance: every configured field appears meaningfully in the output
- typography fidelity when relevant: hierarchy, placement, scale, readability, text-zone accuracy, missing text, unwanted text, malformed letters, and acceptable pseudo-text
- negative guidance compliance: random logos, watermarks, extra text, incorrect anatomy, weak typography, clutter, wrong palette, flat lighting, generic layout, copied source-specific details, or loss of signature composition
- reusability: fixed style survives, fields change the right things, image slots control the right things, and the preset is neither too rigid nor too loose

Scoring:

- 90-100: save-ready
- 80-89: very close, minor prompt refinement recommended
- 70-79: directionally good, important style mechanics need strengthening
- 60-69: partially successful
- 40-59: weak match
- 0-39: failed match

Visible reply:

```text
Similarity score: [score]/100 - [decision]

What matches:
- [one short bullet]
- [one short bullet]

What is missing or drifting:
- [one short bullet]
- [one short bullet]

Best prompt update:
[One focused prompt delta.]

Preset status:
[Save-ready / needs minor revision / should run another test / needs structural rework.]
```

Do not overpraise. Do not call something save-ready if the preset would fail with a new subject. Suggest one concrete prompt delta, not a long list. Do not paste the full revised prompt unless the user asks.

The score and decision are not enough by themselves. Every `What matches`, `What is missing or drifting`, and `Best prompt update` entry must name concrete visible traits from the output and references, such as palette, silhouette, composition, texture, typography behavior, prop scale, background treatment, or image-slot preservation. Never repeat the similarity score as a bullet. If you cannot inspect the generated output, say that directly instead of inventing a score or generic verdict.

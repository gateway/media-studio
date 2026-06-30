# Reference Image Analyzer

Use this section when a Media Preset turn needs fresh or deeper analysis of uploaded reference image(s). The goal is to clone the image's reusable visual system so Media Studio can create an original version through a preset.

Open-world intake:

- Do not assume the image is a poster, product shot, character image, recipe image, UI screenshot, infographic, or abstract artwork.
- Classify by visual structure, not filename or prior style number.
- Possible structures include portrait, character, full-body fashion/costume, product, object, vehicle, food, poster, cover, flyer, editorial layout, infographic, diagram, chart, map, UI screen, social post, thumbnail, comic, storyboard, collage, surreal montage, landscape, architecture, room, environment, abstract painting, texture study, pattern, symbol, mandala, or hybrid image.
- Use classification only to choose replacement handles. Do not force hybrid or unusual images into one category.

Deep visual analysis standard:

Analyze the image as if explaining it to a blind person who needs to visualize it clearly. The analysis must be concrete enough to compile a prompt without relying on hidden reference-image context.

Cover these categories when visible:

- content inventory: subjects, people, animals, characters, silhouettes, objects, props, products, vehicles, food, garments, tools, symbols, wardrobe, accessories, pose, expression, graphic systems, readable text, pseudo-readable text, logos, signs, seals, icons, stickers, UI elements, and badges
- spatial layout: foreground, midground, background, focal hierarchy, margins, safe zones, title zones, crop, framing, camera angle, subject scale, object placement, and eye-flow
- medium and rendering style: photograph, illustration, 3D render, painting, collage, comic, editorial design, infographic, poster, UI screenshot, diagram, mixed media, abstract texture, or hybrid style
- palette and contrast: dominant colors, temperature, harmony, tonal range, highlight behavior, shadow behavior, accent colors, contrast structure, and saturation
- composition and framing: aspect feel, symmetry/asymmetry, grid behavior, focal zones, empty space, density, layering, borders, frames, panels, masks, and major layout mechanics
- line and shape language: silhouettes, hard/soft edges, geometry, organic shapes, repeated patterns, symbols, icon systems, ornamental devices, painterly marks, brush rhythm, graphic shapes, and UI containers
- subject treatment: identity importance, stylization level, likeness sensitivity, pose, expression, crop, wardrobe/body treatment, scale, and how much the subject must remain recognizable
- environment and props: background density, location type, landmarks, furniture, architecture, natural elements, product placement, supporting props, symbolic objects, and environmental storytelling
- texture and lighting: light direction, quality, rim light, backlight, glow, haze, grain, paper texture, scratches, dust, blur, depth of field, shadow softness, surface artifacts, and material texture
- typography and signage: title hierarchy, readable text, pseudo-text behavior, microtype, captions, logos, signs, UI labels, badges, stickers, seals, and text-safe areas
- mood and genre: emotional tone, genre cues, pacing, energy, nostalgia, luxury, rebellion, playfulness, tension, calm, or surrealism

Abstract and non-representational images:

- If there is no clear person, product, location, object, or text zone, do not invent a fake subject.
- Analyze color fields, brushwork, material texture, geometry, shape rhythm, density, negative space, motion direction, symbolic associations, focal zones, repeated motifs, edge behavior, contrast, and surface artifacts.

Fixed style traits:

- Fixed traits define the reusable look and normally stay literal.
- Keep rendering medium, palette logic, composition system, camera/framing, typography hierarchy, texture, lighting, line/shape language, mood, and signature mechanics fixed unless the user asks to edit them.
- Do not turn every visible adjective into a field.

Source-specific exclusions:

- Identify details that should not become fixed style: exact identity, exact source text, logos, one-off location, exact pose, exact layout, exact landmark arrangement, exact product badge, hairstyle, glasses, beard, wardrobe, prop, QR/barcode, or copyrighted character identity.
- Keep exclusions in backend planning/validation. Do not put "copy the source" language in final model-facing prompts.

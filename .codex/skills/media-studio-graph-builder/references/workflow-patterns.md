# Workflow Patterns

Use these as graph construction shortcuts before inspecting source.

## Image Model Starter

Template: `content/graph-workflows/image-models-starter.media-studio-graph.json`

- One group per model lane.
- Keep only one paid lane enabled by default; set other groups to frozen.
- Text-to-image lane: model node -> preview image -> save image.
- Image-to-image lane: load image -> model image input; model image output -> preview image and save image.
- Add a note node outside the groups with short instructions and links.

## Prompt Recipe To Image

- Load image nodes feed `prompt.recipe` `image_refs` when the recipe supports images.
- Prompt recipe text output feeds the image/video model prompt input.
- Add validation copy in a note when images are optional versus required.
- If the recipe prompt mentions image references, wire image refs or leave a clear warning.

## Suno Music

- Suno generate music outputs `music_track` values.
- Each track should feed a separate Save Music Track node.
- Save Music Track displays cover plus audio and can output the saved audio for downstream use.
- Do not split Suno covers and audio into generic save-image/save-audio lanes for normal templates.

## Notes And Groups

- Group names should describe the lane, such as `GPT Image 2 - Text to Image`.
- Node custom titles can be short, but model node subtitles still show the original model name.
- Notes should sit near the top-left of the template, outside the group they explain.
- Use Markdown lists, short paragraphs, and normal sentence case.

## Video Model Starters

- Keep source-dependent lanes frozen by default.
- Text-to-video lane: prompt text -> model prompt input; model video output -> preview video and save video.
- Image-to-video lane: prompt text -> model prompt input; load image nodes -> required/optional image ports; model video output -> preview video and save video.
- Motion-control lane: prompt text -> model prompt input; load image -> image reference; load video -> driving/video reference; model video output -> preview video and save video.

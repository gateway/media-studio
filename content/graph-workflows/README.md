# Graph Workflows

Store portable Graph Studio workflows here.

Expected export formats:

- `.media-studio-graph.json` for structure-only workflows.
- `.media-studio-graph.zip` for workflows that include portable reference media.

Before committing a workflow, confirm export sanitization removed API keys, absolute local paths, data URLs, cookies, and private reference material.

## Curated Workflows

- `image-models-starter.media-studio-graph.json`: grouped starter lanes for GPT Image 2 text-to-image, GPT Image 2 image-to-image, Nano Banana 2, and Nano Banana Pro. The image-to-image lanes intentionally ship with empty source-image placeholders so users can choose their own reference media after import.

## Workflows

- `kling-3-0-workflows.media-studio-graph.json`: three-lane Kling 3.0 starter for text-to-video, image-to-video, and motion control.
- `kling-2-6-video.media-studio-graph.json`: two-lane Kling 2.6 starter for text-to-video and image-to-video, with prompt, preview, save, and guide-note nodes.

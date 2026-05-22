import { readFile } from "node:fs/promises";

import { resolvePromptRecipeThumbnailCandidatePaths } from "@/lib/prompt-recipe-thumbnail-storage";

type RouteContext = {
  params: Promise<{
    path: string[];
  }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
  const resolved = await params;
  const relativePath = resolved.path.join("/");

  for (const absolutePath of resolvePromptRecipeThumbnailCandidatePaths(relativePath)) {
    try {
      const buffer = await readFile(absolutePath);
      return new Response(buffer, {
        status: 200,
        headers: {
          "content-type": "image/webp",
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
    } catch {
      continue;
    }
  }

  return new Response("Not found", { status: 404 });
}

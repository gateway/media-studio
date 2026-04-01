import { access, readFile } from "node:fs/promises";
import path from "node:path";

const PRESET_THUMBNAILS_DIR = path.resolve(process.cwd(), "..", "..", "data", "preset-thumbnails");

type RouteContext = {
  params: Promise<{
    path: string[];
  }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
  const resolved = await params;
  const relativePath = resolved.path.join("/");
  const safePath = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");
  const absolutePath = path.join(PRESET_THUMBNAILS_DIR, safePath);

  try {
    await access(absolutePath);
    const buffer = await readFile(absolutePath);
    return new Response(buffer, {
      status: 200,
      headers: {
        "content-type": "image/webp",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

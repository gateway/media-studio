import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { NextResponse } from "next/server";
import path from "node:path";

import { isTrustedLocalRequest } from "@/lib/admin-access";

const routeDir = path.dirname(fileURLToPath(import.meta.url));
const defaultOutputsPath = path.resolve(routeDir, "..", "..", "..", "..", "..", "..", "data", "outputs");
const MEDIA_OUTPUTS_PATH = process.env.MEDIA_STUDIO_OUTPUTS_PATH || defaultOutputsPath;
const execFileAsync = promisify(execFile);

export async function POST(request: Request) {
  const url = new URL(request.url);
  if (!isTrustedLocalRequest(url, request.headers)) {
    return NextResponse.json({ ok: false, error: "Opening the outputs folder is limited to local operator requests." }, { status: 403 });
  }
  try {
    await access(MEDIA_OUTPUTS_PATH);
    await execFileAsync("open", [MEDIA_OUTPUTS_PATH]);
    return NextResponse.json({ ok: true, path: MEDIA_OUTPUTS_PATH });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to open the media outputs folder.",
      },
      { status: 500 },
    );
  }
}

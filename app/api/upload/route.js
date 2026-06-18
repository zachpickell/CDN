import { NextResponse } from "next/server";
import { saveStream } from "@/lib/store";
import { isAuthed } from "@/lib/guard";

export const runtime = "nodejs";
// Don't let Next try to buffer/parse the body — we stream it ourselves.
export const dynamic = "force-dynamic";
export const maxDuration = 3600; // allow long uploads (seconds)

export async function POST(request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!request.body) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  // The client sends the raw file as the body, with the name in a header.
  const rawName = request.headers.get("x-filename");
  const originalName = rawName ? decodeURIComponent(rawName) : "file";
  const mime =
    request.headers.get("x-filetype") ||
    request.headers.get("content-type") ||
    "application/octet-stream";

  try {
    const entry = await saveStream({
      originalName,
      mime,
      webStream: request.body,
    });

    if (entry.size === 0) {
      return NextResponse.json({ error: "File is empty" }, { status: 400 });
    }

    return NextResponse.json({
      token: entry.token,
      name: entry.originalName,
      size: entry.size,
      uploadedAt: entry.uploadedAt,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Upload failed while saving" },
      { status: 500 }
    );
  }
}

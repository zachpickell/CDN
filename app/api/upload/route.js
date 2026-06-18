import { NextResponse } from "next/server";
import { appendChunk, finalizeUpload, abortUpload } from "@/lib/store";
import { isAuthed } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

// Each request carries one small chunk of the file. The body is intentionally
// small (a few MB), so reading it with arrayBuffer() is cheap and reliable.
export async function POST(request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const uploadId = request.headers.get("x-upload-id");
  const chunkIndex = Number(request.headers.get("x-chunk-index"));
  const totalChunks = Number(request.headers.get("x-total-chunks"));
  const rawName = request.headers.get("x-filename");
  const originalName = rawName ? decodeURIComponent(rawName) : "file";
  const mime = request.headers.get("x-filetype") || "application/octet-stream";

  if (
    !uploadId ||
    !Number.isInteger(chunkIndex) ||
    !Number.isInteger(totalChunks) ||
    chunkIndex < 0 ||
    totalChunks < 1 ||
    chunkIndex >= totalChunks
  ) {
    return NextResponse.json({ error: "Bad chunk metadata" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await request.arrayBuffer());
    await appendChunk(uploadId, buffer);

    // Not the last chunk — acknowledge and wait for more.
    if (chunkIndex < totalChunks - 1) {
      return NextResponse.json({ ok: true });
    }

    // Last chunk — assemble the final file.
    const entry = await finalizeUpload({ uploadId, originalName, mime });
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
    // Best-effort cleanup of any partial temp file.
    await abortUpload(uploadId).catch(() => {});
    return NextResponse.json(
      { error: "Upload failed while saving" },
      { status: 500 }
    );
  }
}

// Called when the user cancels mid-upload — discard the partial temp file.
export async function DELETE(request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const uploadId = new URL(request.url).searchParams.get("uploadId");
  if (uploadId) await abortUpload(uploadId).catch(() => {});
  return NextResponse.json({ ok: true });
}

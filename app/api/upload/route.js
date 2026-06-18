import { NextResponse } from "next/server";
import { appendChunk, finalizeUpload, abortUpload } from "@/lib/store";
import { isAuthed } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

// Protocol (all keyed by X-Upload-Id):
//   - A normal request carries a small slice of the file as its body; we append
//     it to the upload's temp file. Chunk size is decided by the client and can
//     vary (it shrinks itself if a proxy rejects a chunk), so the server does
//     not care about chunk indices — it just appends bytes in arrival order.
//   - A request with "X-Finalize: 1" (and an empty body) promotes the temp file
//     into the store and returns the file metadata.
export async function POST(request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const uploadId = request.headers.get("x-upload-id");
  if (!uploadId) {
    return NextResponse.json({ error: "Missing upload id" }, { status: 400 });
  }

  try {
    if (request.headers.get("x-finalize") === "1") {
      const rawName = request.headers.get("x-filename");
      const originalName = rawName ? decodeURIComponent(rawName) : "file";
      const mime =
        request.headers.get("x-filetype") || "application/octet-stream";
      const folderHeader = request.headers.get("x-folder-id");
      const folderId = folderHeader ? decodeURIComponent(folderHeader) : null;

      const entry = await finalizeUpload({
        uploadId,
        originalName,
        mime,
        folderId,
      });
      if (entry.size === 0) {
        return NextResponse.json({ error: "File is empty" }, { status: 400 });
      }
      return NextResponse.json({
        token: entry.token,
        name: entry.originalName,
        size: entry.size,
        folderId: entry.folderId ?? null,
        uploadedAt: entry.uploadedAt,
      });
    }

    const buffer = Buffer.from(await request.arrayBuffer());
    await appendChunk(uploadId, buffer);
    return NextResponse.json({ ok: true });
  } catch (err) {
    await abortUpload(uploadId).catch(() => {});
    return NextResponse.json(
      { error: "Upload failed while saving" },
      { status: 500 }
    );
  }
}

// Cancel mid-upload — discard the partial temp file.
export async function DELETE(request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const uploadId = new URL(request.url).searchParams.get("uploadId");
  if (uploadId) await abortUpload(uploadId).catch(() => {});
  return NextResponse.json({ ok: true });
}

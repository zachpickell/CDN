import { NextResponse } from "next/server";
import { listFiles, deleteFile, moveFile, renameFile } from "@/lib/store";
import { isAuthed } from "@/lib/guard";

export const runtime = "nodejs";

export async function GET() {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const files = await listFiles();
  return NextResponse.json({
    files: files.map((f) => ({
      token: f.token,
      name: f.originalName,
      size: f.size,
      folderId: f.folderId ?? null,
      uploadedAt: f.uploadedAt,
    })),
  });
}

// Rename and/or move a file. Body: { token, name?, folderId? }
export async function PATCH(request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!body?.token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }
  try {
    let entry = null;
    if (typeof body.name === "string") {
      entry = await renameFile(body.token, body.name);
      if (!entry) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
    }
    if (body.folderId !== undefined) {
      entry = await moveFile(body.token, body.folderId ?? null);
      if (!entry) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
    }
    if (!entry) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    return NextResponse.json({
      file: {
        token: entry.token,
        name: entry.originalName,
        size: entry.size,
        folderId: entry.folderId ?? null,
        uploadedAt: entry.uploadedAt,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function DELETE(request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = new URL(request.url).searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }
  const ok = await deleteFile(token);
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

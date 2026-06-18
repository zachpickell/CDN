import { NextResponse } from "next/server";
import {
  listFolders,
  createFolder,
  renameFolder,
  moveFolder,
  deleteFolder,
} from "@/lib/store";
import { isAuthed } from "@/lib/guard";

export const runtime = "nodejs";

function publicFolder(f) {
  return { id: f.id, name: f.name, parentId: f.parentId, createdAt: f.createdAt };
}

export async function GET() {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const folders = await listFolders();
  return NextResponse.json({ folders: folders.map(publicFolder) });
}

export async function POST(request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    const folder = await createFolder({
      name: body?.name,
      parentId: body?.parentId ?? null,
    });
    return NextResponse.json({ folder: publicFolder(folder) });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

// Rename and/or move a folder. Body: { id, name?, parentId? }
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
  if (!body?.id) {
    return NextResponse.json({ error: "Missing folder id" }, { status: 400 });
  }
  try {
    let folder = null;
    if (typeof body.name === "string") {
      folder = await renameFolder(body.id, body.name);
      if (!folder) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
    }
    if (body.parentId !== undefined) {
      folder = await moveFolder(body.id, body.parentId);
      if (!folder) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
    }
    if (!folder) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    return NextResponse.json({ folder: publicFolder(folder) });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function DELETE(request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing folder id" }, { status: 400 });
  }
  const ok = await deleteFolder(id);
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

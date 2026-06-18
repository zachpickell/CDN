import { NextResponse } from "next/server";
import { listFiles, deleteFile } from "@/lib/store";
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
      uploadedAt: f.uploadedAt,
    })),
  });
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

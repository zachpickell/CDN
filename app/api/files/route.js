import { NextResponse } from "next/server";
import { listFiles, deleteFile } from "@/lib/store";

// Protected by middleware (session required).
export const runtime = "nodejs";

export async function GET() {
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

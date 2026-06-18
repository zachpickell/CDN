import { NextResponse } from "next/server";
import { saveFile } from "@/lib/store";

// Protected by middleware (session required).
export const runtime = "nodejs";

export async function POST(request) {
  let formData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || typeof file.arrayBuffer !== "function") {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length === 0) {
    return NextResponse.json({ error: "File is empty" }, { status: 400 });
  }

  const entry = await saveFile({
    originalName: file.name,
    mime: file.type,
    bytes,
  });

  return NextResponse.json({
    token: entry.token,
    name: entry.originalName,
    size: entry.size,
    uploadedAt: entry.uploadedAt,
  });
}

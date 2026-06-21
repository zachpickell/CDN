import { NextResponse } from "next/server";
import { storageStats } from "@/lib/store";
import { isAuthed } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const stats = await storageStats();
  return NextResponse.json(stats);
}

import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/guard";
import { collectionInfo } from "@/lib/rag";
import { runIndex } from "@/lib/indexer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A tiny in-process guard so two overlapping reindex requests don't stampede
// Ollama. State is per Node process; the systemd/cron job is the real workhorse
// — this route is for on-demand "I just added files, index them now".
let running = false;
let last = null;

// GET -> status: whether a run is in flight, the last run's summary, and the
// current vector count in Qdrant.
export async function GET() {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const info = await collectionInfo();
  return NextResponse.json({
    running,
    last,
    vectors: info?.points_count ?? null,
    indexed: info?.points_count != null,
  });
}

// POST -> kick off a reindex. Returns immediately; poll GET for completion.
export async function POST() {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (running) {
    return NextResponse.json({ ok: true, alreadyRunning: true });
  }
  running = true;
  const startedAt = Date.now();
  // Fire and forget — don't hold the request open for a long index.
  runIndex({ log: (m) => console.log("[rag-index]", m) })
    .then((summary) => {
      last = { ...summary, startedAt, finishedAt: Date.now(), ok: true };
    })
    .catch((err) => {
      last = { error: err.message, startedAt, finishedAt: Date.now(), ok: false };
    })
    .finally(() => {
      running = false;
    });
  return NextResponse.json({ ok: true, started: true });
}

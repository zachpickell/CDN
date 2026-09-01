import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/guard";
import { embed, search } from "@/lib/rag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { query, k?, kind? } -> { hits: [{ path, name, rel, root, ext, kind,
// token, score, snippet }] }. `kind` optionally filters to "code" or "doc".
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
  const query = (body?.query || "").trim();
  if (!query) {
    return NextResponse.json({ error: "Missing query" }, { status: 400 });
  }
  const limit = Math.min(Math.max(Number(body?.k) || 8, 1), 25);
  const filter =
    body?.kind === "code" || body?.kind === "doc"
      ? { must: [{ key: "kind", match: { value: body.kind } }] }
      : undefined;

  try {
    const vector = await embed(query);
    const results = await search(vector, { limit, filter });
    const hits = results.map((r) => {
      const p = r.payload || {};
      const text = p.chunk || "";
      return {
        path: p.path,
        name: p.name,
        rel: p.rel,
        root: p.root,
        ext: p.ext,
        kind: p.kind,
        token: p.token || null,
        score: r.score,
        snippet: text.length > 400 ? `${text.slice(0, 400)}…` : text,
      };
    });
    return NextResponse.json({ hits });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}

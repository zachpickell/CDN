import { isAuthed } from "@/lib/guard";
import { embed, search, chatStream } from "@/lib/rag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { query, k?, kind? }
// Retrieves the top chunks, then streams a grounded answer as plain text.
// The chosen sources are returned up-front in the `X-RAG-Sources` response
// header (base64-encoded JSON) so the UI can show citations before/while the
// answer streams in.
export async function POST(request) {
  if (!(await isAuthed())) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const query = (body?.query || "").trim();
  if (!query) {
    return new Response(JSON.stringify({ error: "Missing query" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const limit = Math.min(Math.max(Number(body?.k) || 6, 1), 12);
  const filter =
    body?.kind === "code" || body?.kind === "doc"
      ? { must: [{ key: "kind", match: { value: body.kind } }] }
      : undefined;

  let results;
  try {
    const vector = await embed(query);
    results = await search(vector, { limit, filter });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }

  if (!results.length) {
    const sources = Buffer.from("[]").toString("base64");
    return new Response(
      "I couldn't find anything relevant in your indexed files for that. Try rephrasing, or re-index if the files are new.",
      { headers: { "content-type": "text/plain; charset=utf-8", "x-rag-sources": sources } }
    );
  }

  // De-dupe sources by file for the citation list, but keep every chunk for
  // the model's context (numbered so it can cite [1], [2], …).
  const sourceList = [];
  const seenPath = new Map();
  const contextBlocks = results.map((r, i) => {
    const p = r.payload || {};
    if (!seenPath.has(p.path)) {
      seenPath.set(p.path, sourceList.length + 1);
      sourceList.push({
        n: sourceList.length + 1,
        name: p.name,
        rel: p.rel,
        root: p.root,
        token: p.token || null,
        score: r.score,
      });
    }
    const n = seenPath.get(p.path);
    return `[${n}] ${p.rel || p.name}\n${p.chunk || ""}`;
  });

  const system =
    "You answer questions using ONLY the provided context from the user's own files. " +
    "Cite the sources you use inline with bracketed numbers like [1] that match the context blocks. " +
    "If the context doesn't contain the answer, say so plainly instead of guessing. " +
    "Be concise and concrete.";
  const user =
    `Question: ${query}\n\n` +
    `Context from the user's files:\n\n${contextBlocks.join("\n\n---\n\n")}\n\n` +
    `Answer the question using only this context, citing sources inline as [n].`;

  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const piece of chatStream(messages)) {
          controller.enqueue(encoder.encode(piece));
        }
      } catch (err) {
        controller.enqueue(encoder.encode(`\n\n[error: ${err.message}]`));
      } finally {
        controller.close();
      }
    },
  });

  const sourcesHeader = Buffer.from(JSON.stringify(sourceList)).toString("base64");
  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-rag-sources": sourcesHeader,
    },
  });
}

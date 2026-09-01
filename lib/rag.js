// RAG plumbing: talks to a local Ollama (embeddings + chat) and a self-hosted
// Qdrant vector store over plain HTTP. Zero npm dependencies — Node 18+ ships a
// global fetch, which is all we need. Node-only (used from route handlers and
// the indexer script); keep it off the Edge runtime.
//
// Config comes from env (all optional except that Ollama/Qdrant must be
// reachable):
//   OLLAMA_URL        default http://127.0.0.1:11434
//   QDRANT_URL        default http://127.0.0.1:6333
//   QDRANT_API_KEY    optional; sent as `api-key` header when set
//   RAG_EMBED_MODEL   default nomic-embed-text     (768-dim, fast, local)
//   RAG_CHAT_MODEL    default qwen2.5:7b-instruct  (grounded answer generation)
//   RAG_COLLECTION    default cdn_rag
//   RAG_EMBED_DIM     default 768  (must match the embed model's vector size)

export const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
export const QDRANT_URL = (process.env.QDRANT_URL || "http://127.0.0.1:6333").replace(/\/$/, "");
export const QDRANT_API_KEY = process.env.QDRANT_API_KEY || "";
export const EMBED_MODEL = process.env.RAG_EMBED_MODEL || "nomic-embed-text";
export const CHAT_MODEL = process.env.RAG_CHAT_MODEL || "qwen2.5:7b-instruct";
export const COLLECTION = process.env.RAG_COLLECTION || "cdn_rag";
export const EMBED_DIM = Number(process.env.RAG_EMBED_DIM || 768);

function qdrantHeaders() {
  const h = { "content-type": "application/json" };
  if (QDRANT_API_KEY) h["api-key"] = QDRANT_API_KEY;
  return h;
}

async function qdrant(path, { method = "GET", body } = {}) {
  const res = await fetch(`${QDRANT_URL}${path}`, {
    method,
    headers: qdrantHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const msg = json?.status?.error || json?.status || text || res.statusText;
    throw new Error(`Qdrant ${method} ${path} failed (${res.status}): ${msg}`);
  }
  return json;
}

/* -------------------------------- Ollama --------------------------------- */

// Embed a single string. Ollama's /api/embeddings returns { embedding: [...] }.
export async function embed(text) {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });
  if (!res.ok) {
    throw new Error(`Ollama embeddings failed (${res.status}): ${await res.text()}`);
  }
  const json = await res.json();
  if (!Array.isArray(json.embedding)) {
    throw new Error("Ollama embeddings: no embedding in response");
  }
  return json.embedding;
}

// Embed many strings sequentially. Ollama serializes model calls anyway, so a
// small concurrency wouldn't help much and would spike memory; keep it simple.
export async function embedBatch(texts) {
  const out = [];
  for (const t of texts) out.push(await embed(t));
  return out;
}

// Stream a chat completion. Yields text deltas as they arrive so the API route
// can pipe them straight to the browser. Uses Ollama's /api/chat NDJSON stream.
export async function* chatStream(messages, { temperature = 0.2 } = {}) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages,
      stream: true,
      options: { temperature },
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Ollama chat failed (${res.status}): ${await res.text().catch(() => "")}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      const piece = obj?.message?.content;
      if (piece) yield piece;
      if (obj?.done) return;
    }
  }
}

/* -------------------------------- Qdrant --------------------------------- */

// Create the collection if it isn't there yet (cosine distance over EMBED_DIM).
export async function ensureCollection() {
  try {
    await qdrant(`/collections/${COLLECTION}`);
    return; // already exists
  } catch {
    /* fall through to create */
  }
  await qdrant(`/collections/${COLLECTION}`, {
    method: "PUT",
    body: { vectors: { size: EMBED_DIM, distance: "Cosine" } },
  });
  // Index the payload fields we filter on so filtered search stays fast.
  for (const field of ["path", "root", "ext"]) {
    try {
      await qdrant(`/collections/${COLLECTION}/index`, {
        method: "PUT",
        body: { field_name: field, field_schema: "keyword" },
      });
    } catch {
      /* index may already exist */
    }
  }
}

// Upsert an array of points: { id, vector, payload }.
export async function upsertPoints(points) {
  if (!points.length) return;
  await qdrant(`/collections/${COLLECTION}/points?wait=true`, {
    method: "PUT",
    body: { points },
  });
}

// Delete every point belonging to a given file path (used when a file changes
// or is removed, so we never serve stale chunks).
export async function deleteByPath(path) {
  await qdrant(`/collections/${COLLECTION}/points/delete?wait=true`, {
    method: "POST",
    body: { filter: { must: [{ key: "path", match: { value: path } }] } },
  });
}

// Vector search. `filter` is an optional Qdrant filter object.
export async function search(vector, { limit = 6, filter } = {}) {
  const json = await qdrant(`/collections/${COLLECTION}/points/search`, {
    method: "POST",
    body: { vector, limit, with_payload: true, filter },
  });
  return json?.result || [];
}

export async function collectionInfo() {
  try {
    const json = await qdrant(`/collections/${COLLECTION}`);
    return json?.result || null;
  } catch {
    return null;
  }
}

#!/usr/bin/env node
// End-to-end diagnostic for the RAG pipeline. Runs the exact steps the
// /api/rag/ask route runs — using the SAME .env.local config the app uses — and
// prints a pass/fail with the real error at each stage, so you can see exactly
// where it breaks (config, Ollama, Qdrant, or the model).
//
//   node scripts/rag-doctor.mjs            # uses .env.local
//   node scripts/rag-doctor.mjs "custom question"
//
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    try {
      const raw = await fs.readFile(path.join(root, name), "utf8");
      for (const line of raw.split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const eq = t.indexOf("=");
        if (eq === -1) continue;
        const k = t.slice(0, eq).trim();
        let v = t.slice(eq + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (!(k in process.env)) process.env[k] = v;
      }
    } catch {}
  }
}

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const step = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`);

await loadEnv();
const rag = await import(path.join(root, "lib", "rag.js"));

console.log("\n=== RAG doctor ===");
step("1. Config the app is using");
console.log(`  OLLAMA_URL  = ${rag.OLLAMA_URL}`);
console.log(`  QDRANT_URL  = ${rag.QDRANT_URL}`);
console.log(`  EMBED_MODEL = ${rag.EMBED_MODEL}`);
console.log(`  CHAT_MODEL  = ${rag.CHAT_MODEL}`);
console.log(`  COLLECTION  = ${rag.COLLECTION}`);
// Sanity-check the URLs actually parse and look like host:port (catches the
// mangled-IP problem).
for (const [name, url] of [["OLLAMA_URL", rag.OLLAMA_URL], ["QDRANT_URL", rag.QDRANT_URL]]) {
  try {
    const u = new URL(url);
    if (/[^0-9.:a-fA-F\[\]]/.test(u.hostname)) bad(`${name} hostname looks malformed: "${u.hostname}"`);
    else ok(`${name} parses (host ${u.hostname}, port ${u.port})`);
  } catch (e) {
    bad(`${name} is not a valid URL: ${e.message}`);
  }
}

let vector = null;
step("2. Ollama — reachable + embeddings");
try {
  const r = await fetch(`${rag.OLLAMA_URL}/api/tags`);
  const j = await r.json();
  ok(`Ollama reachable — ${j.models?.length ?? 0} models installed`);
  const names = (j.models || []).map((m) => m.name);
  if (!names.some((n) => n.startsWith(rag.EMBED_MODEL))) bad(`embed model "${rag.EMBED_MODEL}" not in: ${names.join(", ") || "(none)"}`);
  if (!names.some((n) => n.startsWith(rag.CHAT_MODEL.split(":")[0]))) bad(`chat model "${rag.CHAT_MODEL}" not found in: ${names.join(", ") || "(none)"}`);
} catch (e) {
  bad(`cannot reach Ollama at ${rag.OLLAMA_URL} — ${e.message}`);
}
try {
  vector = await rag.embed("what projects do I have");
  ok(`embeddings work — vector length ${vector.length} (collection expects ${rag.EMBED_DIM})`);
  if (vector.length !== rag.EMBED_DIM) bad(`DIMENSION MISMATCH: embed model gives ${vector.length}, RAG_EMBED_DIM=${rag.EMBED_DIM}. Fix RAG_EMBED_DIM and re-index.`);
} catch (e) {
  bad(`embedding failed — ${e.message}`);
}

step("3. Qdrant — collection + search");
try {
  const info = await rag.collectionInfo();
  if (!info) bad("collection not found or Qdrant unreachable");
  else {
    ok(`collection "${rag.COLLECTION}" — ${info.points_count} chunks, vector size ${info.config?.params?.vectors?.size}`);
    if (info.points_count === 0) bad("collection is EMPTY — run scripts/rag-index.mjs");
  }
} catch (e) {
  bad(`Qdrant collection check failed — ${e.message}`);
}
let hits = [];
if (vector) {
  try {
    hits = await rag.search(vector, { limit: 5 });
    ok(`search returned ${hits.length} hits`);
    hits.forEach((h, i) => console.log(`     [${i + 1}] ${(h.score).toFixed(3)}  ${h.payload?.rel || h.payload?.name}`));
    if (!hits.length) bad("search returned 0 hits — index empty, or query embedding dim != stored dim");
  } catch (e) {
    bad(`search failed — ${e.message}`);
  }
}

step("4. Chat — grounded answer (this is the slow one on CPU)");
if (hits.length) {
  const ctx = hits.map((h, i) => `[${i + 1}] ${h.payload?.rel}\n${h.payload?.chunk || ""}`).join("\n\n---\n\n");
  const messages = [
    { role: "system", content: "Answer using ONLY the provided context. Cite [n]. Be concise." },
    { role: "user", content: `Question: what projects do I have?\n\nContext:\n${ctx}` },
  ];
  try {
    const t0 = Date.now();
    let answer = "";
    let firstAt = null;
    for await (const piece of rag.chatStream(messages)) {
      if (firstAt === null) firstAt = Date.now();
      answer += piece;
    }
    ok(`answer generated — first token in ${((firstAt - t0) / 1000).toFixed(1)}s, full in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log("\n\x1b[36m--- answer ---\x1b[0m\n" + answer + "\n\x1b[36m--------------\x1b[0m");
  } catch (e) {
    bad(`chat failed — ${e.message}`);
  }
} else {
  console.log("  (skipped — no search hits to ground on)");
}

console.log("\n=== done ===");
console.log("If every step above is ✓, the code + services are fine and the browser 502 is a");
console.log("container→host networking or Cloudflare issue — run the docker exec test next.\n");

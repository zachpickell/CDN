#!/usr/bin/env node
// Standalone entry point for indexing — run by cron, a systemd timer, or by
// hand. It reuses the app's own indexer, so it honors the same env vars
// (DATA_DIR, OLLAMA_URL, QDRANT_URL, RAG_* …). Load .env.local first if present
// so a manual run matches how the app is configured.
//
//   node scripts/rag-index.mjs
//
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Minimal .env.local loader (no dependency) — KEY=VALUE lines, # comments.
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
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        if (!(k in process.env)) process.env[k] = v;
      }
    } catch {
      /* no such file — fine */
    }
  }
}

await loadEnv();
const { runIndex } = await import(path.join(root, "lib", "indexer.js"));

const started = Date.now();
console.log(`[rag-index] starting at ${new Date().toISOString()}`);
try {
  await runIndex({ log: (m) => console.log("[rag-index]", m) });
  console.log(`[rag-index] finished in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  process.exit(0);
} catch (err) {
  console.error("[rag-index] failed:", err.message);
  process.exit(1);
}

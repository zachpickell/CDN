// The indexer: turn files on disk into searchable vectors in Qdrant.
//
// It walks the CDN store (DATA_DIR/files) plus any extra roots listed in
// RAG_EXTRA_ROOTS (comma-separated absolute paths — e.g. a code directory that
// isn't served by the CDN). For each text-extractable file it pulls out text,
// splits it into overlapping chunks, embeds each chunk with Ollama, and upserts
// the vectors into Qdrant.
//
// It's incremental: a small state file (DATA_DIR/rag-index.json) records each
// file's mtime+size, so re-runs only touch files that changed, and files that
// vanished get their vectors deleted. That makes it safe to run on a timer.
//
// Node-only. Run it from scripts/rag-index.mjs (cron/systemd) or via the
// /api/rag/reindex route.

import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { spawn } from "child_process";
import {
  ensureCollection,
  embedBatch,
  upsertPoints,
  deleteByPath,
} from "./rag.js";

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), "storage");
const FILES_DIR = path.join(DATA_DIR, "files");
const META_PATH = path.join(DATA_DIR, "metadata.json");
const STATE_PATH = path.join(DATA_DIR, "rag-index.json");

const EXTRA_ROOTS = (process.env.RAG_EXTRA_ROOTS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((p) => path.resolve(p));

// Chunking (character-based — cheap and model-agnostic; ~4 chars/token, so
// 3200 chars ≈ 800 tokens with 400-char overlap).
const CHUNK_CHARS = 3200;
const OVERLAP_CHARS = 400;
const MAX_FILE_BYTES = 8 * 1024 * 1024; // skip anything bigger than 8 MB

// Extensions we read directly as UTF-8 text (docs + code + config).
const TEXT_EXT = new Set([
  "txt", "md", "markdown", "rst", "log", "csv", "tsv", "json", "jsonl",
  "yaml", "yml", "toml", "ini", "env", "xml", "html", "htm", "css", "scss",
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "rb", "go", "rs", "java",
  "kt", "c", "h", "cpp", "hpp", "cc", "cs", "php", "swift", "sh", "bash",
  "zsh", "sql", "graphql", "vue", "svelte", "lua", "r", "pl", "dockerfile",
]);
const CODE_EXT = new Set([
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "rb", "go", "rs", "java",
  "kt", "c", "h", "cpp", "hpp", "cc", "cs", "php", "swift", "sh", "bash",
  "zsh", "sql", "graphql", "vue", "svelte", "lua", "r", "pl",
]);

function extOf(name) {
  const base = name.toLowerCase();
  if (base === "dockerfile") return "dockerfile";
  const i = base.lastIndexOf(".");
  return i === -1 ? "" : base.slice(i + 1);
}

function isIgnoredName(name) {
  const n = name.toLowerCase();
  if (name.startsWith(".") || name.startsWith("~$")) return true;
  return n === "thumbs.db" || n === "desktop.ini" || n === "metadata.json" ||
    n === "rag-index.json" || n === "node_modules" || n === ".git";
}

/* --------------------------- text extraction ----------------------------- */

// Run pdftotext (poppler) if present. Returns "" when it isn't installed or the
// PDF has no extractable text (scanned PDFs need OCR, which is out of scope).
function pdfToText(absPath) {
  return new Promise((resolve) => {
    let out = "";
    let started = false;
    let proc;
    try {
      proc = spawn("pdftotext", ["-layout", "-q", absPath, "-"]);
      started = true;
    } catch {
      resolve("");
      return;
    }
    proc.stdout.on("data", (d) => (out += d.toString("utf8")));
    proc.on("error", () => resolve("")); // binary not found
    proc.on("close", () => resolve(started ? out : ""));
  });
}

async function extractText(absPath, ext) {
  if (TEXT_EXT.has(ext)) {
    const buf = await fs.readFile(absPath);
    // Skip files that look binary (a NUL byte in the first 8 KB).
    if (buf.subarray(0, 8192).includes(0)) return "";
    return buf.toString("utf8");
  }
  if (ext === "pdf") return pdfToText(absPath);
  // docx/pptx/etc. are left for a follow-up (they need a zip+xml extractor).
  return "";
}

function chunkText(text) {
  const clean = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  if (!clean) return [];
  const chunks = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(i + CHUNK_CHARS, clean.length);
    // Prefer to break on a paragraph/line boundary near the end of the window.
    if (end < clean.length) {
      const slice = clean.slice(i, end);
      const nl = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"));
      if (nl > CHUNK_CHARS * 0.5) end = i + nl;
    }
    const piece = clean.slice(i, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    i = Math.max(end - OVERLAP_CHARS, i + 1);
  }
  return chunks;
}

// Deterministic point id from path + chunk index (so re-upserts overwrite).
function pointId(filePath, idx) {
  return crypto.createHash("sha1").update(`${filePath}#${idx}`).digest("hex")
    // Qdrant accepts unsigned-int or UUID ids; format the hash as a UUID.
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, "$1-$2-$3-$4-$5");
}

/* ------------------------------- walking --------------------------------- */

async function* walk(absDir) {
  let entries;
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (isIgnoredName(ent.name)) continue;
    const abs = path.join(absDir, ent.name);
    if (ent.isDirectory()) {
      yield* walk(abs);
    } else if (ent.isFile()) {
      yield abs;
    }
  }
}

async function readJson(p, fallback) {
  try {
    return JSON.parse(await fs.readFile(p, "utf8"));
  } catch {
    return fallback;
  }
}

// Map absolute path -> share token, so search hits can link to /f/<token>.
async function tokenMap() {
  const meta = await readJson(META_PATH, { files: {} });
  const map = new Map();
  for (const [rel, m] of Object.entries(meta.files || {})) {
    if (m?.token) map.set(path.join(FILES_DIR, ...rel.split("/")), m.token);
  }
  return map;
}

/* ------------------------------ the run ---------------------------------- */

// roots: [{ root, label }]. The CDN store is labelled "cdn"; extra roots use
// their basename so citations can show where a file came from.
function rootsToScan() {
  const roots = [{ abs: FILES_DIR, label: "cdn" }];
  for (const r of EXTRA_ROOTS) roots.push({ abs: r, label: path.basename(r) });
  return roots;
}

export async function runIndex({ log = () => {} } = {}) {
  await ensureCollection();
  const tokens = await tokenMap();
  const state = await readJson(STATE_PATH, { files: {} });
  const nextState = { files: {} };
  const seen = new Set();

  let indexed = 0, skipped = 0, chunksUp = 0, removed = 0, errors = 0;

  for (const { abs: rootAbs, label } of rootsToScan()) {
    for await (const absPath of walk(rootAbs)) {
      const ext = extOf(path.basename(absPath));
      if (!TEXT_EXT.has(ext) && ext !== "pdf") continue;

      let st;
      try {
        st = await fs.stat(absPath);
      } catch {
        continue;
      }
      if (st.size > MAX_FILE_BYTES) {
        skipped++;
        continue;
      }

      const key = absPath;
      seen.add(key);
      const sig = `${Math.round(st.mtimeMs)}:${st.size}`;
      const prev = state.files[key];
      if (prev && prev.sig === sig) {
        nextState.files[key] = prev; // unchanged — leave its vectors alone
        skipped++;
        continue;
      }

      try {
        const text = await extractText(absPath, ext);
        const chunks = chunkText(text);
        // Replace any previous vectors for this file before re-adding.
        await deleteByPath(key);
        if (chunks.length) {
          const vectors = await embedBatch(chunks);
          const points = chunks.map((chunk, idx) => ({
            id: pointId(key, idx),
            vector: vectors[idx],
            payload: {
              path: key,
              root: label,
              name: path.basename(key),
              rel: path.relative(rootAbs, key),
              ext,
              kind: CODE_EXT.has(ext) ? "code" : "doc",
              chunk,
              chunkIndex: idx,
              token: tokens.get(key) || null,
              mtime: Math.round(st.mtimeMs),
            },
          }));
          await upsertPoints(points);
          chunksUp += points.length;
        }
        nextState.files[key] = { sig, chunks: chunks.length };
        indexed++;
        if (indexed % 25 === 0) log(`  …${indexed} files indexed`);
      } catch (err) {
        errors++;
        log(`  ! ${path.basename(key)}: ${err.message}`);
        // Keep old state so a transient failure retries next run.
        if (prev) nextState.files[key] = prev;
      }
    }
  }

  // Purge vectors for files that no longer exist.
  for (const key of Object.keys(state.files)) {
    if (!seen.has(key)) {
      try {
        await deleteByPath(key);
        removed++;
      } catch {
        /* ignore */
      }
    }
  }

  await fs.writeFile(STATE_PATH, JSON.stringify(nextState, null, 2), "utf8");
  const summary = { indexed, skipped, chunksUp, removed, errors, files: Object.keys(nextState.files).length };
  log(`Done: ${indexed} indexed, ${skipped} unchanged, ${chunksUp} chunks upserted, ${removed} removed, ${errors} errors`);
  return summary;
}

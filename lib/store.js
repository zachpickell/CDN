// Local-disk file store. Files live under DATA_DIR/files and metadata is kept
// in a single JSON file. Each file gets an unguessable token used in its share
// link. This module is Node-only (uses fs) and must run on the Node runtime.

import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), "storage");
const FILES_DIR = path.join(DATA_DIR, "files");
const TMP_DIR = path.join(DATA_DIR, "tmp");
const META_PATH = path.join(DATA_DIR, "metadata.json");

async function ensureDirs() {
  await fs.mkdir(FILES_DIR, { recursive: true });
}

async function readMeta() {
  try {
    const raw = await fs.readFile(META_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function writeMeta(list) {
  await ensureDirs();
  await fs.writeFile(META_PATH, JSON.stringify(list, null, 2), "utf8");
}

export async function listFiles() {
  const list = await readMeta();
  return list.sort((a, b) => b.uploadedAt - a.uploadedAt);
}

export async function getFile(token) {
  if (!token) return null;
  const list = await readMeta();
  return list.find((f) => f.token === token) || null;
}

// --- Chunked uploads -------------------------------------------------------
// The client sends a big file as a sequence of small chunks. Each chunk is
// appended to a temp file keyed by an upload id; the final chunk promotes the
// temp file into the store. Small per-request bodies sidestep all of Next's
// request-body streaming/buffering limitations.

function tmpPath(uploadId) {
  // Sanitize so the id can't escape the tmp directory.
  const safe = String(uploadId).replace(/[^A-Za-z0-9_-]/g, "");
  if (!safe) throw new Error("Invalid upload id");
  return path.join(TMP_DIR, `${safe}.part`);
}

export async function appendChunk(uploadId, buffer) {
  await fs.mkdir(TMP_DIR, { recursive: true });
  await fs.appendFile(tmpPath(uploadId), buffer);
}

export async function finalizeUpload({ uploadId, originalName, mime }) {
  await ensureDirs();
  const tmp = tmpPath(uploadId);
  const token = crypto.randomBytes(18).toString("base64url");
  const storedName = `${token}${path.extname(originalName || "")}`;
  const dest = path.join(FILES_DIR, storedName);

  await fs.rename(tmp, dest);
  const st = await fs.stat(dest);

  const entry = {
    token,
    originalName: originalName || "file",
    storedName,
    mime: mime || "application/octet-stream",
    size: st.size,
    uploadedAt: Date.now(),
  };

  const list = await readMeta();
  list.push(entry);
  await writeMeta(list);
  return entry;
}

export async function abortUpload(uploadId) {
  try {
    await fs.unlink(tmpPath(uploadId));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

export async function deleteFile(token) {
  const list = await readMeta();
  const entry = list.find((f) => f.token === token);
  if (!entry) return false;
  try {
    await fs.unlink(path.join(FILES_DIR, entry.storedName));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  await writeMeta(list.filter((f) => f.token !== token));
  return true;
}

export function absolutePath(storedName) {
  return path.join(FILES_DIR, storedName);
}

// Disk-backed file store where the filesystem is the source of truth.
//
// Files live under DATA_DIR/files with their real names, and folders are real
// directories — so mounting DATA_DIR/files as a network drive and dropping
// files/folders in from a desktop "just works": the next scan picks them up.
// metadata.json only maps each file's relative path to its share token (plus
// mime and upload time) so links stay stable across restarts and moves made
// through the UI. This module is Node-only (uses fs) and must run on the Node
// runtime.

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

/* ------------------------------ path helpers ----------------------------- */

// Folder ids are relative paths like "photos/vacation" (always "/" separated,
// "" or null means the root). Normalize and reject anything that could escape.
function normalizeRel(p) {
  const parts = String(p || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);
  if (parts.some((s) => s === "." || s === "..")) {
    throw new Error("Invalid path");
  }
  return parts.join("/");
}

function absOf(rel) {
  return rel ? path.join(FILES_DIR, ...rel.split("/")) : FILES_DIR;
}

function parentOf(rel) {
  const i = rel.lastIndexOf("/");
  return i === -1 ? null : rel.slice(0, i);
}

function baseOf(rel) {
  const i = rel.lastIndexOf("/");
  return i === -1 ? rel : rel.slice(i + 1);
}

// A single file/folder name (no separators, no traversal).
function sanitizeName(name) {
  const clean = String(name || "")
    .trim()
    .replace(/[/\\]/g, "_")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f]/g, "");
  if (clean === "." || clean === "..") return "";
  return clean;
}

async function dirExists(rel) {
  try {
    return (await fs.stat(absOf(rel))).isDirectory();
  } catch {
    return false;
  }
}

async function exists(rel) {
  try {
    await fs.stat(absOf(rel));
    return true;
  } catch {
    return false;
  }
}

// "name.ext" → "name (1).ext" until it doesn't collide inside relDir.
async function uniqueName(relDir, name) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let i = 1; ; i++) {
    if (!(await exists(relDir ? `${relDir}/${candidate}` : candidate))) {
      return candidate;
    }
    candidate = `${base} (${i})${ext}`;
  }
}

/* --------------------------------- mime ---------------------------------- */

const MIME = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon",
  heic: "image/heic", avif: "image/avif",
  mp4: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska",
  webm: "video/webm", avi: "video/x-msvideo",
  mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac", aac: "audio/aac",
  ogg: "audio/ogg", m4a: "audio/mp4",
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown",
  html: "text/html", css: "text/css", js: "text/javascript",
  json: "application/json", csv: "text/csv", xml: "application/xml",
  zip: "application/zip", rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed", tar: "application/x-tar", gz: "application/gzip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

function mimeFor(name) {
  const ext = path.extname(name).slice(1).toLowerCase();
  return MIME[ext] || "application/octet-stream";
}

// Hidden from the site: OS litter, partial copies/downloads, dotfiles.
function isIgnored(name) {
  const n = name.toLowerCase();
  if (n === "thumbs.db" || n === "desktop.ini" || n === "metadata.json") return true;
  if (name.startsWith(".") || name.startsWith("~$")) return true;
  return (
    n.endsWith(".part") ||
    n.endsWith(".partial") ||
    n.endsWith(".crdownload") ||
    n.endsWith(".tmp")
  );
}

/* -------------------------------- metadata ------------------------------- */
// Shape: { version: 2, files: { "<relative/path>": { token, mime, uploadedAt } } }
// Older builds stored an array of token-named blobs plus virtual folders; we
// migrate that on first read by materializing the folders as real directories
// and renaming the blobs back to their original names (tokens are preserved,
// so old share links keep working).

function newToken() {
  return crypto.randomBytes(18).toString("base64url");
}

function legacyShape(parsed) {
  if (Array.isArray(parsed)) {
    return { files: parsed.map((f) => ({ folderId: null, ...f })), folders: [] };
  }
  if (parsed && typeof parsed === "object") {
    return {
      files: Array.isArray(parsed.files)
        ? parsed.files.map((f) => ({ folderId: null, ...f }))
        : [],
      folders: Array.isArray(parsed.folders) ? parsed.folders : [],
    };
  }
  return { files: [], folders: [] };
}

async function migrateLegacy(parsed) {
  const old = legacyShape(parsed);
  const meta = { version: 2, files: {} };

  // Resolve each virtual folder id to a real directory path.
  const byId = new Map(old.folders.map((f) => [f.id, f]));
  const pathOf = new Map();
  const resolvePath = (id, seen = new Set()) => {
    if (id == null) return "";
    if (pathOf.has(id)) return pathOf.get(id);
    const f = byId.get(id);
    if (!f || seen.has(id)) return "";
    seen.add(id);
    const parent = resolvePath(f.parentId ?? null, seen);
    const name = sanitizeName(f.name) || "folder";
    const rel = parent ? `${parent}/${name}` : name;
    pathOf.set(id, rel);
    return rel;
  };

  for (const f of old.folders) {
    const rel = resolvePath(f.id);
    if (rel) await fs.mkdir(absOf(rel), { recursive: true });
  }

  for (const entry of old.files) {
    if (!entry?.token || !entry?.storedName) continue;
    const src = path.join(FILES_DIR, entry.storedName);
    try {
      await fs.stat(src);
    } catch {
      continue; // blob is gone; drop the entry
    }
    const dir = resolvePath(entry.folderId ?? null);
    const wanted = sanitizeName(entry.originalName) || entry.storedName;
    const name = await uniqueName(dir, wanted);
    const rel = dir ? `${dir}/${name}` : name;
    await fs.rename(src, absOf(rel));
    meta.files[rel] = {
      token: entry.token,
      mime: entry.mime || mimeFor(name),
      uploadedAt: entry.uploadedAt || Date.now(),
    };
  }

  await writeMeta(meta);
  return meta;
}

async function readMeta() {
  await ensureDirs();
  let raw;
  try {
    raw = await fs.readFile(META_PATH, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return { version: 2, files: {} };
    throw err;
  }
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {}
  if (parsed && parsed.version === 2 && parsed.files && typeof parsed.files === "object") {
    return { version: 2, files: parsed.files };
  }
  return migrateLegacy(parsed);
}

async function writeMeta(meta) {
  await ensureDirs();
  await fs.writeFile(META_PATH, JSON.stringify(meta, null, 2), "utf8");
}

// Move every metadata key under oldRel to newRel (folder rename/move).
function remapPrefix(meta, oldRel, newRel) {
  const prefix = `${oldRel}/`;
  for (const key of Object.keys(meta.files)) {
    if (key === oldRel || key.startsWith(prefix)) {
      meta.files[`${newRel}${key.slice(oldRel.length)}`] = meta.files[key];
      delete meta.files[key];
    }
  }
}

/* ---------------------------------- scan --------------------------------- */
// Walk FILES_DIR, reconcile metadata with what's actually on disk (new files
// get tokens, entries for deleted files are pruned), and return the current
// files + folders. This runs on every listing, so anything created directly
// on the mounted drive shows up on the next page load / refresh.

async function walk(relDir, out) {
  let entries;
  try {
    entries = await fs.readdir(absOf(relDir), { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  for (const ent of entries) {
    if (isIgnored(ent.name)) continue;
    const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
    let st;
    try {
      st = await fs.stat(absOf(rel));
    } catch {
      continue; // vanished mid-scan (e.g. still copying) — skip
    }
    if (st.isDirectory()) {
      out.dirs.push({ rel, mtime: st.mtimeMs });
      await walk(rel, out);
    } else if (st.isFile()) {
      out.files.push({ rel, size: st.size, mtime: st.mtimeMs });
    }
  }
}

async function scan() {
  await ensureDirs();
  const meta = await readMeta();
  const out = { dirs: [], files: [] };
  await walk("", out);

  let changed = false;
  const seen = new Set();
  for (const f of out.files) {
    seen.add(f.rel);
    if (!meta.files[f.rel]) {
      meta.files[f.rel] = {
        token: newToken(),
        mime: mimeFor(f.rel),
        uploadedAt: Math.round(f.mtime) || Date.now(),
      };
      changed = true;
    }
  }
  for (const key of Object.keys(meta.files)) {
    if (!seen.has(key)) {
      delete meta.files[key];
      changed = true;
    }
  }
  if (changed) await writeMeta(meta);

  const files = out.files.map((f) => {
    const m = meta.files[f.rel];
    return {
      token: m.token,
      originalName: baseOf(f.rel),
      storedName: f.rel,
      mime: m.mime,
      size: f.size,
      folderId: parentOf(f.rel),
      uploadedAt: m.uploadedAt,
    };
  });
  const folders = out.dirs.map((d) => ({
    id: d.rel,
    name: baseOf(d.rel),
    parentId: parentOf(d.rel),
    createdAt: Math.round(d.mtime),
  }));
  return { files, folders };
}

/* ------------------------------- public API ------------------------------ */

export async function listFiles() {
  const { files } = await scan();
  return files.sort((a, b) => b.uploadedAt - a.uploadedAt);
}

export async function listFolders() {
  const { folders } = await scan();
  return folders.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listAll() {
  const { files, folders } = await scan();
  return {
    files: files.sort((a, b) => b.uploadedAt - a.uploadedAt),
    folders: folders.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function getFile(token) {
  if (!token) return null;
  const { files } = await scan();
  return files.find((f) => f.token === token) || null;
}

export function absolutePath(storedName) {
  return absOf(normalizeRel(storedName));
}

/* --------------------------------- folders ------------------------------- */

export async function createFolder({ name, parentId = null }) {
  const clean = sanitizeName(name);
  if (!clean) throw new Error("Folder name is required");
  await ensureDirs();
  const parent = parentId ? normalizeRel(parentId) : "";
  if (parent && !(await dirExists(parent))) {
    throw new Error("Parent folder not found");
  }
  const rel = parent ? `${parent}/${clean}` : clean;
  if (await exists(rel)) {
    throw new Error("A folder with that name already exists here");
  }
  await fs.mkdir(absOf(rel));
  return { id: rel, name: clean, parentId: parent || null, createdAt: Date.now() };
}

export async function renameFolder(id, name) {
  const clean = sanitizeName(name);
  if (!clean) throw new Error("Folder name is required");
  const rel = normalizeRel(id);
  if (!rel || !(await dirExists(rel))) return null;
  const parent = parentOf(rel);
  const newRel = parent ? `${parent}/${clean}` : clean;
  if (newRel === rel) {
    return { id: rel, name: clean, parentId: parent, createdAt: Date.now() };
  }
  if (await exists(newRel)) {
    throw new Error("A folder with that name already exists here");
  }
  await fs.rename(absOf(rel), absOf(newRel));
  const meta = await readMeta();
  remapPrefix(meta, rel, newRel);
  await writeMeta(meta);
  return { id: newRel, name: clean, parentId: parent, createdAt: Date.now() };
}

export async function moveFolder(id, newParentId) {
  const rel = normalizeRel(id);
  if (!rel || !(await dirExists(rel))) return null;
  const target = newParentId ? normalizeRel(newParentId) : "";
  if (target && !(await dirExists(target))) {
    throw new Error("Destination folder not found");
  }
  if (target === rel || target.startsWith(`${rel}/`)) {
    throw new Error("Can't move a folder into itself");
  }
  const name = baseOf(rel);
  const newRel = target ? `${target}/${name}` : name;
  if (newRel === rel) {
    return { id: rel, name, parentId: parentOf(rel), createdAt: Date.now() };
  }
  if (await exists(newRel)) {
    throw new Error("A folder with that name already exists there");
  }
  await fs.rename(absOf(rel), absOf(newRel));
  const meta = await readMeta();
  remapPrefix(meta, rel, newRel);
  await writeMeta(meta);
  return { id: newRel, name, parentId: target || null, createdAt: Date.now() };
}

export async function deleteFolder(id) {
  const rel = normalizeRel(id);
  if (!rel || !(await dirExists(rel))) return false;
  await fs.rm(absOf(rel), { recursive: true, force: true });
  const meta = await readMeta();
  remapPrefixDelete(meta, rel);
  await writeMeta(meta);
  return true;
}

function remapPrefixDelete(meta, rel) {
  const prefix = `${rel}/`;
  for (const key of Object.keys(meta.files)) {
    if (key === rel || key.startsWith(prefix)) delete meta.files[key];
  }
}

/* ---------------------------------- files -------------------------------- */

export async function moveFile(token, folderId) {
  const entry = await getFile(token);
  if (!entry) return null;
  const target = folderId ? normalizeRel(folderId) : "";
  if (target && !(await dirExists(target))) {
    throw new Error("Destination folder not found");
  }
  const name = await uniqueName(target, entry.originalName);
  const newRel = target ? `${target}/${name}` : name;
  if (newRel === entry.storedName) return entry;
  await fs.rename(absOf(entry.storedName), absOf(newRel));
  const meta = await readMeta();
  meta.files[newRel] = meta.files[entry.storedName] || {
    token: entry.token,
    mime: entry.mime,
    uploadedAt: entry.uploadedAt,
  };
  delete meta.files[entry.storedName];
  await writeMeta(meta);
  return {
    ...entry,
    originalName: name,
    storedName: newRel,
    folderId: target || null,
  };
}

// Renames the file on disk (the share token is preserved, so the link keeps
// working).
export async function renameFile(token, name) {
  const clean = sanitizeName(name);
  if (!clean) throw new Error("File name is required");
  const entry = await getFile(token);
  if (!entry) return null;
  if (clean === entry.originalName) return entry;
  const dir = parentOf(entry.storedName);
  const newRel = dir ? `${dir}/${clean}` : clean;
  if (await exists(newRel)) {
    throw new Error("A file with that name already exists here");
  }
  await fs.rename(absOf(entry.storedName), absOf(newRel));
  const meta = await readMeta();
  const m = meta.files[entry.storedName] || {
    token: entry.token,
    mime: entry.mime,
    uploadedAt: entry.uploadedAt,
  };
  m.mime = mimeFor(clean);
  meta.files[newRel] = m;
  delete meta.files[entry.storedName];
  await writeMeta(meta);
  return { ...entry, originalName: clean, storedName: newRel, mime: m.mime };
}

export async function deleteFile(token) {
  const entry = await getFile(token);
  if (!entry) return false;
  try {
    await fs.unlink(absOf(entry.storedName));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  const meta = await readMeta();
  delete meta.files[entry.storedName];
  await writeMeta(meta);
  return true;
}

/* ----------------------------- chunked uploads --------------------------- */
// The client sends a big file as a sequence of small chunks. Each chunk is
// appended to a temp file keyed by an upload id; the final chunk promotes the
// temp file into the store under its real name.

function tmpPath(uploadId) {
  const safe = String(uploadId).replace(/[^A-Za-z0-9_-]/g, "");
  if (!safe) throw new Error("Invalid upload id");
  return path.join(TMP_DIR, `${safe}.part`);
}

export async function appendChunk(uploadId, buffer) {
  await fs.mkdir(TMP_DIR, { recursive: true });
  await fs.appendFile(tmpPath(uploadId), buffer);
}

export async function finalizeUpload({
  uploadId,
  originalName,
  mime,
  folderId = null,
}) {
  await ensureDirs();
  const tmp = tmpPath(uploadId);

  // Drop the file at the root if the requested folder no longer exists.
  let dir = folderId ? normalizeRel(folderId) : "";
  if (dir && !(await dirExists(dir))) dir = "";

  const wanted = sanitizeName(originalName) || "file";
  const name = await uniqueName(dir, wanted);
  const rel = dir ? `${dir}/${name}` : name;
  const dest = absOf(rel);

  try {
    await fs.rename(tmp, dest);
  } catch (err) {
    // No chunks were ever written (e.g. an empty file) — create an empty one.
    if (err.code === "ENOENT") {
      await fs.writeFile(dest, Buffer.alloc(0));
    } else {
      throw err;
    }
  }
  const st = await fs.stat(dest);

  const token = newToken();
  const meta = await readMeta();
  meta.files[rel] = {
    token,
    mime: mime || mimeFor(name),
    uploadedAt: Date.now(),
  };
  await writeMeta(meta);

  return {
    token,
    originalName: name,
    storedName: rel,
    mime: mime || mimeFor(name),
    size: st.size,
    folderId: dir || null,
    uploadedAt: meta.files[rel].uploadedAt,
  };
}

export async function abortUpload(uploadId) {
  try {
    await fs.unlink(tmpPath(uploadId));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

/* --------------------------------- stats --------------------------------- */

export async function storageStats() {
  const { files } = await scan();
  const totalBytes = files.reduce((sum, f) => sum + (f.size || 0), 0);

  let disk = null;
  try {
    const s = await fs.statfs(DATA_DIR);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    const used = (s.blocks - s.bfree) * s.bsize;
    disk = { total, free, used: Math.max(0, used) };
  } catch {
    disk = null;
  }

  return { fileCount: files.length, totalBytes, disk };
}

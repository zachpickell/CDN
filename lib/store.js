// Local-disk file store. Files live under DATA_DIR/files and metadata is kept
// in a single JSON file. Each file gets an unguessable token used in its share
// link. Files can be organized into nested folders; a file or folder with a
// null parent/folder lives at the root. This module is Node-only (uses fs) and
// must run on the Node runtime.

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

// Metadata is stored as { files: [...], folders: [...] }. Older builds stored
// a bare array of files, so we transparently migrate that shape on read.
function normalizeMeta(parsed) {
  if (Array.isArray(parsed)) {
    return {
      files: parsed.map((f) => ({ folderId: null, ...f })),
      folders: [],
    };
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

async function readMeta() {
  try {
    const raw = await fs.readFile(META_PATH, "utf8");
    return normalizeMeta(JSON.parse(raw));
  } catch (err) {
    if (err.code === "ENOENT") return { files: [], folders: [] };
    throw err;
  }
}

async function writeMeta(meta) {
  await ensureDirs();
  await fs.writeFile(META_PATH, JSON.stringify(meta, null, 2), "utf8");
}

export async function listFiles() {
  const { files } = await readMeta();
  return files.sort((a, b) => b.uploadedAt - a.uploadedAt);
}

export async function listFolders() {
  const { folders } = await readMeta();
  return folders.sort((a, b) => a.name.localeCompare(b.name));
}

// Both files and folders in one read, for endpoints that render a directory.
export async function listAll() {
  const meta = await readMeta();
  return {
    files: meta.files.sort((a, b) => b.uploadedAt - a.uploadedAt),
    folders: meta.folders.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function getFile(token) {
  if (!token) return null;
  const { files } = await readMeta();
  return files.find((f) => f.token === token) || null;
}

// --- Folders ---------------------------------------------------------------

function newId() {
  return crypto.randomBytes(9).toString("base64url");
}

function folderExists(folders, id) {
  return id === null || id === undefined || folders.some((f) => f.id === id);
}

// Collect a folder plus every folder nested beneath it.
function descendantIds(folders, rootId) {
  const out = new Set([rootId]);
  let added = true;
  while (added) {
    added = false;
    for (const f of folders) {
      if (f.parentId !== null && out.has(f.parentId) && !out.has(f.id)) {
        out.add(f.id);
        added = true;
      }
    }
  }
  return out;
}

export async function createFolder({ name, parentId = null }) {
  const clean = String(name || "").trim();
  if (!clean) throw new Error("Folder name is required");
  const meta = await readMeta();
  const parent = parentId ?? null;
  if (!folderExists(meta.folders, parent)) {
    throw new Error("Parent folder not found");
  }
  // Avoid duplicate names within the same parent.
  const dupe = meta.folders.some(
    (f) => f.parentId === parent && f.name.toLowerCase() === clean.toLowerCase()
  );
  if (dupe) throw new Error("A folder with that name already exists here");

  const folder = {
    id: newId(),
    name: clean,
    parentId: parent,
    createdAt: Date.now(),
  };
  meta.folders.push(folder);
  await writeMeta(meta);
  return folder;
}

export async function renameFolder(id, name) {
  const clean = String(name || "").trim();
  if (!clean) throw new Error("Folder name is required");
  const meta = await readMeta();
  const folder = meta.folders.find((f) => f.id === id);
  if (!folder) return null;
  const dupe = meta.folders.some(
    (f) =>
      f.id !== id &&
      f.parentId === folder.parentId &&
      f.name.toLowerCase() === clean.toLowerCase()
  );
  if (dupe) throw new Error("A folder with that name already exists here");
  folder.name = clean;
  await writeMeta(meta);
  return folder;
}

export async function moveFolder(id, newParentId) {
  const target = newParentId ?? null;
  const meta = await readMeta();
  const folder = meta.folders.find((f) => f.id === id);
  if (!folder) return null;
  if (!folderExists(meta.folders, target)) {
    throw new Error("Destination folder not found");
  }
  // Can't move a folder into itself or one of its own descendants.
  if (target !== null && descendantIds(meta.folders, id).has(target)) {
    throw new Error("Can't move a folder into itself");
  }
  folder.parentId = target;
  await writeMeta(meta);
  return folder;
}

// Delete a folder and everything inside it (subfolders and their files),
// removing the stored file blobs from disk.
export async function deleteFolder(id) {
  const meta = await readMeta();
  if (!meta.folders.some((f) => f.id === id)) return false;
  const toRemove = descendantIds(meta.folders, id);

  const orphanFiles = meta.files.filter((f) => toRemove.has(f.folderId));
  for (const entry of orphanFiles) {
    try {
      await fs.unlink(path.join(FILES_DIR, entry.storedName));
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }

  meta.files = meta.files.filter((f) => !toRemove.has(f.folderId));
  meta.folders = meta.folders.filter((f) => !toRemove.has(f.id));
  await writeMeta(meta);
  return true;
}

export async function moveFile(token, folderId) {
  const target = folderId ?? null;
  const meta = await readMeta();
  const entry = meta.files.find((f) => f.token === token);
  if (!entry) return null;
  if (!folderExists(meta.folders, target)) {
    throw new Error("Destination folder not found");
  }
  entry.folderId = target;
  await writeMeta(meta);
  return entry;
}

// Change a file's display name. The stored blob keeps its original extension,
// so the share link and download still resolve; only the shown/downloaded
// name changes.
export async function renameFile(token, name) {
  const clean = String(name || "").trim();
  if (!clean) throw new Error("File name is required");
  const meta = await readMeta();
  const entry = meta.files.find((f) => f.token === token);
  if (!entry) return null;
  entry.originalName = clean;
  await writeMeta(meta);
  return entry;
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

export async function finalizeUpload({
  uploadId,
  originalName,
  mime,
  folderId = null,
}) {
  await ensureDirs();
  const tmp = tmpPath(uploadId);
  const token = crypto.randomBytes(18).toString("base64url");
  const storedName = `${token}${path.extname(originalName || "")}`;
  const dest = path.join(FILES_DIR, storedName);

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

  const meta = await readMeta();
  // Drop the file at the root if the requested folder no longer exists.
  const target = folderExists(meta.folders, folderId ?? null)
    ? folderId ?? null
    : null;

  const entry = {
    token,
    originalName: originalName || "file",
    storedName,
    mime: mime || "application/octet-stream",
    size: st.size,
    folderId: target,
    uploadedAt: Date.now(),
  };

  meta.files.push(entry);
  await writeMeta(meta);
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
  const meta = await readMeta();
  const entry = meta.files.find((f) => f.token === token);
  if (!entry) return false;
  try {
    await fs.unlink(path.join(FILES_DIR, entry.storedName));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  meta.files = meta.files.filter((f) => f.token !== token);
  await writeMeta(meta);
  return true;
}

export function absolutePath(storedName) {
  return path.join(FILES_DIR, storedName);
}

// Storage usage: how much the uploaded files take up, plus the capacity of the
// disk that DATA_DIR lives on. `disk` is null if the platform can't report it.
export async function storageStats() {
  await ensureDirs();
  const { files } = await readMeta();
  const totalBytes = files.reduce((sum, f) => sum + (f.size || 0), 0);

  let disk = null;
  try {
    const s = await fs.statfs(DATA_DIR);
    // Match `df`: total is the whole filesystem; used is blocks actually
    // occupied; free is what a non-root process can still write. The gap
    // between (used + free) and total is the root-reserved area (~5% on ext4),
    // which we deliberately don't count as "used".
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    const used = (s.blocks - s.bfree) * s.bsize;
    disk = { total, free, used: Math.max(0, used) };
  } catch {
    disk = null;
  }

  return { fileCount: files.length, totalBytes, disk };
}

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

export async function saveFile({ originalName, mime, bytes }) {
  await ensureDirs();
  const token = crypto.randomBytes(18).toString("base64url"); // ~24 chars, unguessable
  const storedName = `${token}${path.extname(originalName || "")}`;
  await fs.writeFile(path.join(FILES_DIR, storedName), bytes);

  const entry = {
    token,
    originalName: originalName || "file",
    storedName,
    mime: mime || "application/octet-stream",
    size: bytes.length,
    uploadedAt: Date.now(),
  };

  const list = await readMeta();
  list.push(entry);
  await writeMeta(list);
  return entry;
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

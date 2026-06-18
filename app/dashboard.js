"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

function formatDate(ts) {
  return new Date(ts).toLocaleString();
}

function formatEta(seconds) {
  if (seconds == null || !isFinite(seconds)) return "";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s left`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s left`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m left`;
}

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec) return "";
  return `${formatSize(bytesPerSec)}/s`;
}

// Map a file to a category used for its colored icon, à la Drive.
function fileKind(file) {
  const type = (file.type || "").toLowerCase();
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (type.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg", "heic", "bmp"].includes(ext))
    return "image";
  if (type.startsWith("video/") || ["mp4", "mov", "mkv", "avi", "webm"].includes(ext))
    return "video";
  if (type.startsWith("audio/") || ["mp3", "wav", "flac", "aac", "ogg", "m4a"].includes(ext))
    return "audio";
  if (type === "application/pdf" || ext === "pdf") return "pdf";
  if (["zip", "rar", "7z", "tar", "gz", "bz2"].includes(ext)) return "archive";
  if (["doc", "docx", "txt", "rtf", "md", "pages"].includes(ext)) return "doc";
  if (["xls", "xlsx", "csv", "numbers"].includes(ext)) return "sheet";
  if (["js", "ts", "jsx", "tsx", "py", "rb", "go", "rs", "java", "c", "cpp", "html", "css", "json", "sh"].includes(ext))
    return "code";
  return "file";
}

const KIND_GLYPH = {
  image: "🖼",
  video: "▶",
  audio: "♪",
  pdf: "PDF",
  archive: "ZIP",
  doc: "DOC",
  sheet: "XLS",
  code: "</>",
  file: "FILE",
};

function FileIcon({ file }) {
  const kind = fileKind(file);
  const glyph = KIND_GLYPH[kind];
  return (
    <div className={`file-icon kind-${kind}`} aria-hidden="true">
      {glyph}
    </div>
  );
}

function FolderIcon() {
  return (
    <div className="file-icon kind-folder" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="20" height="20">
        <path
          fill="currentColor"
          d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2Z"
        />
      </svg>
    </div>
  );
}

function MoveIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 7V5a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v2M3 7h18M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9M12 11v6m0 0 2.5-2.5M12 17l-2.5-2.5"
      />
    </svg>
  );
}

function FolderRow({ folder, count, onOpen, onRename, onMove, onDelete }) {
  return (
    <div className="file-row folder-row">
      <button
        className="folder-open"
        onClick={() => onOpen(folder.id)}
        title={`Open ${folder.name}`}
      >
        <FolderIcon />
        <div className="file-meta">
          <div className="file-name">{folder.name}</div>
          <div className="file-sub">
            {count === 1 ? "1 item" : `${count} items`}
          </div>
        </div>
      </button>
      <div className="row-actions">
        <button
          className="icon-btn"
          onClick={() => onRename(folder)}
          title="Rename"
          aria-label="Rename folder"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"
            />
          </svg>
        </button>
        <button
          className="icon-btn"
          onClick={() => onMove({ type: "folder", id: folder.id, name: folder.name })}
          title="Move"
          aria-label="Move folder"
        >
          <MoveIcon />
        </button>
        <button
          className="icon-btn danger"
          onClick={() => onDelete(folder)}
          title="Delete"
          aria-label="Delete folder"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 7h16M10 11v6M14 11v6M5 7l1 13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-13M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

function FileRow({ file, onMove, onDelete }) {
  const [copied, setCopied] = useState(false);

  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/f/${file.token}`
      : `/f/${file.token}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      // Fallback for older browsers
      const el = document.createElement("textarea");
      el.value = shareUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="file-row">
      <FileIcon file={file} />
      <div className="file-meta">
        <div className="file-name">{file.name}</div>
        <div className="file-sub">
          {formatSize(file.size)} ·{" "}
          <span suppressHydrationWarning>{formatDate(file.uploadedAt)}</span>
        </div>
      </div>
      <div className="row-actions">
        <button
          className="icon-btn"
          onClick={copy}
          title="Copy link"
          aria-label="Copy link"
        >
          {copied ? (
            <span className="copied">Copied!</span>
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 9h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Zm-2 8H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
              />
            </svg>
          )}
        </button>
        <button
          className="icon-btn"
          onClick={() => onMove({ type: "file", id: file.token, name: file.name })}
          title="Move"
          aria-label="Move file"
        >
          <MoveIcon />
        </button>
        <a
          className="icon-btn"
          href={shareUrl}
          target="_blank"
          rel="noreferrer"
          title="Open"
          aria-label="Open"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"
            />
          </svg>
        </a>
        <button
          className="icon-btn danger"
          onClick={() => onDelete(file.token)}
          title="Delete"
          aria-label="Delete"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 7h16M10 11v6M14 11v6M5 7l1 13a2 2 0 0 0 2 2l8 0a2 2 0 0 0 2-2l1-13M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

function ErrorModal({ message, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <div className="modal-icon">!</div>
        <h2 className="modal-title">Something went wrong</h2>
        <p className="modal-message">{message}</p>
        <button className="modal-ok" onClick={onClose}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

// Picker that lists every folder as an indented tree so the user can choose a
// destination. `disabledIds` blocks moving a folder into itself/its subtree.
function MoveModal({ target, folders, onClose, onChoose }) {
  // Build depth for each folder by walking parents.
  const byId = useMemo(() => {
    const m = new Map();
    for (const f of folders) m.set(f.id, f);
    return m;
  }, [folders]);

  const disabledIds = useMemo(() => {
    if (target.type !== "folder") return new Set();
    const out = new Set([target.id]);
    let added = true;
    while (added) {
      added = false;
      for (const f of folders) {
        if (f.parentId && out.has(f.parentId) && !out.has(f.id)) {
          out.add(f.id);
          added = true;
        }
      }
    }
    return out;
  }, [folders, target]);

  function depth(id) {
    let d = 0;
    let cur = byId.get(id);
    while (cur && cur.parentId) {
      d++;
      cur = byId.get(cur.parentId);
    }
    return d;
  }

  // Stable, parent-before-child ordering.
  const ordered = useMemo(() => {
    const out = [];
    const visit = (parentId) => {
      folders
        .filter((f) => f.parentId === parentId)
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((f) => {
          out.push(f);
          visit(f.id);
        });
    };
    visit(null);
    return out;
  }, [folders]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal move-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <h2 className="modal-title">Move “{target.name}”</h2>
        <p className="modal-message">Choose a destination folder.</p>
        <div className="move-list">
          <button className="move-item" onClick={() => onChoose(null)}>
            <FolderIcon />
            <span>Home (root)</span>
          </button>
          {ordered.map((f) => (
            <button
              key={f.id}
              className="move-item"
              disabled={disabledIds.has(f.id)}
              style={{ paddingLeft: `${14 + depth(f.id) * 18}px` }}
              onClick={() => onChoose(f.id)}
            >
              <FolderIcon />
              <span>{f.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard({ initialFiles, initialFolders }) {
  const router = useRouter();
  const [files, setFiles] = useState(initialFiles);
  const [folders, setFolders] = useState(initialFolders || []);
  const [currentFolderId, setCurrentFolderId] = useState(null);
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [moveTarget, setMoveTarget] = useState(null);
  // null when idle, otherwise { name, percent, index, total }
  const [progress, setProgress] = useState(null);
  const inputRef = useRef(null);
  const xhrRef = useRef(null);
  const cancelledRef = useRef(false);
  const uploadIdRef = useRef(null);
  // Mirror the active folder so async upload code reads the latest value.
  const folderRef = useRef(null);
  useEffect(() => {
    folderRef.current = currentFolderId;
  }, [currentFolderId]);

  const uploading = progress !== null;

  // Chunk sizing. We start fairly large for speed and automatically shrink if
  // a proxy in front of the app rejects a chunk (HTTP 413), so uploads adapt to
  // whatever request-body limit your hosting/proxy enforces.
  const MAX_CHUNK = 4 * 1024 * 1024; // start at 4MB
  const MIN_CHUNK = 64 * 1024; // don't shrink below 64KB

  // Send one request (a Blob body, or null for the finalize call). Rejects with
  // an Error whose `.status` is the HTTP status, so callers can react to 413.
  function sendChunk(body, headers, onChunkProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      xhr.open("POST", "/api/upload");
      for (const [k, v] of Object.entries(headers)) {
        xhr.setRequestHeader(k, v);
      }
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onChunkProgress) onChunkProgress(e.loaded);
      };
      xhr.onabort = () => reject(new Error("__cancelled__"));
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(xhr.responseText ? JSON.parse(xhr.responseText) : {});
          } catch {
            reject(new Error("Bad server response"));
          }
        } else {
          let msg = `Upload failed (HTTP ${xhr.status})`;
          try {
            msg = JSON.parse(xhr.responseText).error || msg;
          } catch {}
          const err = new Error(msg);
          err.status = xhr.status;
          reject(err);
        }
      };
      xhr.onerror = () =>
        reject(
          new Error(
            "Couldn't reach the server. The request was blocked before it " +
              "arrived — usually a stale service worker or a network issue. " +
              "Try an incognito window, or unregister service workers in " +
              "DevTools → Application."
          )
        );
      xhr.send(body);
    });
  }

  // Upload a single file as a sequence of chunks, halving the chunk size each
  // time a 413 is hit until chunks fit through the proxy.
  async function uploadOne(file, onProgress) {
    const uploadId =
      (crypto.randomUUID && crypto.randomUUID()) ||
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    uploadIdRef.current = uploadId;

    const startedAt = Date.now();
    let chunkSize = MAX_CHUNK;
    let offset = 0;

    while (offset < file.size) {
      if (cancelledRef.current) throw new Error("__cancelled__");
      const end = Math.min(file.size, offset + chunkSize);
      const chunk = file.slice(offset, end);

      try {
        await sendChunk(chunk, { "X-Upload-Id": uploadId }, (loadedInChunk) => {
          const overall = offset + loadedInChunk;
          const elapsed = (Date.now() - startedAt) / 1000;
          const speed = elapsed > 0 ? overall / elapsed : 0;
          const eta = speed > 0 ? (file.size - overall) / speed : null;
          onProgress({
            percent: file.size
              ? Math.min(99, Math.round((overall / file.size) * 100))
              : 100,
            speed,
            eta,
          });
        });
        offset = end; // chunk accepted — advance
      } catch (e) {
        // Proxy rejected this chunk as too large — shrink and retry same bytes.
        if (e.status === 413 && chunkSize > MIN_CHUNK) {
          chunkSize = Math.max(MIN_CHUNK, Math.floor(chunkSize / 2));
          continue;
        }
        throw e;
      }
    }

    // All bytes sent — finalize and get the file metadata. The file lands in
    // whatever folder is open when the upload finishes.
    const finalizeHeaders = {
      "X-Upload-Id": uploadId,
      "X-Finalize": "1",
      "X-Filename": encodeURIComponent(file.name),
      "X-Filetype": file.type || "application/octet-stream",
    };
    if (folderRef.current) {
      finalizeHeaders["X-Folder-Id"] = encodeURIComponent(folderRef.current);
    }
    const entry = await sendChunk(null, finalizeHeaders, null);
    onProgress({ percent: 100, speed: 0, eta: 0 });
    uploadIdRef.current = null;
    return entry;
  }

  const uploadFiles = useCallback(async (fileList) => {
    const arr = Array.from(fileList);
    if (arr.length === 0) return;
    setError("");
    cancelledRef.current = false;
    try {
      for (let i = 0; i < arr.length; i++) {
        if (cancelledRef.current) break;
        const file = arr[i];
        setProgress({
          name: file.name,
          percent: 0,
          eta: null,
          speed: 0,
          index: i + 1,
          total: arr.length,
        });
        const entry = await uploadOne(file, ({ percent, eta, speed }) =>
          setProgress({
            name: file.name,
            percent,
            eta,
            speed,
            index: i + 1,
            total: arr.length,
          })
        );
        setFiles((prev) => [entry, ...prev]);
      }
    } catch (e) {
      // Aborting an upload isn't an error worth showing.
      if (e.message !== "__cancelled__") setError(e.message || "Upload failed");
    } finally {
      xhrRef.current = null;
      setProgress(null);
    }
  }, []);

  function cancelUpload() {
    cancelledRef.current = true;
    xhrRef.current?.abort();
    // Tell the server to drop the partial temp file.
    const id = uploadIdRef.current;
    if (id) {
      fetch(`/api/upload?uploadId=${encodeURIComponent(id)}`, {
        method: "DELETE",
      }).catch(() => {});
      uploadIdRef.current = null;
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files);
  }

  async function onDeleteFile(token) {
    setFiles((prev) => prev.filter((f) => f.token !== token));
    await fetch(`/api/files?token=${encodeURIComponent(token)}`, {
      method: "DELETE",
    });
  }

  async function createNewFolder() {
    const name = newName.trim();
    if (!name) {
      setCreating(false);
      return;
    }
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parentId: currentFolderId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't create folder");
      setFolders((prev) => [...prev, data.folder]);
      setNewName("");
      setCreating(false);
    } catch (e) {
      setError(e.message);
    }
  }

  async function renameFolder(folder) {
    const name = window.prompt("Rename folder", folder.name);
    if (name == null) return;
    const clean = name.trim();
    if (!clean || clean === folder.name) return;
    try {
      const res = await fetch("/api/folders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: folder.id, name: clean }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't rename folder");
      setFolders((prev) =>
        prev.map((f) => (f.id === folder.id ? data.folder : f))
      );
    } catch (e) {
      setError(e.message);
    }
  }

  async function deleteFolder(folder) {
    const childFolders = folders.filter((f) => f.parentId === folder.id).length;
    const childFiles = files.filter((f) => f.folderId === folder.id).length;
    const note =
      childFolders + childFiles > 0
        ? " and everything inside it"
        : "";
    if (
      !window.confirm(
        `Delete “${folder.name}”${note}? This can't be undone.`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(
        `/api/folders?id=${encodeURIComponent(folder.id)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Couldn't delete folder");
      }
      // Drop the folder, its descendants, and any files they held from view.
      const removed = new Set([folder.id]);
      let added = true;
      while (added) {
        added = false;
        for (const f of folders) {
          if (f.parentId && removed.has(f.parentId) && !removed.has(f.id)) {
            removed.add(f.id);
            added = true;
          }
        }
      }
      setFolders((prev) => prev.filter((f) => !removed.has(f.id)));
      setFiles((prev) => prev.filter((f) => !removed.has(f.folderId)));
      if (removed.has(currentFolderId)) setCurrentFolderId(folder.parentId);
    } catch (e) {
      setError(e.message);
    }
  }

  async function doMove(destFolderId) {
    const target = moveTarget;
    setMoveTarget(null);
    if (!target) return;
    try {
      if (target.type === "file") {
        const res = await fetch("/api/files", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: target.id, folderId: destFolderId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Couldn't move file");
        setFiles((prev) =>
          prev.map((f) =>
            f.token === target.id ? { ...f, folderId: destFolderId } : f
          )
        );
      } else {
        const res = await fetch("/api/folders", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: target.id, parentId: destFolderId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Couldn't move folder");
        setFolders((prev) =>
          prev.map((f) =>
            f.id === target.id ? { ...f, parentId: destFolderId } : f
          )
        );
      }
    } catch (e) {
      setError(e.message);
    }
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  // Breadcrumb trail from root to the current folder.
  const trail = useMemo(() => {
    const out = [];
    const byId = new Map(folders.map((f) => [f.id, f]));
    let cur = currentFolderId ? byId.get(currentFolderId) : null;
    while (cur) {
      out.unshift(cur);
      cur = cur.parentId ? byId.get(cur.parentId) : null;
    }
    return out;
  }, [folders, currentFolderId]);

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  // Number of immediate children a folder holds, for its subtitle.
  function childCount(folderId) {
    return (
      folders.filter((f) => f.parentId === folderId).length +
      files.filter((f) => f.folderId === folderId).length
    );
  }

  const visibleFolders = searching
    ? []
    : folders
        .filter((f) => f.parentId === currentFolderId)
        .sort((a, b) => a.name.localeCompare(b.name));

  const visibleFiles = searching
    ? files.filter((f) => f.name.toLowerCase().includes(q))
    : files.filter((f) => f.folderId === currentFolderId);

  const isEmptyHere = visibleFolders.length === 0 && visibleFiles.length === 0;
  const hasAnything = files.length > 0 || folders.length > 0;

  return (
    <div className="container">
      <div className="topbar">
        <h1>Your files</h1>
        <button className="ghost" onClick={logout}>
          Log out
        </button>
      </div>

      <div
        className={`dropzone${dragging ? " drag" : ""}`}
        onClick={() => {
          if (!uploading) inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {uploading ? (
          <div className="uploading" onClick={(e) => e.stopPropagation()}>
            <div className="upload-status">
              <span className="upload-name">
                <span className="spinner" aria-hidden="true" />
                {progress.name}
              </span>
              <span className="upload-pct">{progress.percent}%</span>
            </div>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <div className="upload-footer">
              <span className="hint">
                {[
                  progress.total > 1
                    ? `File ${progress.index} of ${progress.total}`
                    : null,
                  formatSpeed(progress.speed),
                  formatEta(progress.eta),
                ]
                  .filter(Boolean)
                  .join(" · ") || "Starting…"}
              </span>
              <button className="ghost" onClick={cancelUpload}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div>
              <strong>Drop files here</strong> or click to choose
            </div>
            <div className="hint">
              {currentFolderId
                ? `Uploads land in “${trail[trail.length - 1]?.name}”.`
                : "Each file gets a private link only people you share it with can use."}
            </div>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            uploadFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {error && <ErrorModal message={error} onClose={() => setError("")} />}

      {moveTarget && (
        <MoveModal
          target={moveTarget}
          folders={folders}
          onClose={() => setMoveTarget(null)}
          onChoose={doMove}
        />
      )}

      {hasAnything && (
        <div className="search">
          <svg
            className="search-icon"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            aria-hidden="true"
          >
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm10 2-4.35-4.35"
            />
          </svg>
          <input
            type="text"
            className="search-input"
            placeholder="Search all files"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search files"
          />
          {query && (
            <button
              className="search-clear"
              onClick={() => setQuery("")}
              title="Clear"
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
      )}

      {!searching && (
        <div className="folder-bar">
          <nav className="breadcrumbs" aria-label="Folder path">
            <button
              className="crumb"
              onClick={() => setCurrentFolderId(null)}
              disabled={currentFolderId === null}
            >
              Home
            </button>
            {trail.map((f) => (
              <span key={f.id} className="crumb-wrap">
                <span className="crumb-sep">/</span>
                <button
                  className="crumb"
                  onClick={() => setCurrentFolderId(f.id)}
                  disabled={f.id === currentFolderId}
                >
                  {f.name}
                </button>
              </span>
            ))}
          </nav>
          {creating ? (
            <form
              className="new-folder"
              onSubmit={(e) => {
                e.preventDefault();
                createNewFolder();
              }}
            >
              <input
                autoFocus
                className="new-folder-input"
                placeholder="Folder name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onBlur={createNewFolder}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setNewName("");
                    setCreating(false);
                  }
                }}
              />
            </form>
          ) : (
            <button className="ghost new-folder-btn" onClick={() => setCreating(true)}>
              + New folder
            </button>
          )}
        </div>
      )}

      <div className="file-list">
        {searching ? (
          visibleFiles.length === 0 ? (
            <div className="empty">No files match “{query}”.</div>
          ) : (
            visibleFiles.map((f) => (
              <FileRow key={f.token} file={f} onMove={setMoveTarget} onDelete={onDeleteFile} />
            ))
          )
        ) : isEmptyHere ? (
          <div className="empty">
            {currentFolderId
              ? "This folder is empty. Upload files or create a folder."
              : "No files yet. Upload something or create a folder."}
          </div>
        ) : (
          <>
            {visibleFolders.map((f) => (
              <FolderRow
                key={f.id}
                folder={f}
                count={childCount(f.id)}
                onOpen={setCurrentFolderId}
                onRename={renameFolder}
                onMove={setMoveTarget}
                onDelete={deleteFolder}
              />
            ))}
            {visibleFiles.map((f) => (
              <FileRow key={f.token} file={f} onMove={setMoveTarget} onDelete={onDeleteFile} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";

/* ----------------------------- formatting ------------------------------- */

function formatSize(bytes) {
  if (bytes == null) return "—";
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
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
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
  image: "IMG",
  video: "▶",
  audio: "♪",
  pdf: "PDF",
  archive: "ZIP",
  doc: "DOC",
  sheet: "XLS",
  code: "</>",
  file: "FILE",
};

/* -------------------------------- icons --------------------------------- */

const I = {
  plus: "M12 5v14M5 12h14",
  upload: "M12 19V6M5 12l7-7 7 7M5 21h14",
  folderPlus: "M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7ZM12 11v5M9.5 13.5h5",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  search: "M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm10 2-4.35-4.35",
  kebab: "M12 6h.01M12 12h.01M12 18h.01",
  copy: "M9 9h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Zm-2 8H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
  open: "M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4",
  pencil: "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z",
  move: "M3 7V5a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v2M3 7h18M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9M12 11v6m0 0 2.5-2.5M12 17l-2.5-2.5",
  trash: "M4 7h16M10 11v6M14 11v6M5 7l1 13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-13M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3",
  logout: "M16 17l5-5-5-5M21 12H9M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4",
  cloud: "M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.5A3.5 3.5 0 0 1 18 17H7Z",
};

function Icon({ d, size = 18, fill = false }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        d={d}
        fill={fill ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FolderGlyph({ size = 22 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        fill="currentColor"
        d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2Z"
      />
    </svg>
  );
}

function TypeGlyph({ file, big }) {
  const kind = fileKind(file);
  return (
    <div className={`glyph kind-${kind}${big ? " glyph-big" : ""}`} aria-hidden="true">
      {KIND_GLYPH[kind]}
    </div>
  );
}

// Image preview from the share link, falling back to the type glyph.
function Thumb({ file, big }) {
  const [failed, setFailed] = useState(false);
  const isImg = fileKind(file) === "image" && !failed;
  if (isImg) {
    return (
      <img
        className={big ? "thumb-img" : "glyph thumb-mini"}
        src={`/f/${file.token}`}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    );
  }
  return <TypeGlyph file={file} big={big} />;
}

/* ----------------------------- dropdown menu ---------------------------- */

function Dropdown({ trigger, children, className, align = "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      {trigger(open, setOpen)}
      {open && (
        <div
          className={`menu menu-${align} ${className || ""}`}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, onClick, danger }) {
  // No stopPropagation here on purpose: the click bubbles to the enclosing
  // `.menu` container, which closes the dropdown (and stops propagation there,
  // so it never reaches a clickable card behind it).
  return (
    <button
      className={`menu-item${danger ? " danger" : ""}`}
      onClick={onClick}
    >
      <Icon d={icon} size={16} />
      <span>{label}</span>
    </button>
  );
}

// Action menu shared by files and folders. `actions` is an array of
// { icon, label, onClick, danger } or { sep:true }.
function ItemMenu({ actions }) {
  return (
    <Dropdown
      align="right"
      trigger={(open, setOpen) => (
        <button
          className="kebab"
          aria-label="More actions"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!open);
          }}
        >
          <Icon d={I.kebab} size={18} fill />
        </button>
      )}
    >
      {actions.map((a, i) =>
        a.sep ? (
          <div key={i} className="menu-sep" />
        ) : (
          <MenuItem
            key={i}
            icon={a.icon}
            label={a.label}
            onClick={a.onClick}
            danger={a.danger}
          />
        )
      )}
    </Dropdown>
  );
}

/* -------------------------------- items --------------------------------- */

function fileActions(file, { copy, open, onRename, onMove, onDelete }) {
  return [
    { icon: I.open, label: "Open", onClick: open },
    { icon: I.copy, label: "Copy link", onClick: copy },
    { icon: I.pencil, label: "Rename", onClick: () => onRename(file) },
    {
      icon: I.move,
      label: "Move",
      onClick: () => onMove({ type: "file", id: file.token, name: file.name }),
    },
    { sep: true },
    { icon: I.trash, label: "Delete", danger: true, onClick: () => onDelete(file.token) },
  ];
}

function folderActions(folder, { onOpen, onRename, onMove, onDelete }) {
  return [
    { icon: I.open, label: "Open", onClick: () => onOpen(folder.id) },
    { icon: I.pencil, label: "Rename", onClick: () => onRename(folder) },
    {
      icon: I.move,
      label: "Move",
      onClick: () => onMove({ type: "folder", id: folder.id, name: folder.name }),
    },
    { sep: true },
    { icon: I.trash, label: "Delete", danger: true, onClick: () => onDelete(folder) },
  ];
}

function FileItem({ file, view, onMove, onRename, onDelete, onFlash }) {
  const relPath = `/f/${file.token}`;
  const open = () => window.open(relPath, "_blank", "noopener,noreferrer");
  const copy = async () => {
    const url = `${window.location.origin}${relPath}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const el = document.createElement("textarea");
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    onFlash("Link copied");
  };
  const actions = fileActions(file, { copy, open, onRename, onMove, onDelete });

  if (view === "grid") {
    return (
      <div className="card card-file">
        <div className="card-head">
          <TypeGlyph file={file} />
          <div className="card-title" title={file.name}>
            {file.name}
          </div>
          <ItemMenu actions={actions} />
        </div>
        <button className="card-thumb" onClick={open} title="Open">
          <Thumb file={file} big />
        </button>
      </div>
    );
  }

  return (
    <div className="row">
      <Thumb file={file} />
      <div className="row-main">
        <div className="row-name" title={file.name}>
          {file.name}
        </div>
        <div className="row-sub">
          {formatSize(file.size)} ·{" "}
          <span suppressHydrationWarning>{formatDate(file.uploadedAt)}</span>
        </div>
      </div>
      <button className="row-quick" onClick={copy} title="Copy link" aria-label="Copy link">
        <Icon d={I.copy} />
      </button>
      <ItemMenu actions={actions} />
    </div>
  );
}

function FolderItem({ folder, view, count, onOpen, onRename, onMove, onDelete }) {
  const actions = folderActions(folder, { onOpen, onRename, onMove, onDelete });

  if (view === "grid") {
    return (
      <div
        className="card card-folder"
        onClick={() => onOpen(folder.id)}
        title={folder.name}
      >
        <span className="card-folder-icon">
          <FolderGlyph size={20} />
        </span>
        <span className="card-folder-name">{folder.name}</span>
        <ItemMenu actions={actions} />
      </div>
    );
  }

  return (
    <div className="row row-folder" onClick={() => onOpen(folder.id)}>
      <span className="glyph kind-folder">
        <FolderGlyph size={20} />
      </span>
      <div className="row-main">
        <div className="row-name">{folder.name}</div>
        <div className="row-sub">{count === 1 ? "1 item" : `${count} items`}</div>
      </div>
      <ItemMenu actions={actions} />
    </div>
  );
}

/* -------------------------------- modals -------------------------------- */

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

function MoveModal({ target, folders, onClose, onChoose }) {
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
            <FolderGlyph size={18} />
            <span>My Files (home)</span>
          </button>
          {ordered.map((f) => (
            <button
              key={f.id}
              className="move-item"
              disabled={disabledIds.has(f.id)}
              style={{ paddingLeft: `${14 + depth(f.id) * 18}px` }}
              onClick={() => onChoose(f.id)}
            >
              <FolderGlyph size={18} />
              <span>{f.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ storage meter --------------------------- */

function StorageMeter({ stats, filesTotal, fileCount }) {
  const disk = stats?.disk;
  const pct =
    disk && disk.total > 0
      ? Math.min(100, Math.max(0, (disk.used / disk.total) * 100))
      : null;
  return (
    <div className="meter">
      <div className="meter-top">
        <Icon d={I.cloud} size={16} />
        <span>Storage</span>
      </div>
      {disk ? (
        <>
          <div className="meter-track">
            <div className="meter-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="meter-label">
            {formatSize(disk.used)} of {formatSize(disk.total)} used
          </div>
          <div className="meter-sub">
            {formatSize(disk.free)} free ·{" "}
            {fileCount === 1 ? "1 file" : `${fileCount} files`} ·{" "}
            {formatSize(filesTotal)}
          </div>
        </>
      ) : (
        <div className="meter-label">
          {fileCount === 1 ? "1 file" : `${fileCount} files`} ·{" "}
          {formatSize(filesTotal)}
        </div>
      )}
    </div>
  );
}

/* ------------------------------- dashboard ------------------------------ */

export default function Dashboard({ initialFiles, initialFolders, initialStats }) {
  const router = useRouter();
  const [files, setFiles] = useState(initialFiles);
  const [folders, setFolders] = useState(initialFolders || []);
  const [stats, setStats] = useState(initialStats || null);
  const [currentFolderId, setCurrentFolderId] = useState(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState("grid");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [moveTarget, setMoveTarget] = useState(null);
  const [progress, setProgress] = useState(null);

  const inputRef = useRef(null);
  const xhrRef = useRef(null);
  const cancelledRef = useRef(false);
  const uploadIdRef = useRef(null);
  const folderRef = useRef(null);
  const noticeTimer = useRef(null);

  useEffect(() => {
    folderRef.current = currentFolderId;
  }, [currentFolderId]);

  // Restore the saved grid/list preference.
  useEffect(() => {
    try {
      const v = localStorage.getItem("cdn_view");
      if (v === "grid" || v === "list") setView(v);
    } catch {}
  }, []);

  const chooseView = (v) => {
    setView(v);
    try {
      localStorage.setItem("cdn_view", v);
    } catch {}
  };

  const flash = useCallback((msg) => {
    setNotice(msg);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 1800);
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      const res = await fetch("/api/storage");
      if (res.ok) setStats(await res.json());
    } catch {}
  }, []);

  const uploading = progress !== null;

  const MAX_CHUNK = 4 * 1024 * 1024;
  const MIN_CHUNK = 64 * 1024;

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
        offset = end;
      } catch (e) {
        if (e.status === 413 && chunkSize > MIN_CHUNK) {
          chunkSize = Math.max(MIN_CHUNK, Math.floor(chunkSize / 2));
          continue;
        }
        throw e;
      }
    }

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

  const uploadFiles = useCallback(
    async (fileList) => {
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
        if (e.message !== "__cancelled__") setError(e.message || "Upload failed");
      } finally {
        xhrRef.current = null;
        setProgress(null);
        refreshStats();
      }
    },
    [refreshStats]
  );

  function cancelUpload() {
    cancelledRef.current = true;
    xhrRef.current?.abort();
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
    refreshStats();
  }

  async function renameFileEntry(file) {
    const name = window.prompt("Rename file", file.name);
    if (name == null) return;
    const clean = name.trim();
    if (!clean || clean === file.name) return;
    try {
      const res = await fetch("/api/files", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: file.token, name: clean }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't rename file");
      setFiles((prev) =>
        prev.map((f) => (f.token === file.token ? { ...f, name: clean } : f))
      );
    } catch (e) {
      setError(e.message);
    }
  }

  async function createFolderNamed(name) {
    const clean = (name || "").trim();
    if (!clean) return;
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: clean, parentId: currentFolderId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't create folder");
      setFolders((prev) => [...prev, data.folder]);
    } catch (e) {
      setError(e.message);
    }
  }

  function promptNewFolder() {
    const name = window.prompt("New folder name");
    if (name != null) createFolderNamed(name);
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
      setFolders((prev) => prev.map((f) => (f.id === folder.id ? data.folder : f)));
    } catch (e) {
      setError(e.message);
    }
  }

  async function deleteFolder(folder) {
    const childFolders = folders.filter((f) => f.parentId === folder.id).length;
    const childFiles = files.filter((f) => f.folderId === folder.id).length;
    const note = childFolders + childFiles > 0 ? " and everything inside it" : "";
    if (!window.confirm(`Delete “${folder.name}”${note}? This can't be undone.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/folders?id=${encodeURIComponent(folder.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Couldn't delete folder");
      }
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
      refreshStats();
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
      flash("Moved");
    } catch (e) {
      setError(e.message);
    }
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

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

  const filesTotal = useMemo(
    () => files.reduce((sum, f) => sum + (f.size || 0), 0),
    [files]
  );

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
  const folderGridClass = view === "grid" ? "folder-grid" : "list";
  const fileGridClass = view === "grid" ? "file-grid" : "list";

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Icon d={I.cloud} size={20} />
          </span>
          <span className="brand-name">My Files</span>
        </div>

        <Dropdown
          align="left"
          className="new-menu"
          trigger={(open, setOpen) => (
            <button className="new-btn" onClick={() => setOpen(!open)}>
              <Icon d={I.plus} size={20} />
              <span>New</span>
            </button>
          )}
        >
          <MenuItem
            icon={I.upload}
            label="File upload"
            onClick={() => inputRef.current?.click()}
          />
          <MenuItem icon={I.folderPlus} label="New folder" onClick={promptNewFolder} />
        </Dropdown>

        <nav className="nav">
          <button
            className={`nav-item${currentFolderId === null ? " active" : ""}`}
            onClick={() => {
              setCurrentFolderId(null);
              setQuery("");
            }}
          >
            <FolderGlyph size={18} />
            <span>My Files</span>
          </button>
        </nav>

        <div className="sidebar-foot">
          <StorageMeter stats={stats} filesTotal={filesTotal} fileCount={files.length} />
          <button className="logout" onClick={logout}>
            <Icon d={I.logout} size={16} />
            <span>Log out</span>
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="main-top">
          <div className="searchbar">
            <Icon d={I.search} size={18} />
            <input
              type="text"
              placeholder="Search in My Files"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search files"
            />
            {query && (
              <button
                className="search-clear"
                onClick={() => setQuery("")}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>
          <div className="view-toggle" role="group" aria-label="View">
            <button
              className={`view-btn${view === "list" ? " active" : ""}`}
              onClick={() => chooseView("list")}
              title="List view"
              aria-label="List view"
            >
              <Icon d={I.list} />
            </button>
            <button
              className={`view-btn${view === "grid" ? " active" : ""}`}
              onClick={() => chooseView("grid")}
              title="Grid view"
              aria-label="Grid view"
            >
              <Icon d={I.grid} />
            </button>
          </div>
        </header>

        <div
          className={`content${dragging ? " drag" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setDragging(false);
          }}
          onDrop={onDrop}
        >
          <div className="content-head">
            <nav className="crumbs" aria-label="Folder path">
              <button
                className="crumb"
                onClick={() => setCurrentFolderId(null)}
                disabled={currentFolderId === null && !searching}
              >
                My Files
              </button>
              {!searching &&
                trail.map((f) => (
                  <span key={f.id} className="crumb-wrap">
                    <span className="crumb-sep">›</span>
                    <button
                      className="crumb"
                      onClick={() => setCurrentFolderId(f.id)}
                      disabled={f.id === currentFolderId}
                    >
                      {f.name}
                    </button>
                  </span>
                ))}
              {searching && (
                <span className="crumb-wrap">
                  <span className="crumb-sep">›</span>
                  <span className="crumb current">Search results</span>
                </span>
              )}
            </nav>
          </div>

          {isEmptyHere ? (
            <div className="empty">
              <div className="empty-art">
                <FolderGlyph size={40} />
              </div>
              {searching ? (
                <p>No files match “{query}”.</p>
              ) : (
                <>
                  <p>{currentFolderId ? "This folder is empty." : "Nothing here yet."}</p>
                  <p className="empty-sub">
                    Drag files in, or use the <strong>New</strong> button to upload or
                    create a folder.
                  </p>
                </>
              )}
            </div>
          ) : (
            <>
              {visibleFolders.length > 0 && (
                <section className="block">
                  <h2 className="section-label">Folders</h2>
                  <div className={folderGridClass}>
                    {visibleFolders.map((f) => (
                      <FolderItem
                        key={f.id}
                        folder={f}
                        view={view}
                        count={childCount(f.id)}
                        onOpen={setCurrentFolderId}
                        onRename={renameFolder}
                        onMove={setMoveTarget}
                        onDelete={deleteFolder}
                      />
                    ))}
                  </div>
                </section>
              )}

              {visibleFiles.length > 0 && (
                <section className="block">
                  <h2 className="section-label">Files</h2>
                  <div className={fileGridClass}>
                    {visibleFiles.map((f) => (
                      <FileItem
                        key={f.token}
                        file={f}
                        view={view}
                        onMove={setMoveTarget}
                        onRename={renameFileEntry}
                        onDelete={onDeleteFile}
                        onFlash={flash}
                      />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}

          {dragging && (
            <div className="drop-overlay">
              <div className="drop-card">
                <Icon d={I.upload} size={28} />
                <span>Drop files to upload</span>
              </div>
            </div>
          )}
        </div>
      </main>

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

      {uploading && (
        <div className="upload-toast">
          <div className="ut-head">
            <span className="ut-title">
              <span className="spinner" aria-hidden="true" />
              Uploading {progress.total > 1 ? `${progress.index}/${progress.total}` : ""}
            </span>
            <button className="ut-cancel" onClick={cancelUpload}>
              Cancel
            </button>
          </div>
          <div className="ut-name" title={progress.name}>
            {progress.name}
          </div>
          <div className="ut-track">
            <div className="ut-fill" style={{ width: `${progress.percent}%` }} />
          </div>
          <div className="ut-foot">
            <span>{progress.percent}%</span>
            <span>
              {[formatSpeed(progress.speed), formatEta(progress.eta)]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        </div>
      )}

      {notice && <div className="toast">{notice}</div>}
      {error && <ErrorModal message={error} onClose={() => setError("")} />}
      {moveTarget && (
        <MoveModal
          target={moveTarget}
          folders={folders}
          onClose={() => setMoveTarget(null)}
          onChoose={doMove}
        />
      )}
    </div>
  );
}

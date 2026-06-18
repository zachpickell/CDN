"use client";

import { useState, useRef, useCallback } from "react";
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

function FileRow({ file, onDelete }) {
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
      <div className="file-meta">
        <div className="file-name">{file.name}</div>
        <div className="file-sub">
          {formatSize(file.size)} · {formatDate(file.uploadedAt)}
        </div>
      </div>
      <div className="row-actions">
        <button className="secondary" onClick={copy}>
          {copied ? <span className="copied">Copied!</span> : "Copy link"}
        </button>
        <a href={shareUrl} target="_blank" rel="noreferrer">
          <button className="ghost">Open</button>
        </a>
        <button className="ghost" onClick={() => onDelete(file.token)}>
          Delete
        </button>
      </div>
    </div>
  );
}

export default function Dashboard({ initialFiles }) {
  const router = useRouter();
  const [files, setFiles] = useState(initialFiles);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  const uploadFiles = useCallback(async (fileList) => {
    const arr = Array.from(fileList);
    if (arr.length === 0) return;
    setError("");
    setUploading(true);
    try {
      for (const file of arr) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Failed to upload ${file.name}`);
        }
        const entry = await res.json();
        setFiles((prev) => [entry, ...prev]);
      }
    } catch (e) {
      setError(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }, []);

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files);
  }

  async function onDelete(token) {
    setFiles((prev) => prev.filter((f) => f.token !== token));
    await fetch(`/api/files?token=${encodeURIComponent(token)}`, {
      method: "DELETE",
    });
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

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
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {uploading ? (
          <strong>Uploading…</strong>
        ) : (
          <>
            <div>
              <strong>Drop files here</strong> or click to choose
            </div>
            <div className="hint">
              Each file gets a private link only people you share it with can use.
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

      {error && <div className="error">{error}</div>}

      <div className="file-list">
        {files.length === 0 ? (
          <div className="empty">No files yet. Upload something to get a share link.</div>
        ) : (
          files.map((f) => (
            <FileRow key={f.token} file={f} onDelete={onDelete} />
          ))
        )}
      </div>
    </div>
  );
}

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
  const [error, setError] = useState("");
  // null when idle, otherwise { name, percent, index, total }
  const [progress, setProgress] = useState(null);
  const inputRef = useRef(null);
  const xhrRef = useRef(null);
  const cancelledRef = useRef(false);

  const uploading = progress !== null;

  // Upload a single file via XHR so we get upload progress events
  // (fetch can't report upload progress).
  function uploadOne(file, onProgress) {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append("file", file);

      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      xhr.open("POST", "/api/upload");

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onabort = () => reject(new Error("__cancelled__"));
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            reject(new Error("Bad server response"));
          }
        } else {
          let msg = `Failed to upload ${file.name}`;
          try {
            msg = JSON.parse(xhr.responseText).error || msg;
          } catch {}
          reject(new Error(msg));
        }
      };
      xhr.onerror = () => reject(new Error(`Failed to upload ${file.name}`));
      xhr.send(fd);
    });
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
        setProgress({ name: file.name, percent: 0, index: i + 1, total: arr.length });
        const entry = await uploadOne(file, (percent) =>
          setProgress({ name: file.name, percent, index: i + 1, total: arr.length })
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
  }

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
                {progress.total > 1
                  ? `File ${progress.index} of ${progress.total}`
                  : "Uploading…"}
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

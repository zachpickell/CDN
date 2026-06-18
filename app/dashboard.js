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
        <h2 className="modal-title">Upload failed</h2>
        <p className="modal-message">{message}</p>
        <button className="modal-ok" onClick={onClose}>
          Dismiss
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
  const uploadIdRef = useRef(null);

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

    // All bytes sent — finalize and get the file metadata.
    const entry = await sendChunk(
      null,
      {
        "X-Upload-Id": uploadId,
        "X-Finalize": "1",
        "X-Filename": encodeURIComponent(file.name),
        "X-Filetype": file.type || "application/octet-stream",
      },
      null
    );
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

      {error && <ErrorModal message={error} onClose={() => setError("")} />}

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

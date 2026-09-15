"use client";

// Floating "Ask" panel for the local RAG. Self-contained (its own state and
// inline styles keyed to the app's CSS variables) so it can be dropped in from
// page.js without touching the main dashboard. Talks to /api/rag/ask (streamed
// grounded answer + X-RAG-Sources header) and /api/rag/reindex.

import { useState, useRef, useEffect, useCallback } from "react";

const box = {
  bg: "var(--bg)",
  panel: "var(--panel)",
  panel2: "var(--panel-2)",
  border: "var(--border)",
  text: "var(--text)",
  muted: "var(--muted)",
  accent: "var(--accent)",
};

function decodeSources(header) {
  if (!header) return [];
  try {
    return JSON.parse(atob(header));
  } catch {
    return [];
  }
}

export default function AskPanel() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all"); // all | doc | code
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(null); // reindex status
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  // Keyboard shortcut: Cmd/Ctrl+K toggles the panel.
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ask = useCallback(async () => {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setError("");
    setAnswer("");
    setSources([]);
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/rag/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: q, kind: kind === "all" ? undefined : kind }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Request failed (${res.status})`);
      }
      setSources(decodeSources(res.headers.get("x-rag-sources")));
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setAnswer(acc);
      }
    } catch (err) {
      if (err.name !== "AbortError") setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [query, kind, busy]);

  const reindex = useCallback(async () => {
    setStatus({ msg: "Starting…" });
    try {
      await fetch("/api/rag/reindex", { method: "POST" });
      // Poll for completion.
      const poll = async () => {
        const r = await fetch("/api/rag/reindex");
        const j = await r.json();
        if (j.running) {
          setStatus({ msg: "Indexing…", vectors: j.vectors });
          setTimeout(poll, 2000);
        } else {
          const s = j.last;
          setStatus({
            msg: s?.ok
              ? `Indexed ${s.indexed} files (${s.chunksUp} chunks), ${s.vectors ?? j.vectors ?? "?"} vectors total`
              : s?.error
              ? `Error: ${s.error}`
              : "Idle",
            vectors: j.vectors,
          });
        }
      };
      setTimeout(poll, 1500);
    } catch (err) {
      setStatus({ msg: `Error: ${err.message}` });
    }
  }, []);

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Ask your files (⌘K)"
        style={{
          position: "fixed",
          right: 20,
          bottom: 20,
          zIndex: 60,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 16px",
          borderRadius: 999,
          border: `1px solid ${box.border}`,
          background: box.accent,
          color: "#fff",
          fontSize: 14,
          fontWeight: 600,
          cursor: "pointer",
          boxShadow: "0 6px 20px rgba(0,0,0,.35)",
        }}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm10 2-4.35-4.35" />
        </svg>
        Ask
      </button>

      {open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 55,
            background: "rgba(0,0,0,.45)",
            display: "flex",
            justifyContent: "flex-end",
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            style={{
              width: "min(560px, 100%)",
              height: "100%",
              background: box.panel,
              borderLeft: `1px solid ${box.border}`,
              display: "flex",
              flexDirection: "column",
              padding: 20,
              gap: 14,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: box.text }}>Ask your files</div>
              <button
                onClick={() => setOpen(false)}
                style={{ background: "none", border: "none", color: box.muted, cursor: "pointer", fontSize: 20 }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && ask()}
                placeholder="Ask a question about your files…"
                style={{
                  flex: 1,
                  padding: "11px 12px",
                  borderRadius: 10,
                  border: `1px solid ${box.border}`,
                  background: box.panel2,
                  color: box.text,
                  fontSize: 14,
                }}
              />
              <button
                onClick={ask}
                disabled={busy}
                style={{
                  padding: "0 16px",
                  borderRadius: 10,
                  border: "none",
                  background: box.accent,
                  color: "#fff",
                  fontWeight: 600,
                  cursor: busy ? "default" : "pointer",
                  opacity: busy ? 0.7 : 1,
                }}
              >
                {busy ? "…" : "Ask"}
              </button>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: box.muted }}>
              <span>Scope:</span>
              {["all", "doc", "code"].map((k) => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 999,
                    border: `1px solid ${kind === k ? box.accent : box.border}`,
                    background: kind === k ? "rgba(91,140,255,.15)" : "transparent",
                    color: kind === k ? box.accent : box.muted,
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  {k === "all" ? "Everything" : k === "doc" ? "Documents" : "Code"}
                </button>
              ))}
              <span style={{ flex: 1 }} />
              <button
                onClick={reindex}
                title="Re-scan and index new/changed files"
                style={{ padding: "4px 10px", borderRadius: 999, border: `1px solid ${box.border}`, background: "transparent", color: box.muted, cursor: "pointer", fontSize: 12 }}
              >
                Re-index
              </button>
            </div>

            {status && <div style={{ fontSize: 12, color: box.muted }}>{status.msg}</div>}
            {error && <div style={{ fontSize: 13, color: "var(--danger)" }}>{error}</div>}

            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
              {answer && (
                <div
                  style={{
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.55,
                    fontSize: 14,
                    color: box.text,
                    background: box.panel2,
                    border: `1px solid ${box.border}`,
                    borderRadius: 10,
                    padding: 14,
                  }}
                >
                  {answer}
                  {busy && <span style={{ color: box.muted }}>▍</span>}
                </div>
              )}

              {sources.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, color: box.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Sources
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {sources.map((s) => {
                      const label = `[${s.n}] ${s.rel || s.name}${s.root && s.root !== "cdn" ? `  ·  ${s.root}` : ""}`;
                      const inner = (
                        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                          <span style={{ color: box.accent, fontVariantNumeric: "tabular-nums" }}>[{s.n}]</span>
                          <span style={{ color: box.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {s.rel || s.name}
                          </span>
                          {s.root && s.root !== "cdn" && (
                            <span style={{ color: box.muted, fontSize: 11 }}>· {s.root}</span>
                          )}
                        </span>
                      );
                      return (
                        <div
                          key={s.n}
                          style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${box.border}`, background: box.panel2 }}
                          title={label}
                        >
                          {s.token ? (
                            <a href={`/f/${s.token}`} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                              {inner}
                            </a>
                          ) : (
                            inner
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {!answer && !busy && !error && (
                <div style={{ fontSize: 13, color: box.muted, lineHeight: 1.6 }}>
                  Ask anything about the files you&apos;ve indexed — documents and code on your
                  server. Answers are generated locally and cite the files they came from.
                  <br />
                  <br />
                  Tip: press <kbd>⌘K</kbd> anywhere to open this, <kbd>Esc</kbd> to close.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

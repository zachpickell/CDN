"use client";

// Floating "Ask your files" panel for the local RAG. Self-contained: its own
// state, its own <style> block (scoped to .rag- classes), no external deps.
// Talks to /api/rag/ask (streamed answer + X-RAG-Sources header). Mounted from
// app/page.js so it never touches the main dashboard.

import { useState, useRef, useEffect, useCallback } from "react";

const ASK_TIMEOUT_MS = 90_000; // give up (with a clear message) after 90s
const EXAMPLES = [
  "What projects do I have?",
  "Summarize my most recent notes",
  "Where did I write about deployment?",
];

/* ---------------------- tiny, safe markdown renderer --------------------- */
// Escapes everything, then re-introduces a small, known-safe subset. Turns
// [n] citations into clickable anchors the panel wires up via delegation.

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderInline(s) {
  return s
    .replace(/`([^`]+)`/g, (_, c) => `<code class="rag-code">${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, "<em>$1</em>")
    .replace(/\[(\d+)\]/g, (_, n) => `<a class="rag-cite" data-n="${n}" title="Jump to source ${n}">${n}</a>`);
}

function renderMarkdown(md) {
  if (!md) return "";
  const src = escapeHtml(md.replace(/\r\n/g, "\n"));
  const lines = src.split("\n");
  let html = "";
  let i = 0;
  let listOpen = false;
  const closeList = () => {
    if (listOpen) {
      html += "</ul>";
      listOpen = false;
    }
  };
  while (i < lines.length) {
    const line = lines[i];
    // fenced code block
    if (/^```/.test(line.trim())) {
      closeList();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      html += `<pre class="rag-pre"><code>${buf.join("\n")}</code></pre>`;
      continue;
    }
    // bullet list item
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      if (!listOpen) {
        html += '<ul class="rag-ul">';
        listOpen = true;
      }
      html += `<li>${renderInline(bullet[1])}</li>`;
      i++;
      continue;
    }
    // numbered list item -> render as its own line (keeps the number)
    const num = line.match(/^\s*(\d+)\.\s+(.*)$/);
    if (num) {
      closeList();
      html += `<div class="rag-num"><span>${num[1]}.</span><span>${renderInline(num[2])}</span></div>`;
      i++;
      continue;
    }
    // blank line
    if (!line.trim()) {
      closeList();
      i++;
      continue;
    }
    // heading -> just bold-ish line
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      closeList();
      html += `<div class="rag-h">${renderInline(h[1])}</div>`;
      i++;
      continue;
    }
    // paragraph (gather consecutive non-empty, non-special lines)
    closeList();
    const buf = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^```/.test(lines[i].trim()) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^#{1,6}\s+/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    html += `<p class="rag-p">${renderInline(buf.join(" "))}</p>`;
  }
  closeList();
  return html;
}

function decodeSources(header) {
  if (!header) return [];
  try {
    return JSON.parse(atob(header));
  } catch {
    return [];
  }
}

/* -------------------------------- styles --------------------------------- */

const STYLE = `
.rag-fab{position:fixed;right:22px;bottom:22px;z-index:60;display:flex;align-items:center;gap:8px;
  padding:12px 18px;border-radius:999px;border:none;cursor:pointer;font-size:14px;font-weight:600;color:#fff;
  background:linear-gradient(135deg,var(--accent),#7aa2ff);box-shadow:0 8px 24px rgba(20,40,120,.45);
  transition:transform .15s ease,box-shadow .15s ease}
.rag-fab:hover{transform:translateY(-1px);box-shadow:0 10px 30px rgba(20,40,120,.55)}
.rag-fab kbd{font:inherit;font-size:11px;opacity:.8;background:rgba(255,255,255,.18);padding:1px 6px;border-radius:5px}
.rag-scrim{position:fixed;inset:0;z-index:55;background:rgba(4,6,12,.55);backdrop-filter:blur(3px);
  display:flex;justify-content:flex-end;animation:ragFade .18s ease}
@keyframes ragFade{from{opacity:0}to{opacity:1}}
.rag-panel{width:min(580px,100%);height:100%;background:var(--panel);border-left:1px solid var(--border);
  display:flex;flex-direction:column;animation:ragSlide .22s cubic-bezier(.2,.7,.2,1)}
@keyframes ragSlide{from{transform:translateX(24px);opacity:.6}to{transform:translateX(0);opacity:1}}
.rag-head{display:flex;align-items:center;gap:10px;padding:18px 20px;border-bottom:1px solid var(--border)}
.rag-head .rag-dot{width:9px;height:9px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 3px rgba(62,207,142,.15)}
.rag-title{font-size:15px;font-weight:700;color:var(--text)}
.rag-sub{font-size:12px;color:var(--muted)}
.rag-x{margin-left:auto;background:none;border:none;color:var(--muted);cursor:pointer;font-size:18px;padding:4px;border-radius:8px}
.rag-x:hover{color:var(--text);background:var(--panel-2)}
.rag-form{padding:16px 20px 10px}
.rag-inputwrap{display:flex;gap:8px}
.rag-input{flex:1;padding:12px 14px;border-radius:12px;border:1px solid var(--border);background:var(--panel-2);
  color:var(--text);font-size:14px;outline:none;transition:border-color .15s}
.rag-input:focus{border-color:var(--accent)}
.rag-send{padding:0 18px;border-radius:12px;border:none;background:var(--accent);color:#fff;font-weight:600;
  font-size:14px;cursor:pointer;transition:background .15s}
.rag-send:hover{background:var(--accent-hover)}
.rag-send:disabled{opacity:.5;cursor:default}
.rag-pills{display:flex;align-items:center;gap:6px;margin-top:12px;flex-wrap:wrap}
.rag-pill{padding:5px 12px;border-radius:999px;border:1px solid var(--border);background:transparent;
  color:var(--muted);cursor:pointer;font-size:12px;transition:all .12s}
.rag-pill:hover{color:var(--text)}
.rag-pill.on{border-color:var(--accent);background:rgba(91,140,255,.14);color:var(--accent)}
.rag-pill.ghost{margin-left:auto}
.rag-body{flex:1;overflow-y:auto;padding:6px 20px 22px}
.rag-status{display:flex;align-items:center;gap:9px;font-size:13px;color:var(--muted);padding:10px 0}
.rag-spin{width:14px;height:14px;border-radius:50%;border:2px solid var(--border);border-top-color:var(--accent);
  animation:ragSpin .8s linear infinite}
@keyframes ragSpin{to{transform:rotate(360deg)}}
.rag-answer{background:var(--panel-2);border:1px solid var(--border);border-radius:14px;padding:16px 18px;
  color:var(--text);font-size:14.5px;line-height:1.6}
.rag-answer .rag-p{margin:0 0 10px}.rag-answer .rag-p:last-child{margin-bottom:0}
.rag-answer .rag-h{font-weight:700;margin:6px 0 8px;font-size:15px}
.rag-ul{margin:4px 0 10px;padding-left:20px}.rag-ul li{margin:3px 0}
.rag-num{display:flex;gap:8px;margin:3px 0}.rag-num>span:first-child{color:var(--muted)}
.rag-code{background:rgba(255,255,255,.07);padding:1px 5px;border-radius:5px;font-size:13px;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.rag-pre{background:#0d1017;border:1px solid var(--border);border-radius:10px;padding:12px;overflow-x:auto;
  margin:8px 0;font-size:12.5px;line-height:1.5}
.rag-cite{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 3px;
  margin:0 1px;border-radius:5px;background:rgba(91,140,255,.16);color:var(--accent);font-size:11px;font-weight:700;
  vertical-align:super;cursor:pointer;text-decoration:none;line-height:16px}
.rag-cite:hover{background:var(--accent);color:#fff}
.rag-caret{display:inline-block;width:7px;height:15px;background:var(--accent);margin-left:2px;border-radius:1px;
  animation:ragBlink 1s steps(2) infinite;vertical-align:text-bottom}
@keyframes ragBlink{50%{opacity:0}}
.rag-srclabel{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;margin:18px 0 8px}
.rag-src{display:block;text-decoration:none;padding:10px 12px;border-radius:10px;border:1px solid var(--border);
  background:var(--panel-2);margin-bottom:7px;transition:border-color .12s,transform .12s}
.rag-src:hover{border-color:var(--accent);transform:translateX(2px)}
.rag-src.flash{animation:ragFlash 1.1s ease}
@keyframes ragFlash{0%,100%{border-color:var(--border)}30%{border-color:var(--accent);background:rgba(91,140,255,.12)}}
.rag-srctop{display:flex;align-items:center;gap:8px}
.rag-srcn{min-width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;border-radius:5px;
  background:rgba(91,140,255,.16);color:var(--accent);font-size:11px;font-weight:700}
.rag-srcname{color:var(--text);font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rag-srcpath{color:var(--muted);font-size:11.5px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rag-bar{height:3px;border-radius:2px;background:var(--border);margin-top:7px;overflow:hidden}
.rag-bar>i{display:block;height:100%;background:var(--accent)}
.rag-empty{color:var(--muted);font-size:13.5px;line-height:1.7;padding:14px 0}
.rag-ex{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}
.rag-exbtn{padding:7px 12px;border-radius:10px;border:1px solid var(--border);background:var(--panel-2);
  color:var(--text);font-size:13px;cursor:pointer;transition:border-color .12s}
.rag-exbtn:hover{border-color:var(--accent)}
.rag-err{background:rgba(255,107,107,.1);border:1px solid rgba(255,107,107,.35);color:#ffb4b4;
  border-radius:10px;padding:12px 14px;font-size:13px;line-height:1.5}
.rag-foot{padding:10px 20px;border-top:1px solid var(--border);font-size:11.5px;color:var(--muted);
  display:flex;align-items:center;gap:12px}
.rag-foot kbd{background:var(--panel-2);border:1px solid var(--border);border-radius:5px;padding:1px 6px;font:inherit;font-size:11px}
`;

export default function AskPanel() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState([]);
  const [phase, setPhase] = useState("idle"); // idle|searching|thinking|streaming|done|error
  const [error, setError] = useState("");
  const [reidx, setReidx] = useState(null);
  const inputRef = useRef(null);
  const bodyRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

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

  // keep the newest content in view while streaming
  useEffect(() => {
    if (bodyRef.current && (phase === "streaming" || phase === "thinking")) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [answer, phase]);

  const run = useCallback(
    async (q) => {
      q = (q || "").trim();
      if (!q) return;
      setError("");
      setAnswer("");
      setSources([]);
      setPhase("searching");
      if (abortRef.current) abortRef.current.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const timer = setTimeout(() => ctrl.abort("timeout"), ASK_TIMEOUT_MS);
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
        setPhase("thinking");
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let acc = "";
        let first = true;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          acc += dec.decode(value, { stream: true });
          if (first && acc.trim()) {
            first = false;
            setPhase("streaming");
          }
          setAnswer(acc);
        }
        setPhase("done");
      } catch (err) {
        const aborted = ctrl.signal.aborted;
        if (aborted && ctrl.signal.reason === "timeout") {
          setError(
            "The model didn't respond in time. On CPU the first answer after an idle spell can be slow — try again (it's usually fast the second time), or check that the app can reach Ollama."
          );
          setPhase("error");
        } else if (aborted) {
          // superseded by a new question, or the panel closed — not an error
        } else {
          setError(err.message);
          setPhase("error");
        }
      } finally {
        clearTimeout(timer);
      }
    },
    [kind] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const reindex = useCallback(async () => {
    setReidx("Starting…");
    try {
      await fetch("/api/rag/reindex", { method: "POST" });
      const poll = async () => {
        const r = await fetch("/api/rag/reindex");
        const j = await r.json();
        if (j.running) {
          setReidx("Indexing…");
          setTimeout(poll, 2500);
        } else if (j.last?.ok) {
          setReidx(`Indexed ${j.last.indexed} files · ${j.vectors ?? "?"} chunks total`);
        } else if (j.last?.error) {
          setReidx(`Error: ${j.last.error}`);
        } else {
          setReidx(`Ready · ${j.vectors ?? 0} chunks indexed`);
        }
      };
      setTimeout(poll, 1500);
    } catch (e) {
      setReidx(`Error: ${e.message}`);
    }
  }, []);

  // citation click -> scroll to + flash the matching source card
  const onBodyClick = useCallback((e) => {
    const cite = e.target.closest?.(".rag-cite");
    if (!cite) return;
    e.preventDefault();
    const n = cite.getAttribute("data-n");
    const card = bodyRef.current?.querySelector(`.rag-src[data-n="${n}"]`);
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      card.classList.remove("flash");
      void card.offsetWidth; // reflow so the animation can retrigger
      card.classList.add("flash");
    }
  }, []);

  const busy = phase === "searching" || phase === "thinking" || phase === "streaming";

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />

      <button className="rag-fab" onClick={() => setOpen((o) => !o)} title="Ask your files (⌘K)">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm10 2-4.35-4.35" />
        </svg>
        Ask<kbd>⌘K</kbd>
      </button>

      {open && (
        <div className="rag-scrim" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="rag-panel">
            <div className="rag-head">
              <span className="rag-dot" />
              <div>
                <div className="rag-title">Ask your files</div>
                <div className="rag-sub">Answered locally · cites its sources</div>
              </div>
              <button className="rag-x" onClick={() => setOpen(false)} title="Close (Esc)">✕</button>
            </div>

            <div className="rag-form">
              <div className="rag-inputwrap">
                <input
                  ref={inputRef}
                  className="rag-input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !busy && run(query)}
                  placeholder="Ask anything about your files…"
                />
                <button className="rag-send" onClick={() => run(query)} disabled={busy}>
                  {busy ? "…" : "Ask"}
                </button>
              </div>
              <div className="rag-pills">
                {[["all", "Everything"], ["doc", "Documents"], ["code", "Code"]].map(([k, label]) => (
                  <button key={k} className={`rag-pill ${kind === k ? "on" : ""}`} onClick={() => setKind(k)}>
                    {label}
                  </button>
                ))}
                <button className="rag-pill ghost" onClick={reindex} title="Scan for new/changed files">
                  ⟳ Re-index
                </button>
              </div>
              {reidx && <div className="rag-status" style={{ paddingBottom: 0 }}>{reidx}</div>}
            </div>

            <div className="rag-body" ref={bodyRef} onClick={onBodyClick}>
              {phase === "searching" && (
                <div className="rag-status"><span className="rag-spin" />Searching your files…</div>
              )}
              {phase === "thinking" && (
                <div className="rag-status"><span className="rag-spin" />Reading sources and thinking…</div>
              )}

              {error && phase === "error" && <div className="rag-err">{error}</div>}

              {answer && (
                <div
                  className="rag-answer"
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdown(answer) + (phase === "streaming" ? '<span class="rag-caret"></span>' : ""),
                  }}
                />
              )}

              {sources.length > 0 && (
                <>
                  <div className="rag-srclabel">Sources</div>
                  {sources.map((s) => {
                    const pct = Math.max(6, Math.min(100, Math.round((s.score || 0) * 100)));
                    const inner = (
                      <>
                        <div className="rag-srctop">
                          <span className="rag-srcn">{s.n}</span>
                          <span className="rag-srcname">{s.name || s.rel}</span>
                        </div>
                        {s.rel && s.rel !== s.name && <div className="rag-srcpath">{s.rel}{s.root && s.root !== "cdn" ? ` · ${s.root}` : ""}</div>}
                        <div className="rag-bar"><i style={{ width: `${pct}%` }} /></div>
                      </>
                    );
                    return s.token ? (
                      <a key={s.n} className="rag-src" data-n={s.n} href={`/f/${s.token}`} target="_blank" rel="noreferrer">{inner}</a>
                    ) : (
                      <div key={s.n} className="rag-src" data-n={s.n}>{inner}</div>
                    );
                  })}
                </>
              )}

              {phase === "idle" && !answer && (
                <div className="rag-empty">
                  Ask a question and I&apos;ll answer from the documents and code on your server — and show you exactly which files the answer came from.
                  <div className="rag-ex">
                    {EXAMPLES.map((ex) => (
                      <button key={ex} className="rag-exbtn" onClick={() => { setQuery(ex); run(ex); }}>{ex}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="rag-foot">
              <span><kbd>⌘K</kbd> open</span>
              <span><kbd>Enter</kbd> ask</span>
              <span><kbd>Esc</kbd> close</span>
              <span style={{ marginLeft: "auto" }}>Runs on your server</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

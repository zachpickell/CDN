# Local RAG — "Ask your files"

Ask questions about your own documents and code, answered by a model running
entirely on falc. Nothing leaves the box. Search results and answers cite the
files they came from and link straight back into the file manager.

## How it fits together

```
 Browser (Ask panel, ⌘K)
        │  POST /api/rag/ask   (streamed answer + source citations)
        ▼
 Next.js route  ──embed query──▶  Ollama (nomic-embed-text)
        │                              ▲
        │  top-k vector search         │ embed each chunk
        ▼                              │
      Qdrant  ◀──upsert chunks── Indexer (scripts/rag-index.mjs, on a timer)
        │                              ▲
        └── answer generation ──▶ Ollama (qwen2.5:7b-instruct)  walks DATA_DIR/files
```

- **Embeddings:** `nomic-embed-text` — 768-dim, fast, tiny, great quality for
  the price. Runs happily on modest hardware.
- **Answers:** `qwen2.5:7b-instruct` — strong at following "use only this
  context" grounding without being heavy. Bump to `qwen2.5:14b-instruct` or a
  32B model later by changing `RAG_CHAT_MODEL` (no code changes).
- **Vector store:** self-hosted Qdrant in Docker.
- **Indexer:** incremental — tracks each file's mtime+size in
  `DATA_DIR/rag-index.json`, so re-runs only touch what changed and deleted
  files get their vectors purged. Safe to run on a timer.

## What gets indexed

- Every text/code file under `DATA_DIR/files` (the CDN store) — those cite back
  to their `/f/<token>` share link.
- PDFs, **if** `pdftotext` (poppler) is installed — otherwise they're skipped.
- Anything in `RAG_EXTRA_ROOTS` (extra code dirs not served by the CDN).

Binaries, images, video, and files over 8 MB are skipped. `.docx`/`.pptx`
aren't extracted yet (they need a zip+xml step — easy follow-up).

## Setup on falc

1. **Ollama** (if not already running) and pull the models:

   ```bash
   ollama pull nomic-embed-text
   ollama pull qwen2.5:7b-instruct
   ```

2. **Qdrant**:

   ```bash
   docker compose -f docker-compose.rag.yml up -d
   ```

3. **Config** — copy the example and fill it in:

   ```bash
   cp .env.local.example .env.local
   # set APP_PASSWORD, SESSION_SECRET, DATA_DIR (e.g. /mnt/storage),
   # and the OLLAMA_URL / QDRANT_URL if they aren't on localhost
   ```

   (Optional) index a code repo too:
   `RAG_EXTRA_ROOTS=/mnt/storage/code`

4. **PDF text** (optional but recommended):

   ```bash
   sudo apt install -y poppler-utils
   ```

5. **First index** — run it once by hand to check it works:

   ```bash
   node scripts/rag-index.mjs
   ```

6. **Rebuild + run the app** as usual (`npm run build && npm run start`), then
   open the site, hit **Ask** (bottom-right, or ⌘K), and ask something.

## Keep the index fresh (systemd timer)

`/etc/systemd/system/cdn-rag-index.service`:

```ini
[Unit]
Description=Index CDN files into Qdrant for RAG
After=network-online.target docker.service

[Service]
Type=oneshot
WorkingDirectory=/path/to/CDN
ExecStart=/usr/bin/node scripts/rag-index.mjs
# env comes from .env.local, which the script loads itself
```

`/etc/systemd/system/cdn-rag-index.timer`:

```ini
[Unit]
Description=Run the CDN RAG indexer periodically

[Timer]
OnBootSec=2min
OnUnitActiveSec=15min
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cdn-rag-index.timer
```

You can also trigger a run from the UI (the **Re-index** button in the Ask
panel) whenever you've just added files.

## Tuning knobs

- Chunk size/overlap: top of `lib/indexer.js` (`CHUNK_CHARS`, `OVERLAP_CHARS`).
- How many chunks feed the answer: the `k` in `/api/rag/ask` (default 6).
- Swap the embed model: change `RAG_EMBED_MODEL` **and** `RAG_EMBED_DIM` to
  match, then delete the collection (or change `RAG_COLLECTION`) and re-index —
  vector sizes can't be mixed in one collection.

## Files added

```
lib/rag.js                     Ollama + Qdrant client (no npm deps)
lib/indexer.js                 walk → extract → chunk → embed → upsert
app/api/rag/search/route.js    semantic search
app/api/rag/ask/route.js       grounded, streamed answer + citations
app/api/rag/reindex/route.js   trigger + status
app/ask.js                     the Ask panel (mounted from app/page.js)
scripts/rag-index.mjs          standalone indexer for cron/systemd
docker-compose.rag.yml         Qdrant
```

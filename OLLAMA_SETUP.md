# Prerequisites setup (falc) — Ollama, Qdrant, poppler

Everything the RAG feature needs that isn't already on falc. Run these **on
falc** (SSH in). You already have Node 22 and Docker (Pterodactyl uses it), so
the genuinely new pieces are **Ollama**, the **two models**, the **Qdrant
container**, and **poppler-utils** for PDF text.

> Before you start, know one thing: **is your file-manager app running directly
> on falc, or inside a Pterodactyl/Docker container?** It changes which URLs go
> in `.env.local`. Both cases are covered in step 5.

---

## 0. Quick RAM check

These models are small but not free:

- `nomic-embed-text` (embeddings): ~1 GB RAM
- `qwen2.5:7b-instruct` (answers): ~5–6 GB RAM while answering

```bash
free -h        # look at "available"
```

If falc has < 8 GB free, use `qwen2.5:3b-instruct` or `llama3.2:3b` for answers
instead (set `RAG_CHAT_MODEL` accordingly). No GPU is required — these run on
CPU fine, just slower. If falc *does* have an NVIDIA GPU, Ollama uses it
automatically once the drivers are installed.

---

## 1. Install Ollama

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

That installs Ollama and registers it as a systemd service that starts on boot.
Verify:

```bash
systemctl status ollama --no-pager
ollama --version
```

---

## 2. Make Ollama reachable (only if the app runs in a container)

By default Ollama listens on `127.0.0.1:11434` — reachable from processes **on
falc itself**, but NOT from inside a Docker/Pterodactyl container. If your app
runs in a container, bind Ollama to all interfaces:

```bash
sudo systemctl edit ollama
```

In the editor that opens, add:

```ini
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

Keep 11434 firewalled off from the outside world (UFW / Tailscale-only) — this
just exposes it to falc's Docker bridge, not the internet.

> If the app runs **directly on falc** (plain `npm run start`), skip this step;
> `127.0.0.1` is fine.

---

## 3. Pull the models

```bash
ollama pull nomic-embed-text
ollama pull qwen2.5:7b-instruct     # or qwen2.5:3b-instruct on tight RAM
```

Check they're there:

```bash
ollama list
```

Smoke-test each one:

```bash
# embeddings — should print a big JSON array
curl -s http://127.0.0.1:11434/api/embeddings \
  -d '{"model":"nomic-embed-text","prompt":"hello"}' | head -c 200; echo

# chat — should stream back a short reply
curl -s http://127.0.0.1:11434/api/chat \
  -d '{"model":"qwen2.5:7b-instruct","messages":[{"role":"user","content":"say hi in 3 words"}],"stream":false}'
echo
```

---

## 4. Start Qdrant (the vector store)

You already have Docker. From the app directory:

```bash
cd /path/to/CDN
docker compose -f docker-compose.rag.yml up -d
docker ps | grep qdrant
```

Verify it answers:

```bash
curl -s http://127.0.0.1:6333/collections    # -> {"result":{"collections":[]},...}
```

The compose file binds Qdrant to `127.0.0.1` only and persists data in a named
Docker volume, so it survives restarts and isn't exposed to the network.

> **App-in-a-container note:** the app reaches Qdrant by URL too. If both the
> app and Qdrant are containers on the same Docker network, use the service name
> (`http://qdrant:6333`). If the app is a container and Qdrant is on the host,
> use falc's Docker bridge IP (usually `http://172.17.0.1:6333`). If the app
> runs directly on falc, `http://127.0.0.1:6333` is correct.

---

## 5. Install poppler (PDF text extraction)

```bash
sudo apt update && sudo apt install -y poppler-utils
pdftotext -v      # prints a version if it worked
```

Without this, PDFs are simply skipped (no crash) — everything else still
indexes. Skip it if you don't care about PDFs.

---

## 6. Point the app at all of it

```bash
cd /path/to/CDN
cp .env.local.example .env.local
nano .env.local
```

Fill in based on where the app runs:

| Setting | App runs on falc directly | App runs in a container |
|---|---|---|
| `OLLAMA_URL` | `http://127.0.0.1:11434` | `http://172.17.0.1:11434` (bridge IP) |
| `QDRANT_URL` | `http://127.0.0.1:6333` | `http://172.17.0.1:6333` or `http://qdrant:6333` |
| `DATA_DIR` | `/mnt/storage` (your real store) | the container's mounted store path |

Also set `RAG_CHAT_MODEL` if you changed it, and keep
`RAG_EMBED_DIM=768` (matches `nomic-embed-text`).

---

## 7. First index + run

```bash
node scripts/rag-index.mjs      # builds the index; run once by hand first
npm install                     # if you haven't since pulling the new code
npm run build && npm run start
```

Open the site → **Ask** button (bottom-right, or ⌘K) → ask a question.

To keep the index fresh automatically, set up the systemd timer in
`RAG_SETUP.md` (step "Keep the index fresh").

---

## Troubleshooting

- **"Ollama chat failed / ECONNREFUSED"** → the app can't reach Ollama. You're
  almost certainly in the container case from step 2 — bind Ollama to `0.0.0.0`
  and use the bridge IP in `OLLAMA_URL`.
- **"Qdrant ... failed" on first ask** → Qdrant isn't up, or the URL is wrong
  for your container layout (step 4 note). `curl` it from *inside* the app's
  environment to confirm.
- **Answers are slow** → expected on CPU for a 7B model. Drop to a 3B chat
  model; embeddings stay fast regardless.
- **PDFs not showing up** → `pdftotext` missing (step 5), or the PDF is scanned
  images (needs OCR, not in scope yet).
- **Changed the embed model?** → you must also update `RAG_EMBED_DIM` to match
  and re-create the collection (delete it or change `RAG_COLLECTION`), because a
  collection is locked to one vector size. Then re-index.

## What this added to your system

| Piece | New? | What it's for |
|---|---|---|
| Ollama | **yes** | runs the embed + chat models locally |
| nomic-embed-text, qwen2.5 | **yes** | the actual models |
| Qdrant (Docker) | **yes** | stores + searches the vectors |
| poppler-utils | maybe | pulls text out of PDFs |
| Node 22 | already have it | runs the app + indexer |
| Docker | already have it (Pterodactyl) | runs Qdrant |

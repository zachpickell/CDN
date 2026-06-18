# Personal CDN

A tiny private file host built with Next.js. Log in with a single password, upload
files, and share each one with a secret link. Anyone who has the link can download
the file — anyone who doesn't, can't. There is no public file listing.

## How it works

- **Login** — one password (set in `.env.local`). A signed, HTTP-only session
  cookie keeps you logged in for 7 days. The dashboard and upload/list APIs are
  protected by middleware.
- **Storage** — uploaded files are written to `./storage/files` on disk, with
  metadata in `./storage/metadata.json`. Nothing leaves your machine/server.
- **Share links** — each upload gets an unguessable token (`/f/<token>`). That
  route is public on purpose so friends can download without an account, but the
  token is long and random so links can't be guessed or enumerated.

## Setup

Requires Node 18+ (Node 22 recommended).

```bash
# 1. Install dependencies
npm install

# 2. Create your env file
cp .env.local.example .env.local
```

Then edit `.env.local`:

```
APP_PASSWORD=your-strong-password
SESSION_SECRET=<paste a long random string>
```

Generate a good secret with:

```bash
openssl rand -hex 32
```

> A `.env.local` with a throwaway password (`testpass123`) was created so the app
> runs immediately. **Change both values before using this for real.**

## Run

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

Open http://localhost:3000, log in, and start uploading.

## Sharing a file

1. Drag a file onto the dashboard (or click to choose).
2. Hit **Copy link** on the file's row.
3. Send that link to a friend. They open it and the file downloads/opens —
   no login required.

Use **Delete** to remove a file; its share link stops working immediately.

## Project layout

```
app/
  layout.js              Root layout + global styles
  page.js                Dashboard (server component, auth-gated)
  dashboard.js           Dashboard UI (client: upload, list, copy, delete)
  login/page.js          Login page
  api/login/route.js     Verify password, set session cookie
  api/logout/route.js    Clear session cookie
  api/upload/route.js    Receive a file, store it, return its token
  api/files/route.js     List files (GET) / delete a file (DELETE)
  f/[token]/route.js     Public download by token
lib/
  auth.js                HMAC-signed session cookies + password check
  store.js               Local-disk file store + metadata
middleware.js            Gate the dashboard + protected APIs
storage/                 Created on first upload (git-ignored)
```

## Notes & limits

- Default max upload size is 100 MB (configurable in `next.config.mjs`).
- This is a single-user, single-password setup by design. To support multiple
  accounts you'd add a users table and swap the password check in `lib/auth.js`.
- Files are stored on local disk, so on platforms with ephemeral filesystems
  (e.g. some serverless hosts) uploads won't survive a redeploy. For that, point
  `store.js` at S3/R2 or a persistent volume. Set `DATA_DIR` to relocate storage.

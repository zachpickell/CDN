This is a website I made with claude ai to save files since I got tired of using google drive.

## Setup
 
1. Install dependencies:
```
   npm install
```
 
2. Create `.env.local` in the project root:
```
   APP_PASSWORD=your-login-password
   SESSION_SECRET=any-long-random-string
```
 
3. Start it:
```
   npm run dev
```
 
   Then open http://localhost:3000.
 
That's it — the `storage/` folder is created automatically on first upload.
 
## Running in production
 
```
npm run build
npm run start
```
 
## How it works
 
- Log in with `APP_PASSWORD`.
- Drag files in (or click) to upload. Large files upload in chunks.
- Each file gets a private link at `/f/<token>` that anyone with the link can open.
- Files and metadata live in `storage/` on disk (or `DATA_DIR` if set).

## The disk is the source of truth

`storage/files/` mirrors the website exactly: folders on the site are real
directories, and files keep their real names. That means you can mount
`storage/files/` as a drive on your desktop and manage everything from there —
anything you create, move, rename, or delete on the drive shows up on the site
after a page reload or the Refresh button (every listing rescans the disk).

Notes:

- Share tokens live in `metadata.json` (path → token). New files found on disk
  get a token automatically. Renaming or moving a file *through the site* keeps
  its token, so the link keeps working; renaming a file *on the drive* looks
  like delete + add, so it gets a new token.
- Dotfiles, `Thumbs.db`, `desktop.ini`, and partial copies (`.part`, `.tmp`,
  `.crdownload`) are ignored.
- Old installs (token-named blobs + virtual folders) are migrated automatically
  on first run: folders become real directories and blobs get their original
  names back. Existing share links keep working.

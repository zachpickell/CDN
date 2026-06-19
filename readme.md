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
- Files and metadata live in `storage/` on disk.

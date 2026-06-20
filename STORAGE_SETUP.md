# Moving uploads to the 1TB drive (Pterodactyl)

Your app stores files wherever the `DATA_DIR` environment variable points, falling
back to the app's local `storage/` folder when it's unset (see `lib/store.js`).
Inside Pterodactyl your app runs in a Docker container that can only see its own
volume, so the job is: get the new drive mounted **on the host**, expose it **into
the container**, then set `DATA_DIR` to that path.

You'll need root/SSH access to the host machine (not just the panel) for steps 1–4.

---

## Step 1 — Mount the drive on the host

SSH into the host and find the new disk:

```bash
lsblk -f
```

Identify the 1TB disk (e.g. `/dev/sdb`). If it's brand new and has no filesystem,
create one (this ERASES the disk — make sure it's the right one):

```bash
sudo mkfs.ext4 /dev/sdb1        # only if the disk/partition is empty/unformatted
```

Create a mount point and mount it:

```bash
sudo mkdir -p /mnt/cdn-storage
sudo mount /dev/sdb1 /mnt/cdn-storage
```

Make it mount automatically on every boot. Get the partition's UUID:

```bash
sudo blkid /dev/sdb1
```

Then add a line to `/etc/fstab` (replace the UUID with yours):

```
UUID=xxxx-xxxx  /mnt/cdn-storage  ext4  defaults  0  2
```

Test it without rebooting:

```bash
sudo umount /mnt/cdn-storage && sudo mount -a && df -h | grep cdn-storage
```

## Step 2 — Set ownership to match the container user

Pterodactyl runs container processes as a dedicated user (UID/GID is usually
`988:988`, but it can differ). Match the new folder to whatever your existing
volumes use so the app can write to it:

```bash
ls -lan /var/lib/pterodactyl/volumes        # note the numeric owner, e.g. 988 988
sudo chown -R 988:988 /mnt/cdn-storage      # use the numbers you just saw
```

## Step 3 — Allow the mount in the Wings config

Wings blocks mounting arbitrary host paths for security, so you must whitelist it.
Edit the node's config:

```bash
sudo nano /etc/pterodactyl/config.yml
```

Find (or add) the `allowed_mounts` list under the system section and add your path:

```yaml
allowed_mounts:
  - /mnt/cdn-storage
```

Restart Wings:

```bash
sudo systemctl restart wings
```

## Step 4 — Create the Mount in the panel (admin area)

In the Pterodactyl **admin** area (not the regular server view):

1. Go to **Mounts → Create New**.
2. Fill in:
   - **Name:** `cdn-storage`
   - **Source** (host path): `/mnt/cdn-storage`
   - **Target** (path inside the container): `/mnt/storage`
   - **Read Only:** OFF
   - **User Mountable:** ON
3. On the mount's page, attach it to the **Egg** your app uses and the **Node**
   the server runs on (both must be added or the mount won't be selectable).

## Step 5 — Enable the mount on your server

Go to your server in the normal panel view → **Mounts** tab → toggle `cdn-storage`
**on**. (Adding/removing a mount requires the server to be restarted, which the
next step covers.)

## Step 6 — Point the app at the mounted path

In your server's **File Manager**, open `.env.local` and add this line:

```
DATA_DIR=/mnt/storage
```

(Your existing `APP_PASSWORD` and `SESSION_SECRET` lines stay as they are.)

Then **Restart** the server from the panel. Next.js loads `.env.local` on startup,
and `lib/store.js` will now read/write under `/mnt/storage`.

## Step 7 — Verify

Upload a test file through the app, then on the host:

```bash
ls -la /mnt/cdn-storage/files
```

You should see the uploaded blob there, and `/mnt/cdn-storage/metadata.json`
should appear too. That confirms uploads are landing on the 1TB drive.

---

## Notes

- **Existing files:** anything already uploaded lives in the old `storage/` folder
  inside the container. To carry it over, copy the old `files/` contents and
  `metadata.json` into `/mnt/cdn-storage/` **before** the first restart with the new
  `DATA_DIR`, so the metadata and blobs stay together.
- **Permissions errors on upload** (e.g. `EACCES`) almost always mean Step 2's
  ownership doesn't match the container user — re-check `ls -lan` and `chown`.
- **Simpler alternative:** if you want *everything* for *all* servers on this node to
  live on the big drive (not just this app's uploads), you can instead move
  `/var/lib/pterodactyl/volumes` onto the drive (or change `system.data` in
  `config.yml` to a path on it) and skip the Mounts steps. The Mounts approach above
  is better when you only want this app's uploads on the new disk.

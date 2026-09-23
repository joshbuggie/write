# write

**Plain-markdown notes you own.** write is a calm, self-hosted writing app for your notes. It runs on your
own machine or server, and every note is an ordinary `.md` file in a folder you choose. There is no
database, no account and no lock-in: stop the app and your notes are still just files that you can
open in vim, Obsidian, iA Writer or anything else.

- A clean editor for rich text that saves plain Markdown: headings, lists, task lists, tables, code,
  links and images.
- Autosave with conflict detection. If a file changes on disk while you're writing, write notices it
  and asks before overwriting anything.
- Folders in a sidebar, and a library view on the phone. Works well as an iPhone Home Screen app.
- Download a single note, a folder, or everything as a `.zip`, from the app or with `curl`.
- An optional password, and light and dark mode that follow your system.

---

## Contents

- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Your data](#your-data)
- [Downloading and backups](#downloading-and-backups)
- [Security](#security)
- [iPhone and iPad](#iphone-and-ipad)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Upgrading](#upgrading)
- [FAQ and troubleshooting](#faq-and-troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## Quick start

Choose one. Each option gets you to <http://localhost:3000>. On first start write creates a `notebook`
folder with a short Welcome note.

### Option 1: Docker Compose (recommended)

You need Docker with the Compose plugin.

```bash
git clone <this-repo-url> write && cd write
mkdir -p data                 # your notes will live here, on the host
docker compose up -d
```

Open <http://localhost:3000>. Your notes are in `./data` as plain files.

To turn on the password, create a `.env` file next to `docker-compose.yml` and recreate the container:

```bash
echo 'WRITE_PASSWORD=choose-a-long-passphrase' > .env
docker compose up -d
```

> **Permission denied?** The container runs as uid `1000`. If `./data` belongs to another user, run
> `sudo chown -R 1000:1000 ./data`, or uncomment `user:` in `docker-compose.yml` and set it to the owner of
> `./data`.

### Option 2: `docker run`

```bash
docker build -t write .
mkdir -p data
docker run -d --name write --init --restart unless-stopped \
  -p 3000:3000 \
  -v "$PWD/data:/data" \
  -e WRITE_PASSWORD=choose-a-long-passphrase \
  write
```

If the project publishes images, you can skip the build: releases are pushed to
`ghcr.io/<owner>/write:<version>` and `:latest`, for `linux/amd64` and `linux/arm64`, so they run on a
Raspberry Pi too.

### Option 3: Bare metal (Node.js)

You need Node.js 24 (LTS). Anything from 20.9 runs the app, but 24 is what we test.

```bash
git clone <this-repo-url> write && cd write
npm ci
npm run build
WRITE_DATA_DIR="$HOME/Notes" WRITE_PASSWORD=choose-a-long-passphrase npm start
```

- Without `WRITE_DATA_DIR`, notes go to `./data`, relative to the directory you start the server in. An
  absolute path is safer.
- `npm start` listens on all interfaces at port 3000. Use `npm start -- -p 8080` for another port, or
  `npm start -- -H 127.0.0.1` to only accept connections from this machine.
- Instead of exporting `WRITE_DATA_DIR` and `WRITE_PASSWORD`, you can copy `.env.example` to `.env.local`
  and set them there. The port and bind address can't go in that file, because `npm start` picks them
  before it reads it. Use the `-p` and `-H` flags above.

<details>
<summary>Run it as a systemd service</summary>

```ini
# /etc/systemd/system/write.service
[Unit]
Description=write notes
After=network.target

[Service]
User=notes
WorkingDirectory=/opt/write
Environment=NODE_ENV=production
Environment=WRITE_DATA_DIR=/home/notes/Notes
Environment=WRITE_PASSWORD=choose-a-long-passphrase
ExecStart=/usr/bin/npm start -- -H 127.0.0.1
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Then run `sudo systemctl enable --now write`.

</details>

---

## Configuration

All settings are environment variables, read when the server starts.

| Variable           | Default                                                                 | What it does                                                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WRITE_DATA_DIR`   | `./data` on bare metal (relative to the working dir), `/data` in Docker | The folder that holds your notes. It may be a symlink, for example into a synced folder. A path inside `.next/` is refused, because builds wipe it.               |
| `WRITE_PASSWORD`   | unset: no sign-in                                                       | Turns on the sign-in page and a 30-day session cookie. Scripts can send `Authorization: Bearer <password>` instead. Changing the password signs out every device. |
| `PORT`             | `3000`                                                                  | The port to listen on. Set it in the real environment (shell, systemd, Docker), not in `.env.local`. With `npm start`, `-p <port>` also works.                    |
| `HOSTNAME`         | `0.0.0.0` in Docker                                                     | The address the Docker image's server binds to. `npm start` ignores it, even as a real environment variable: use `npm start -- -H <address>`.                     |
| `BUILD_STANDALONE` | unset (the Dockerfile sets `1`)                                         | Build-time only. Produces the self-contained server that the Docker image runs. You don't need it for `npm start`.                                                |

`GET /api/health` returns `200 {"ok":true}` when the data folder is usable, and `503` otherwise. It
never needs a password, so you can point uptime monitors at it. It does a real write test of the data
folder (a hidden `.write-health-*.tmp` file, removed at once) at most every 10 minutes, and only a
read-only permission check in between, so frequent checks don't wake your sync tools. The Docker image
uses it for its `HEALTHCHECK`.

---

## Your data

### Layout

```
data/                          ← WRITE_DATA_DIR
  notebook/                    ← a folder: any visible directory directly inside the data folder
    Welcome.md                 ← a note: any visible *.md file directly inside a folder
    Meeting notes.md
  Work/
    Q3 plan.md
  .trash/                      ← deleted notes and folders (hidden, never listed)
```

- **The filename is the title.** Renaming a note in write renames the file, and renaming the file outside
  write renames the note.
- **One level of folders.** Files at the top of the data folder, nested folders, hidden files
  (starting with `.`), symlinks and anything that isn't `.md` (lowercase) are ignored and never touched.
  The one exception: renaming or deleting a folder moves the whole directory, including those files.
- **Nothing else is stored.** No database, no index, no sidecar files, and nothing is added to your notes.
  Line endings (LF or CRLF) and a UTF-8 BOM are kept as they are in each file.
- **Names are portable.** New note and folder names can't contain `/ \ : * ? " < > |`, can't start or end
  with a dot, and can't be Windows device names like `CON`. Two names that differ only in case count as
  the same name. This keeps your folder safe to sync or unzip on macOS, Windows and Linux. Files that
  already exist with other names still open fine.
- **Deleting moves to `.trash`.** A deleted note goes to `.trash/<timestamp>-<hex>/<folder>/<name>.md`,
  and a deleted folder to `.trash/<timestamp>-<hex>/<folder>/`. The short random `<hex>` keeps two deletes
  in the same millisecond apart. Nothing is purged automatically: to restore something, move it back; to
  reclaim space, delete the old `.trash` entries. **Keep mine** in a conflict also puts the version it
  replaces into `.trash`, at `.trash/<timestamp>-<hex>/<folder>/<name>.md`.
- **Interrupted renames come back.** Changing only the case of a name (`plan` → `Plan`) takes two steps.
  If the server stops between them, the note or folder reappears as "Recovered note" or "Recovered folder"
  the next time write loads, so you can rename it back.
- **Empty new notes don't pile up.** An "Untitled" note that you create and then leave for another page in
  write without typing anything is removed for good, since it held nothing. Reloading the page keeps it.
- **Delete the last folder** and write recreates an empty `notebook`, so there's always somewhere to
  write.

### Importing notes

Open a folder's **⋯** menu in the sidebar and choose **Import .md files…**. You can select several
`.md`, `.markdown` or `.txt` files at once. Each becomes a note in that folder:

- The title comes from the filename, with characters that aren't allowed in names replaced by `-`.
- If a note with that name already exists, the import is saved as "Name 2", "Name 3" and so on. Nothing
  is overwritten.
- Files over 5 MB are skipped, and the summary tells you how many.

To bring in a lot of notes at once, you can also just copy `.md` files into a folder inside the data folder.
They show up the next time you focus the app.

### Editing with other apps

Point any editor, sync tool or version control at the data folder: vim, VS Code, Obsidian, iA Writer,
Syncthing, Dropbox, `git`. write has no file watcher, but it checks the file every time you open a note
or come back to the tab:

- If you haven't typed anything since the change, write loads the new version silently and says
  "Updated from disk".
- If you have unsaved edits, write doesn't overwrite the file. It shows a banner with three choices:
  **Keep mine**, **Use disk version**, or **Save mine as a copy**. Keep mine copies the version that was
  on disk to `.trash` before saving yours, so neither side's edits are lost.

Autosave also keeps a copy of unsaved edits in the browser, so a crash, a closed tab or a lost
connection doesn't lose your typing. The next time you open the note you get your changes back.

### How your Markdown is kept

write never rewrites a file just because you opened it. It saves only after you make a real edit. When it
saves, the editor writes standard Markdown, which can differ slightly from what you typed elsewhere:

| What's in your file                                                                                                                                                                                                                                                                                                                                                           | What happens                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#` headings, **bold**/_italic_/~~strike~~/`code`, links (with titles), blockquotes, `---`, nested and numbered lists (including the start number), nested task lists, fenced code with a language, images, and text like `&`, `<`, `snake_case`, `[[wiki links]]`, `[^1]`                                                                                                    | **Kept exactly.**                                                                                                                                                   |
| Tables (column padding), `_em_` → `*em*`, `* item` → `- item`, underlined (setext) headings → `#` headings, closing `##` on headings dropped, `~~~` and indented code → ` ``` ` fences, a `\` line break → two trailing spaces, a lone `~` → `\~`, bare URLs and `<autolinks>` → `[url](url)`, reference links → inline links, loose lists → tight lists, runs of blank lines | **Normalized** to the equivalent standard form. This only happens the first time you edit that note.                                                                |
| YAML (`---`) or TOML (`+++`) front matter at the top of the file                                                                                                                                                                                                                                                                                                              | **Kept byte for byte.** It's shown read-only as "Properties" above the note, and can be edited in Markdown mode.                                                    |
| Raw HTML, HTML comments, footnote definitions, math (`$…$`, `$$…$$`), link definitions nothing links to (bookmark lists, `[//]: #` comments), backslash escapes other apps rely on (`\#tag`, `\[\[x]]`, `\$5`)                                                                                                                                                                | The visual editor can't keep these, so the note **opens as Markdown source** instead, with a banner. Choose "Edit visually anyway" only if you're fine losing them. |

A few more rules:

- **Large notes** (over 256 KB, or with a single paragraph, list item, heading or table cell over 16 KB)
  always open in Markdown source mode, which stays fast. Long lists, tables and code blocks don't count, so
  they still open visually. Quotes or lists nested more than 32 levels deep also open as source.
- **Pasting Markdown** the visual editor can't fully keep (HTML, a linked badge, an unused link
  definition…) pastes it as plain text instead, with a message, so nothing is silently dropped. Markdown
  over 256 KB is also pasted as plain text, like a note that size opening in source mode.
- **Very large files** (over 5 MB) and **files that aren't valid UTF-8** open read-only, with a download
  button. write never modifies them.
- **Images** display when they point to a web URL. Uploading images isn't supported yet, and images with
  relative paths don't display.
- **Tabs inside list items** become spaces once the note is saved and reopened (the Markdown parser
  expands them there). Tabs in ordinary paragraphs, quotes and code are kept.
- You can switch any note between the visual editor and Markdown source from its **⋯** menu.

---

## Downloading and backups

- **One note:** the ⬇ button in the note header downloads the exact file on disk, byte for byte.
- **One folder:** the folder's **⋯** menu → **Download folder (.zip)**.
- **Everything:** **Download all (.zip)** at the bottom of the sidebar (or of the Notes screen on a phone)
  downloads `write-notes-YYYY-MM-DD.zip`, with one directory per folder. It includes empty folders, but
  not `.trash`.

Downloads save your latest edits first. If a download fails, for example because the note was renamed
outside write or you were signed out, write shows an error message and stays where you are.

### Scripted backups

The same zip is available to scripts. With a password set, send it as a Bearer token:

```bash
curl -fsS -H "Authorization: Bearer $WRITE_PASSWORD" \
  -o "notes-$(date +%F).zip" http://localhost:3000/api/download
```

For example, as a nightly cron job:

```cron
0 3 * * * curl -fsS -H "Authorization: Bearer YOUR_PASSWORD" -o /backups/notes-$(date +\%F).zip http://localhost:3000/api/download
```

Because your notes are plain files, you can also back up the data folder directly with restic, Time
Machine, `rsync` or `git`. That also captures `.trash`.

---

## Security

- **Auth is off by default.** Without `WRITE_PASSWORD`, anyone who can reach the port can read and edit
  your notes. That's only fine on `localhost` or a network you trust. Whenever the server is reachable by
  others, **set `WRITE_PASSWORD` and put TLS in front of it**, or keep it private with a VPN such as
  [Tailscale](https://tailscale.com).
- **Use HTTPS.** The simplest option is [Caddy](https://caddyserver.com), which gets certificates
  automatically:

  ```caddyfile
  notes.example.com {
  	reverse_proxy 127.0.0.1:3000
  }
  ```

  With nginx, allow note-sized bodies and forward the original host and scheme:

  ```nginx
  location / {
      proxy_pass http://127.0.0.1:3000;
      client_max_body_size 8m;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-Proto $scheme;
  }
  ```

  Behind a reverse proxy, publish the port on localhost only: `"127.0.0.1:3000:3000"` in
  `docker-compose.yml`, or `npm start -- -H 127.0.0.1`.

- **Cross-site requests are blocked** even without a password. Every change has to be a same-origin JSON
  request, which the browser checks with `Sec-Fetch-Site`, so a malicious web page can't write to a write
  server on your LAN.
- **Sign-in** uses an HTTP-only session cookie that lasts 30 days. Changing `WRITE_PASSWORD` signs out
  every device.
- **Wrong passwords lock sign-in for everyone, for a while.** After 10 wrong passwords within 15 minutes
  (at the sign-in page or in an `Authorization: Bearer` header), every password check is refused for
  15 minutes with `429 Too Many Requests` and a `Retry-After` header, even the right password. The sign-in
  page says "Too many sign-in attempts. Try again in N minutes." What that means for you:
  - **Devices that are already signed in keep working** during a lockout: a session cookie isn't a
    password check. Only new sign-ins and Bearer scripts have to wait. Restarting write lifts a lockout.
  - The limit is shared by all clients, not counted per IP address, because the client's address can be
    forged without a trusted proxy in front. The upside: guessing is capped at 10 tries per 15 minutes no
    matter how many machines an attacker uses. The downside: anyone who can reach the sign-in page can
    keep it locked by sending 10 wrong passwords every 15 minutes, which stops you from signing in on
    a new device (never from using one that is already signed in).
  - So **use a long, random password** (a password manager's 20+ characters, or five random words), and
    if write is reachable from the internet, **prefer keeping it private**: behind a VPN such as
    [Tailscale](https://tailscale.com), or behind a reverse proxy that does its own sign-in (forward auth
    such as Authelia, Authentik or Cloudflare Access). Then strangers can't reach the sign-in page at all.
    HTTP Basic auth works too, but is unreliable in iPhone Home Screen apps.
  - A script with a stale Bearer password keeps triggering the lockout, so update your scripts when you
    change the password.
- **Run one instance per data folder.** write serializes writes within one process. Two servers on the
  same folder could overwrite each other's saves.
- Hosting under a subpath (like `example.com/notes/`) isn't supported. Use a subdomain.

---

## iPhone and iPad

write is designed for the phone as well as the desktop:

- **Install it:** open write in Safari, tap **Share → Add to Home Screen**. It then opens full-screen like
  an app. If you use a password, sign in once inside the Home Screen app; it keeps its own cookies.
- On a phone, **Notes** is the library screen. Tap a note to open it and use **‹ Notes** (or swipe back)
  to return.
- While you type, the formatting toolbar sits right above the keyboard. The ⌄ button hides the keyboard.
- Downloads use Safari's download prompt, and the file lands in the Files app.

---

## Keyboard shortcuts

On Windows and Linux use Ctrl instead of ⌘, and Alt instead of ⌥.

| Keys            | Action                                  |
| --------------- | --------------------------------------- |
| ⌘S              | Save now (autosave is always on)        |
| ⌘⌥N             | New note in the current folder          |
| ⌘\\             | Show or hide the sidebar                |
| ⌘K              | Add or edit a link                      |
| ⌘-click         | Open a link                             |
| ⌘B / ⌘I         | Bold / italic                           |
| ⌘⇧S / ⌘E        | Strikethrough / inline code             |
| ⌘⌥1 … ⌘⌥6       | Heading 1–6                             |
| ⌘⇧8 / ⌘⇧7 / ⌘⇧9 | Bullet list / numbered list / task list |
| ⌘⇧B / ⌘⌥C       | Quote / code block                      |
| Tab / ⇧Tab      | Indent / outdent a list item            |
| ⌘Z / ⌘⇧Z        | Undo / redo                             |
| Esc             | Close a dialog or menu                  |

Markdown shortcuts also work as you type: `# ` for a heading, `- ` for a list, `1. ` for a numbered list,
`[ ] ` for a task, `> ` for a quote, ` ``` ` for a code block, `---` for a divider, and `**bold**`,
`*italic*`, `` `code` `` inline. Pasting Markdown text converts it to formatting.

---

## Upgrading

- **Docker Compose:** `git pull && docker compose up -d --build`. With a published image, use
  `docker compose pull && docker compose up -d` instead.
- **Bare metal:** `git pull && npm ci && npm run build`, then restart the server.

Your notes are never part of the build, so upgrading can't touch them. Still, it's worth taking a backup
first.

---

## FAQ and troubleshooting

**The downloaded zip has garbled names on my Mac.** The `unzip` command that ships with macOS doesn't
decode UTF-8 names correctly. Double-click the zip in Finder, or run `ditto -x -k notes.zip notes/`.

**I put a file in the data folder but it doesn't appear.** Notes must be `.md` files (lowercase extension)
**inside a folder**. Files at the top level, nested folders, hidden files and symlinks are ignored.

**"Cannot write to /data" in Docker.** The container runs as uid 1000 and can't write to your `./data`.
Run `sudo chown -R 1000:1000 ./data`, or set `user:` in `docker-compose.yml` to the owner of the folder.

**Why did a note open in Markdown source mode?** It contains something the visual editor can't keep (raw
HTML, footnotes, math, unused link definitions), or it's over 256 KB, has a paragraph over 16 KB, or nests quotes or lists more than 32 deep. See [How your Markdown is kept](#how-your-markdown-is-kept).

**Why is a note read-only?** It's over 5 MB or not valid UTF-8. write won't risk changing it; download it
or edit it with another app.

**Can I run two copies against the same folder?** No. Run one instance per data folder. Editing the files
with other apps at the same time is fine.

**Can I use my iCloud Drive or Dropbox folder?** Yes, on bare metal: set `WRITE_DATA_DIR` to a folder
inside it, or symlink it. write only writes the files you edit, and it never rewrites a file with identical
content, so sync tools stay quiet. The only other write is the health check's short-lived hidden
`.write-health-*.tmp` file, at most every 10 minutes.

**I forgot the password.** It's just the `WRITE_PASSWORD` environment variable. Set a new one and restart.

---

## Contributing

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers setup (`nvm use && npm ci && npm run
dev`), the architecture and the project rules. [docs/design-decisions.md](docs/design-decisions.md)
explains why the app works the way it does.

## License

[MIT](LICENSE)

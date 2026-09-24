# write

**Plain-markdown notes you own.** write is a calm, self-hosted writing app for your notes. It runs on your
own machine or server, and every note is an ordinary `.md` file in a folder you choose. There is no
database, no cloud account and no lock-in: stop the app and your notes are still just files that you can
open in vim, Obsidian, iA Writer or anything else.

- A clean editor for rich text that saves plain Markdown: headings, lists, task lists, tables, code,
  links and images.
- Autosave with conflict detection. If a file changes on disk while you're writing, write notices it
  and asks before overwriting anything.
- Folders in a sidebar, and a library view on the phone. Works well as an iPhone Home Screen app.
- Download a single note, a folder, or everything as a `.zip`, from the app or with `curl`.
- Password-protected access by default, and light and dark mode that follow your system.
- An optional AI assistant, off until you turn it on, that works with the model you choose: one on your
  own network such as Ollama, or a hosted API.

---

## Contents

- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Your data](#your-data)
- [Downloading and backups](#downloading-and-backups)
- [Security](#security)
- [iPhone and iPad](#iphone-and-ipad)
- [AI assistant (optional)](#ai-assistant-optional)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Upgrading](#upgrading)
- [FAQ and troubleshooting](#faq-and-troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## Quick start

Choose one. Each option gets you to <http://localhost:3000>. When you first open the notes, write creates
a `notebook` folder with a short Welcome note if your data folder is empty.

### Option 1: Docker Compose (recommended)

You need Docker with the Compose plugin.

```bash
git clone https://github.com/joshbuggie/write.git && cd write
mkdir -p data config          # your notes, and write's own settings, live here on the host
docker compose up -d
```

Open <http://localhost:3000> and create your account (see [First run](#first-run)). Your notes are in
`./data` as plain files. `./config` holds write's own files: your account, and settings such as the AI
assistant's connections.

> **Permission denied?** The container runs as uid `1000`. If `./data` or `./config` belongs to another
> user, run `sudo chown -R 1000:1000 ./data ./config`, or uncomment `user:` in `docker-compose.yml` and set
> it to the owner of those folders.

### Option 2: `docker run`

```bash
git clone https://github.com/joshbuggie/write.git && cd write
docker build -t write .
mkdir -p data config
docker run -d --name write --init --restart unless-stopped \
  -p 3000:3000 \
  -v "$PWD/data:/data" \
  -v "$PWD/config:/config" \
  write
```

The release workflow publishes version tags to `ghcr.io/joshbuggie/write:<version>` and stable releases
to `:latest`, for `linux/amd64` and `linux/arm64` (including 64-bit Raspberry Pi systems). Once an image
is published and its package is public, you can use it instead of building locally. Every commit on
`main` that passes CI is also published as `:main` (and `:sha-<short-commit>`).

### Option 3: Bare metal (Node.js)

You need Node.js 24 (LTS). Anything from 20.9 runs the app, but 24 is what we test.

```bash
git clone https://github.com/joshbuggie/write.git && cd write
npm ci
npm run build
WRITE_DATA_DIR="$HOME/Notes" npm start
```

- Without `WRITE_DATA_DIR`, notes go to `./data`, relative to the directory you start the server in. An
  absolute path is safer. The same goes for `WRITE_CONFIG_DIR` (your account and write's own settings,
  default `./config`).
- `npm start` listens on all interfaces at port 3000. Use `npm start -- -p 8080` for another port, or
  `npm start -- -H 127.0.0.1` to only accept connections from this machine.
- Instead of exporting `WRITE_DATA_DIR`, `WRITE_CONFIG_DIR` and `WRITE_AUTH`, you can copy
  `.env.example` to `.env.local` and set them there. The port and bind address can't go in that file,
  because `npm start` picks them before it reads it. Use the `-p` and `-H` flags above.

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
Environment=WRITE_CONFIG_DIR=/home/notes/.config/write
ExecStart=/usr/bin/npm start -- -H 127.0.0.1
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Then run `sudo systemctl enable --now write`.

</details>

### First run

The first time you open write, it asks you to create an account: a username and a password of at
least 8 characters. That account is the only way in, on every device. To change the password later, open
**Settings** → **Account** → **Change password**; your other devices are signed out. Scripts can use its password too
(see [Scripted backups](#scripted-backups)).

**Create the account right after the first start.** Until you do, anyone who can reach the server can
create it instead. If write will be reachable from the internet, finish setup on your own network (or on
`localhost`) before you open it up.

If you already protect write with a VPN, or with a reverse proxy that signs people in, you can turn
write's own sign-in off with `WRITE_AUTH=off`.

---

## Configuration

The server is configured with environment variables. Your account is saved in `account.json`, and the
settings you change in the app (today only the AI assistant's) in `settings.json`, both in
`WRITE_CONFIG_DIR`.

| Variable           | Default                                                                     | What it does                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WRITE_DATA_DIR`   | `./data` on bare metal (relative to the working dir), `/data` in Docker     | The folder that holds your notes. It may be a symlink, for example into a synced folder. A path inside `.next/` is refused, because builds wipe it.                                                                                                                                                                                                                               |
| `WRITE_CONFIG_DIR` | `./config` on bare metal (relative to the working dir), `/config` in Docker | Where write keeps your account (`account.json`) and its own settings (`settings.json`): the AI assistant's, API keys included. Keep it outside the data folder, so synced notes never carry your keys: write refuses a folder it can see is inside the data folder, symlinks followed, but two Docker mounts of the same host folder look separate, so keep those apart yourself. |
| `WRITE_AUTH`       | on                                                                          | Set to `off` to turn sign-in off, only when something in front of write already signs people in (a VPN, or a reverse proxy with its own sign-in). Any other value leaves sign-in on.                                                                                                                                                                                              |
| `PORT`             | `3000`                                                                      | The port to listen on. Set it in the real environment (shell, systemd, Docker), not in `.env.local`. With `npm start`, `-p <port>` also works.                                                                                                                                                                                                                                    |
| `HOSTNAME`         | `0.0.0.0` in Docker                                                         | The address the Docker image's server binds to. `npm start` ignores it, even as a real environment variable: use `npm start -- -H <address>`.                                                                                                                                                                                                                                     |
| `BUILD_STANDALONE` | unset (the Dockerfile sets `1`)                                             | Build-time only. Produces the self-contained server that the Docker image runs. You don't need it for `npm start`.                                                                                                                                                                                                                                                                |

`GET /api/health` returns `200 {"ok":true}` when the data folder is usable, and `503` otherwise. It
never needs a password, so you can point uptime monitors at it. It does a real write test of the data
folder (a hidden `.write-health-*.tmp` file, removed at once) normally at most every 10 minutes per server
process, with only a read-only permission check in between. Failed checks aren't cached. The Docker
image uses it for its `HEALTHCHECK`.

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
  A UTF-8 BOM and the line-ending style (LF or CRLF, based on the first line break) are preserved when
  saving. Mixed line endings normalize to that style. write's own settings live in
  a separate folder (`WRITE_CONFIG_DIR`), never in the data folder.
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

Autosave also keeps a copy of unsaved edits in browser storage, so they can be recovered after a crash,
a closed tab or a lost connection. Reopen the note in the same browser to recover that draft. This is
best effort: blocked, full or cleared browser storage can prevent recovery.

### How your Markdown is kept

write never rewrites a file just because you opened it. It saves only after you make a real edit. When it
saves, the editor writes standard Markdown, which can differ slightly from what you typed elsewhere:

| What's in your file                                                                                                                                                                                                                                                                                                                                                           | What happens                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#` headings, **bold**/_italic_/~~strike~~/`code`, links (with titles), blockquotes, `---`, nested and numbered lists (including the start number), nested task lists, fenced code with a language, images, and text like `&`, `<`, `snake_case`, `[[wiki links]]`, `[^1]`                                                                                                    | **Supported.** Formatting and text are kept; Markdown spelling can normalize as described below.                                                                    |
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

The same zip is available to scripts. Send your account's password as a Bearer token (with
`WRITE_AUTH=off`, leave the header out):

```bash
curl -fsS -H "Authorization: Bearer $NOTES_PASSWORD" \
  -o "notes-$(date +%F).zip" http://localhost:3000/api/download
```

For example, as a nightly cron job:

```cron
0 3 * * * curl -fsS -H "Authorization: Bearer YOUR_PASSWORD" -o /backups/notes-$(date +\%F).zip http://localhost:3000/api/download
```

Because your notes are plain files, you can also back up the data folder directly with restic, Time
Machine, `rsync` or `git`. That also captures `.trash`.

The config folder (`WRITE_CONFIG_DIR`) isn't in the zip. It holds your account (the password is hashed)
and the AI assistant's settings, with your API keys in plain text. Back it up too if you want to keep your connections, and protect it (and its
backups) like the keys themselves: don't put it in a synced or shared folder, or in `git`.

---

## Security

- **Sign-in is on by default.** The first visitor creates the account ([First run](#first-run)), so do that
  right after the first start, before anyone else can reach the server. Whenever the server is reachable
  by others, **put TLS in front of it**, or keep it private with a VPN such as
  [Tailscale](https://tailscale.com). With `WRITE_AUTH=off`, anyone who can reach the port can read and
  edit your notes: only use it when something in front of write already signs people in.
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

- **Cross-site requests are blocked** even without a password. Browser changes must be same-origin,
  and POST, PUT and PATCH requests must use JSON. The server checks the browser's `Sec-Fetch-Site`
  header, so a malicious web page can't write to a write server on your LAN.
- **Keep sign-in on before you turn on the AI assistant** on any server others can reach. With
  `WRITE_AUTH=off`, anyone who can reach write can use your saved connections (and your API credits), and
  can use **Test connection** to make the server send requests to addresses on your network, even while
  the assistant is off. API keys are stored on the server in plain text, in `settings.json` inside
  `WRITE_CONFIG_DIR`, readable only by the user write runs as. They never reach the browser, which sees
  at most a key's last four characters. See [AI assistant](#ai-assistant-optional).
- **Sign-in** uses an HTTP-only session cookie that lasts 30 days. Your password is stored as a salted
  scrypt hash in `account.json`, never in plain text. Resetting the account (below) signs out every
  device.
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

## AI assistant (optional)

write can ask a language model to rewrite, fix, shorten or continue your text, or to answer a question
about it. It's **off until you turn it on**. While it's off there's no AI button and no shortcut, and the
server refuses to send note text anywhere. You bring the model: one on your own network (Ollama, LM
Studio) or a hosted API (OpenAI, Anthropic, OpenRouter, or any server that speaks OpenAI's chat
completions API).

### Turning it on

1. Open **Settings** at the bottom of the sidebar (on a phone, at the end of the Notes screen) and switch
   on **AI assistant**.
2. Add a connection: pick a provider, then enter the server URL, the model and, for hosted APIs, an API
   key. **Test connection** checks the URL and the key, and lists the models the server offers.
3. Save. You can save several connections, for example a local model and a hosted one, and choose the
   default. With more than one, the prompt window has a menu to switch between them.

Settings also hold the shortcut, the **Instructions** sent with every request, and the **quick actions**
(one-click requests such as "Fix spelling & grammar"). You can edit all of them.

### Using it

- Press **⌘J** (Ctrl+J on Windows and Linux), click **✨** in the note header, or on a phone tap **✨** at
  the left of the formatting toolbar. A prompt window opens at the cursor (on a phone, above the keyboard).
- Pick a quick action, or type a request and press Enter.
- **What goes with it:** the selection, or the paragraph at the cursor when nothing is selected. On an
  empty line, no note text is sent. Every request includes the note's title. A selection that spans
  several paragraphs or list items grows to the whole blocks. Choose **Whole note** to send the whole note with one request, or make that the default in
  Settings.
- The reply streams into the window. **Stop** (or Esc) ends it. Your note doesn't change until you click
  **Replace** or **Insert below**, and one ⌘Z undoes either. Follow-ups refine the reply: they send the
  conversation so far.
- Replies go in like pasted Markdown. If the editor can't keep a reply's formatting, the window says so
  and the reply goes in as plain text. In a code block a reply goes in as is, and in a table cell as one
  line.
- It works in Markdown source mode too. There the window sits at the bottom of the screen, the text sent
  is the selection or the lines around the cursor up to the nearest blank lines, and replies go in as the
  Markdown they are.

### What gets sent, and where

- **What gets sent**, in the prompt window, shows the exact request before anything goes out: the
  connection, model and server it goes to, the instructions (the system prompt), the note text inside a
  `<note>` tag, and your request. The server adds only what the API needs to run it, such as streaming
  and, for Anthropic, the required reply length limit (`max_tokens`), never any other text.
- Requests go from the write server to the model server, never straight from your browser. So your API
  keys stay on the server, and a phone can use a model that runs on a computer on your network.
- Note text leaves write only when you run a request, and only to the connection you picked. What a hosted
  provider does with it is up to that provider's terms.
- API keys are saved on the write server, in plain text, in `settings.json` inside `WRITE_CONFIG_DIR`. The
  browser only ever sees a key's last four characters, or none for a key shorter than 12 characters. A
  saved key is only sent to the origin it was saved for: if you change a connection's scheme, host or
  port, enter the key again.

### Connection examples

- **Ollama on another computer:** `http://192.168.x.x:11434/v1`, no key. Ollama only listens on its own
  machine by default, so start it with `OLLAMA_HOST=0.0.0.0` to let write reach it over the network. The
  model is a name from `ollama list`, such as `llama3.1:8b`.
- **LM Studio:** `http://192.168.x.x:1234/v1`, no key. Start its server first, and let it serve on the
  local network if write runs on another machine.
- **OpenAI:** `https://api.openai.com/v1` and an API key.
- **Anthropic:** `https://api.anthropic.com` and an API key. write talks to Anthropic's Messages API.
- **OpenRouter:** `https://openrouter.ai/api/v1` and an API key. Use **Test connection** to choose a model
  from the models available to your account.
- **Any other OpenAI-compatible server** (llama.cpp's server, vLLM, LocalAI…): choose **Other** and enter
  its base URL, which usually ends in `/v1`.

**`localhost` means the machine write runs on**, not the device in your hand: `http://localhost:11434/v1`
works when Ollama runs on the same computer as write. In Docker, `localhost` is the container itself. Use
the host's LAN address, or `host.docker.internal` (built into Docker Desktop; on Linux, add
`extra_hosts: ["host.docker.internal:host-gateway"]` to the service in `docker-compose.yml`), and make sure
the model server listens on the network, not only on its own `localhost`.

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
| ⌘J              | Ask AI (when the AI assistant is on)    |
| Esc             | Close a dialog or menu                  |

Markdown shortcuts also work as you type: `# ` for a heading, `- ` for a list, `1. ` for a numbered list,
`[ ] ` for a task, `> ` for a quote, ` ``` ` for a code block, `---` for a divider, and `**bold**`,
`*italic*`, `` `code` `` inline. Pasting Markdown text converts it to formatting.

---

## Upgrading

- **Docker Compose:** `git pull && docker compose up -d --build`. With a published image, use
  `docker compose pull && docker compose up -d` instead.
- **`docker run`:** rebuild (`git pull && docker build -t write .`) or pull the new image, then
  `docker rm -f write` and start it again with the command from [Option 2](#option-2-docker-run).
- **Bare metal:** `git pull && npm ci && npm run build`, then restart the server.

**Upgrading from a version without the AI assistant (no `./config` folder yet)?** write now keeps its own
settings in a config folder, mounted at `/config`. Create it, owned by the container's user, before you
start the new version, or Docker creates it as root and saving settings fails:

```bash
mkdir -p config && sudo chown 1000:1000 config
docker compose up -d --build
```

With `docker run`, create the folder the same way and add `-v "$PWD/config:/config"` to your command.
Without it, the settings (API keys included) go to an anonymous volume and are lost the next time the
container is recreated.

The default `./data` and `./config` folders are excluded from the build. Keep custom data and config
folders outside the checkout so they cannot enter a Docker build context. Back up both folders before
upgrading.

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
content, so sync tools stay quiet. The health check also writes a short-lived hidden `.write-health-*.tmp`
file, normally at most every 10 minutes per server process; failed checks retry without that delay.

**The AI assistant can't reach my model server.** The write server makes the request, not your browser,
so `localhost` means the machine write runs on (in Docker, the container). Use the model server's LAN
address and make sure it listens on the network: see [Connection examples](#connection-examples). **Test
connection** in Settings names the server and what went wrong. If it says the server "asks for an API
key" right after you changed the URL, enter the key again: a saved key is only sent to the server it was
saved for.

**I forgot the password.** Changing it in Settings needs the current one, so instead delete `account.json` from the config folder (`./config` with Docker Compose),
then open write and create the account again. Your notes aren't touched, and every device is signed out.
Until you finish, anyone who can reach write could create the account, so do it right away.

---

## Contributing

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers setup (`nvm use && npm ci && npm run
dev`), the architecture and the project rules. [docs/design-decisions.md](docs/design-decisions.md)
explains why the app works the way it does.

## License

[MIT](LICENSE)

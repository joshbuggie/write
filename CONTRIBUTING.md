# Contributing to write

Thanks for helping. This guide gets a React developer from clone to a merged PR. It covers setup, how
the app fits together, the handful of rules that keep it reliable, and step-by-step recipes for the
most common changes.

- [Setup](#setup)
- [Everyday commands](#everyday-commands)
- [Architecture map](#architecture-map)
- [Markdown engine map](#markdown-engine-map)
- [Design decisions](docs/design-decisions.md) (separate file)
- [Rules](#rules)
- [Next.js 16 gotchas](#nextjs-16-gotchas)
- [Recipes](#recipes)
- [Testing](#testing)
- [Manual QA checklist](#manual-qa-checklist)
- [Pull requests and releases](#pull-requests-and-releases)

---

## Setup

You need Node.js 24 (see `.nvmrc`). The app itself runs on Node 20.9+, but the test runner needs 22.12+.

```bash
nvm use          # or install Node 24 some other way
npm ci
npm run dev      # http://localhost:3000
```

- **Your notes land in `./data`**, which is gitignored. Delete it to start fresh; the next page load
  recreates `notebook/Welcome.md`. Use `WRITE_DATA_DIR=/some/dir npm run dev` to try another folder.
- **Settings land in `./config/settings.json`** (the AI assistant's, API keys included), also gitignored and
  kept out of Docker builds. Delete it to reset them. `WRITE_CONFIG_DIR` picks another folder, which must
  be outside the data folder.
- **To try the AI assistant** without an account, run [Ollama](https://ollama.com) on the same machine
  (`ollama pull llama3.1:8b`), then in Settings add an Ollama connection with that model.
- **To try sign-in**, run `WRITE_PASSWORD=x npm run dev`.
- `npm run dev` also keeps the Next.js block in `AGENTS.md` up to date. Commit that change if it
  appears.

### Testing on an iPhone

Start the dev server on all interfaces, then open it in Safari on a phone on the same Wi-Fi, using your
computer's LAN address or its Bonjour name:

```bash
npm run dev -- -H 0.0.0.0

# then open http://<your-computer's-ip>:3000 on the phone. To find the address:
#   macOS: ipconfig getifaddr en0      (en0 is usually Wi-Fi)
#   Linux: ip -4 addr show             (skip Docker and VPN interfaces)
# On macOS, http://<name>.local:3000 works too (System Settings → General → Sharing shows the name).
```

**If the page shows but never comes alive** (the note body stays a gray skeleton, buttons do nothing),
the dev server is blocking the phone. Next.js refuses dev-only resources to hostnames it doesn't trust,
and Safari then never starts the page's JavaScript (Chrome is more forgiving, so it can look fine on a
desktop). `next.config.ts` trusts this computer's own IPv4 addresses and its `.local` name
(`devOrigins()`); for any other hostname, such as a tunnel, set `WRITE_DEV_ORIGINS` to a comma-separated
list (`WRITE_DEV_ORIGINS=my-tunnel.example.com,*.ngrok.app npm run dev`). The dev server's terminal logs
`Blocked cross-origin request … from "<host>"` with the hostname to add. Production (`npm start`) has no
such check. The Safari Web Inspector (Safari → Develop → your iPhone) shows the phone's console.

---

## Everyday commands

| Command                           | What it does                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| `npm run dev`                     | Dev server with fast refresh                                                            |
| `npm test` / `npm run test:watch` | Vitest (Node environment only, so no browser download)                                  |
| `npm run lint`                    | ESLint, including the architecture boundaries below. Zero warnings allowed.             |
| `npm run typecheck`               | `next typegen` (route types such as `PageProps<…>`) followed by `tsc --noEmit`          |
| `npm run format`                  | Prettier, which also sorts Tailwind classes                                             |
| `npm run check`                   | lint, typecheck, test and format check. **Run this before every PR.** CI runs the same. |
| `npm run test:ai-live`            | Opt-in live AI suite with real API keys (see Testing). Never runs in CI.                |
| `npm run build` / `npm start`     | Production build and server                                                             |

To build the Docker image locally, run `docker build -t write .`. It sets `BUILD_STANDALONE=1` itself.

---

## Architecture map

write is a small Next.js App Router app. There is no database: the filesystem **is** the data model.
This section shows _where_ things are. [docs/design-decisions.md](docs/design-decisions.md) explains _why_
they work the way they do, as numbered entries (D1, D2, …) that code comments link to.

```
Browser ──RSC render / router.refresh()──► app/notes/layout.tsx, pages ──► lib/server/loaders ──► lib/server/storage ──► fs
   ├──fetch JSON (lib/api-client)──► app/api/*/route.ts ──► lib/server/http.handle() (auth, CSRF, errors) ──► storage
   ├──fetch → blob (lib/download)──► app/api/download/route.ts ──► storage (bytes | zip)
   └──fetch → NDJSON (api.streamCompletion)──► app/api/ai/complete/route.ts ──► lib/server/ai ──► model server
src/proxy.ts: optional auth gate in front of everything except health/login/static.
```

- **Reads** happen in Server Components. Pages call loaders, which call storage. After a change, the
  client calls `router.refresh()` to get fresh props. There is no client-side store for the tree.
- **Writes and downloads** go through Route Handlers under `/api`. The client calls them with the typed
  `api` object in `lib/api-client.ts`; downloads go through `downloadFile` in `lib/download.ts` (used by
  `useDownload()` in `components/ui/download-link.tsx`), which throws the same `ApiError`. We don't use
  Server Actions. Autosave needs `keepalive`, aborts and retries, and a plain HTTP API can also be driven
  with `curl`.

### Where things live

| Path                                       | What it is                                                                                                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/types.ts`, `constants.ts`         | Shared domain types (`Note`, `Tree`, …) and limits. Imported everywhere.                                                                                         |
| `src/lib/names.ts`                         | Name rules for notes and folders (`validateName`, `nameKey`, `compareNames`). Shared by UI and server.                                                           |
| `src/lib/routes.ts`                        | **The only place URLs are built or parsed** (`noteHref`, `decodeSegment`, download links).                                                                       |
| `src/lib/api-contract.ts`, `api-client.ts` | The HTTP contract (request/response types, error codes) and the typed browser `fetch` wrapper.                                                                   |
| `src/lib/server/storage/`                  | **The only code that touches the filesystem.** Notes, folders, trash, zip export, atomic writes, the lock.                                                       |
| `src/lib/server/http.ts`, `validate.ts`    | `handle()` wraps every route with auth, CSRF checks and error mapping; hand-written body type guards.                                                            |
| `src/lib/server/auth.ts`, `src/proxy.ts`   | Optional password: HMAC session cookie, Bearer token, and the request gate.                                                                                      |
| `src/lib/server/loaders.ts`                | What Server Components call to read data (`loadTree`, `loadNote`, …).                                                                                            |
| `src/app/api/*/route.ts`                   | One route file per resource: `tree`, `folders`, `notes`, `download`, `health`, `auth`, `settings`, `ai/models`, `ai/complete`.                                   |
| `src/lib/markdown/`                        | Framework-free Markdown engine: Tiptap extensions, escaping, front matter, fidelity check, paste.                                                                |
| `src/lib/markdown/nodes/`                  | The schema's node overrides (`Write*`) and the inline serializer. See the [Markdown engine map](#markdown-engine-map).                                           |
| `src/lib/autosave.ts`, `drafts.ts`         | Framework-free autosave state machine, plus crash-safety drafts in `localStorage`.                                                                               |
| `src/components/note/`                     | The note screen: `NoteView` orchestrates the editor, autosave, title/rename and conflict banner.                                                                 |
| `src/components/editor/`                   | The visual (Tiptap) and source (textarea) editors, toolbar, link dialog, `editor.css`, and the snapshot a rename hands to the new editor (`editor-snapshot.ts`). |
| `src/components/shell/`, `sidebar/`        | App shell, `ShellProvider` context, sidebar and phone library.                                                                                                   |
| `src/components/ui/`                       | Small UI kit: `Button`, `IconButton`, `Dialog`, `Menu`, `Toast`, `TextField`, `DownloadLink`.                                                                    |
| `src/lib/ai/`                              | The AI assistant's framework-free parts, shared by UI and server: settings types and defaults, provider presets, the request builder (`buildMessages`).          |
| `src/lib/server/ai/`                       | Model adapters (`openReply`, `listModels`): streamed calls to OpenAI-compatible servers and the Anthropic Messages API over plain `fetch`.                       |
| `src/lib/server/storage/settings.ts`       | The settings file, `WRITE_CONFIG_DIR/settings.json`, and its key rules. API keys stay here; the browser gets a view with `keyHint`.                              |
| `src/components/ai/`                       | The prompt window: `AiProvider`, the ✨ button, the target, the streamed reply, and Replace/Insert (`apply-reply.ts`, `source-target.ts` in source mode).        |
| `src/components/settings/`                 | The Settings dialog and its AI assistant section: connections, shortcut, instructions, quick actions.                                                            |
| `src/app/globals.css`                      | Design tokens (colors for light and dark) exposed as Tailwind utilities.                                                                                         |

### Key ideas, in the order you'll meet them

1. **A note is a file.** `NoteRef = { folder, name }`, where `name` is the filename without `.md`. The
   title _is_ the filename, so renaming a note renames the file.
2. **Versions and conflicts.** The server computes `version` as a short sha256 of the bytes on disk.
   Every save sends the `baseVersion` it started from. If the file changed on disk in the meantime, the
   server answers `409 version_conflict` together with the current note, and the UI shows the conflict
   banner. The client never hashes anything.
3. **Never write on open.** When a note opens, the editor serializes it once. That result is the
   baseline, and autosave only saves when the content differs from it. Opening or clicking around never
   touches a file.
4. **Autosave** (`createAutosaver`) is a plain TypeScript state machine: `saved → dirty → saving → saved`,
   plus `offline`, `error` and `conflict`. It debounces for 750 ms, keeps at most one save in flight,
   retries with backoff and writes a `localStorage` draft before every save. `use-note-sync.ts` wires it
   to React.
5. **Fidelity.** Some Markdown can't survive the visual editor (raw HTML, footnotes, math). On open,
   `analyzeFidelity` compares the original with the round trip. Lossy notes open in source mode (a
   textarea) instead of silently dropping content. Front matter is split off before the editor sees the
   body and re-joined verbatim on save.
6. **Escaping.** Tiptap's default Markdown escaping would write `&amp;` and `\_` into people's files. We
   patch it per editor instance (`lib/markdown/escape.ts`). A test fails loudly if a Tiptap upgrade breaks
   the patch.

---

## Markdown engine map

The Markdown engine (`src/lib/markdown/`) turns a note file into an editor document and back. Its one
job is that **what you see in the editor is exactly what re-opens from the file**. Most of it lives in
`nodes/`, one file per concern, so each rule about what Markdown can store has a single home.

**The pipeline.** A file is split into front matter and body (`file-format.ts`). `analyzeFidelity`
decides whether the body can open visually (`fidelity.ts`). The body is parsed by the schema
(`extensions.ts`, built from `nodes/`). On save, `serializeBody` (`serialize.ts`) writes it back through
the escaping patch (`escape.ts`) and the node renderers below, and `composeFile` re-joins the front matter.

| File                                            | What it does                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extensions.ts`                                 | `createSchemaExtensions()` (the document schema: every node and mark), `createExtensions()` (editor-only extras) and the headless `createMarkdownManager()`.                                                                                                                                                                                                   |
| `serialize.ts`                                  | `serializeBody(editor)`, the only way to read Markdown from an editor.                                                                                                                                                                                                                                                                                         |
| `escape.ts`                                     | Escapes typed text only where it would otherwise parse as syntax, and patches Tiptap's own escaping per editor instance.                                                                                                                                                                                                                                       |
| `autolinks.ts`                                  | Where marked would link a bare URL or email (GFM autolink literals), so escaping leaves those URLs alone.                                                                                                                                                                                                                                                      |
| `file-format.ts`                                | Splits off front matter (kept verbatim) and applies the final-newline rule.                                                                                                                                                                                                                                                                                    |
| `fidelity.ts`                                   | Classifies a note as exact, normalized or lossy; lossy notes open in source mode. Re-exports the oversized check from `oversized.ts`.                                                                                                                                                                                                                          |
| `oversized.ts`, `oversized-lines.ts`            | The pre-parse check for notes and pastes (`hasOversizedParagraph`): one linear pass over the lines that bounds the longest inline run and guards nesting depth, erring toward source mode; `oversized-lines.ts` holds the line-level rules copied from marked (list items, fences, quotes, tables). `fidelity.ts` re-exports it.                               |
| `markdown-paste.ts`                             | Pasting Markdown text: parse it, or paste plain text when the editor would drop part of it.                                                                                                                                                                                                                                                                    |
| `write-paragraph.ts`                            | Paragraphs, including blank ones, written with the inline serializer.                                                                                                                                                                                                                                                                                          |
| `nodes/inline.ts`, `inline-render.ts`           | The inline serializer: text with its marks (bold, italic, strike, code, links) for paragraphs, headings and table cells. Where Markdown can't place a delimiter it moves or gives up a mark, never writes HTML. `inline-render.ts` renders and settles the delimiters; `inline.ts` picks the style, writes a paragraph in independent parts and reads it back. |
| `nodes/inline-atoms.ts`, `inline-syntax.ts`     | Helpers for it: inline content as one "atom" per character, code spans, link destinations and bracket escaping, and the safety net (`fallBack`) that unlinks, escapes or drops emphasis when targeted fixes run out.                                                                                                                                           |
| `nodes/flanking.ts`, `read-back.ts`             | Self-checks: CommonMark's delimiter rules, and re-parsing the output with marked to confirm it reads back as the same marks and as exactly one paragraph or heading.                                                                                                                                                                                           |
| `nodes/heading.ts`, `image.ts`, `code-block.ts` | Headings (single line, escaped closing `#`s), images, and code fences that outlast any backtick run inside.                                                                                                                                                                                                                                                    |
| `nodes/lists.ts`, `list-item.ts`, `tasks.ts`    | Bullet, numbered and task lists: parsing marked's list tokens, and blank-line rules inside items.                                                                                                                                                                                                                                                              |
| `nodes/containers.ts`                           | Document, blockquote and table nodes; drops blank paragraphs Markdown can't keep at the end of a container.                                                                                                                                                                                                                                                    |
| `nodes/table-cells.ts`, `table-markdown.ts`     | Table cells hold one line of inline text (pasted or dropped blocks are flattened); GFM table output.                                                                                                                                                                                                                                                           |
| `nodes/hard-break.ts`, `horizontal-rule.ts`     | Line breaks, refused in headings, table cells and on a task's checkbox line; dividers, refused in table cells.                                                                                                                                                                                                                                                 |
| `nodes/enter-over-selection.ts`                 | Enter over a selection that spans blocks deletes it first, then splits at the caret.                                                                                                                                                                                                                                                                           |
| `nodes/changed-blocks.ts`                       | Finds the top-level blocks a transaction touched, for the clean-up plugins above.                                                                                                                                                                                                                                                                              |

**The rule for any change here**, however small:

1. Add or update fixtures in `src/lib/markdown/__fixtures__/`: `<case>.md`, plus `<case>.expected.md` if
   the output is normalized. A note that must open in source mode goes in `__fixtures__/fidelity/` as
   `<reason>.<case>.md`.
2. The round-trip fuzz test must pass, including a deeper local run:
   `FUZZ_SEEDS=5000 FUZZ_STEPS=80 npx vitest run src/lib/markdown/roundtrip-fuzz.test.ts`.
3. `npx vitest run src/lib/markdown` must pass. Read every fixture diff: it shows exactly what would change
   in people's files. If a normalization changes, update the table in README "How your Markdown is kept".

---

## Rules

These keep the app safe with other people's files. Most are enforced by lint or tests.

1. **Only `src/lib/server/storage/` touches the filesystem.** ESLint blocks `fs` imports anywhere else, and
   blocks `@/lib/server/*` imports from client-reachable code (`src/components`, `src/lib` outside
   `server`).
2. **URLs are built only in `src/lib/routes.ts`.** Page `params` arrive still percent-encoded in Next 16.3,
   so pages decode them **exactly once** with `noteRefFromParams` / `decodeSegment`. Route Handler params
   arrive decoded, and they are **never** used for names: API names travel in the query string or the
   JSON body.
3. **Mutations go through `/api`, wrapped in `handle()`.** That gives you auth, CSRF protection
   (`Sec-Fetch-Site` plus JSON-only bodies) and consistent `ApiErrorBody` errors for free. No Server
   Actions. The browser calls them through `api` in `src/lib/api-client.ts`; downloads use `useDownload()`
   (`src/components/ui/download-link.tsx`), which calls `downloadFile` in `src/lib/download.ts`.
4. **Read Markdown with `serializeBody(editor)`, never `editor.getMarkdown()`.** Only `serializeBody`
   applies our escaping and final newline rules.
5. **Every Markdown change needs round-trip fixtures** in `src/lib/markdown/__fixtures__/` and a passing
   round-trip fuzz test (see the [Markdown engine map](#markdown-engine-map)).
6. **Colors come from the design tokens only**: `bg-canvas`, `text-muted`, `border-line`, `bg-accent` and
   the others in `globals.css`. No hex values and no Tailwind palette colors (`gray-500`) in components.
   That's what makes dark mode work.
7. **Keep files under about 200 lines.** Split by responsibility, not by layer. Give each export a
   one-line JSDoc that explains _why_ it exists.
8. **No new dependency without an issue first.** We deliberately have no state library, schema library or
   UI framework. Native `<dialog>`, a one-line `cn()` and hand-written type guards cover it.

Also: no `console.log` in committed code (`console.error` for real server errors is fine), and never
`100vh` (use `dvh`).

---

## Next.js 16 gotchas

This project uses Next.js 16, which differs from older tutorials and from most AI training data. When in
doubt, read the docs that ship with the installed version in `node_modules/next/dist/docs/`.

- **`src/proxy.ts` replaces `middleware.ts`.** It exports `proxy` and runs on the Node runtime. Its
  config can't set `runtime`.
- **`params` and `searchParams` are Promises.** `await` them. Page params arrive percent-encoded, so decode
  them with `decodeSegment` (see rule 2).
- **`connection()` from `next/server`** marks a render as dynamic. Every loader calls it before touching
  the filesystem, so nothing gets frozen into the build as static HTML.
- **`/* turbopackIgnore: true */`** is on the `path.resolve` of the data and config dirs in
  `storage/config.ts`. Without it, Turbopack's file tracing tries to include the whole project in the
  build.
- **`next typegen`** generates the global `PageProps<"/route">`, `LayoutProps` and `RouteContext`
  types. `npm run typecheck` runs it first. If `tsc` complains that those types are missing, run
  `npx next typegen`.
- **`next build` doesn't lint** (and `next lint` no longer exists). Use `npm run lint`, or
  `npm run check`.
- **`cacheComponents` stays off.** With it on, hidden routes stay mounted, and so do their editors and
  autosave timers.
- **Standalone output only in Docker.** `output: "standalone"` is enabled only when `BUILD_STANDALONE=1`,
  because the standalone server changes into `.next/standalone`, and a relative `./data` or `./config`
  would then land inside the build output.

---

## Recipes

### Add a toolbar button

All formatting actions come from one list, `src/components/editor/toolbar-items.ts`. The desktop and
phone toolbars both render from it.

1. Pick an icon from `lucide-react` (named import).
2. Add an entry shaped like the existing ones. For example, a Heading 4 button:

   ```ts
   {
     id: "h4",
     label: "Heading 4",
     icon: Heading4,
     shortcut: "⌘⌥4",                                  // shown in the tooltip only
     group: "block",                                   // reuse an existing group; groups get dividers
     isActive: (editor) => editor.isActive("heading", { level: 4 }),
     run: (editor) => editor.chain().focus().toggleHeading({ level: 4 }).run(),
   },
   ```

3. If the command needs a Tiptap extension the editor doesn't load yet, follow the next recipe first.
4. Check both toolbars: desktop (sticky under the header) and phone (docked above the keyboard, 44×44
   targets). The buttons keep editor focus with `onPointerDown={(e) => e.preventDefault()}`, so the
   keyboard stays open.

### Add a Markdown extension

1. Add it to `createSchemaExtensions()` in `src/lib/markdown/extensions.ts`. That list is the document
   schema, shared by the editor and by the headless `createMarkdownManager()` that the fixture tests use.
   Don't add syntax to `createExtensions()`: it only adds editor-only behavior (placeholder, paste, the
   Markdown plugin itself), so the fixture tests would never see your extension. Use only packages that
   are already installed (rule 8). The extension must define `parseMarkdown` and `renderMarkdown`, or its
   content is lost on save.
2. Add fixtures to `src/lib/markdown/__fixtures__/`: `<case>.md` as input and, if the output is
   normalized, `<case>.expected.md`. `roundtrip.test.ts` picks them up automatically and checks the exact
   output, idempotence, the real editor's `serializeBody`, and the fidelity classification. Run
   `npx vitest run src/lib/markdown`.
3. If the syntax used to be "lossy", update the detectors in `src/lib/markdown/fidelity.ts` so those notes
   stop opening in source mode.
4. Style it in `src/components/editor/editor.css` using token variables only (`var(--line)`,
   `var(--muted)`, …).
5. Optionally add a toolbar button (recipe above). Update the table in README "How your Markdown is kept".

### Add an API endpoint

1. **Contract:** add request/response types to `src/lib/api-contract.ts`, and the path to `API` if it's a
   new resource.
2. **Storage:** if it needs the filesystem, add a function in the right `src/lib/server/storage/*.ts`
   module and export it from `storage/index.ts`. Mutations run inside `withWriteLock`, write with
   `atomicWrite`, and throw `StorageError` with a precise code.
3. **Route:** add a guard to `src/lib/server/validate.ts`, then the handler, which is only the happy path:

   ```ts
   // src/app/api/folders/route.ts
   export const POST = handle(async (req) => {
     const { name } = await readJson(req, isCreateFolderRequest); // 415/413/400 handled for you
     const body: FolderResponse = { folder: await createFolder(name) };
     return json(body, 201);
   });
   ```

   Names come from `new URL(req.url).searchParams` (`requireParam`) or the body, never from route params.

4. **Client:** add a method to `api` in `src/lib/api-client.ts`, then call it from the UI followed by
   `router.refresh()`.
5. **Tests:** add cases to `src/app/api/api.test.ts`. They call the exported handler directly with
   `new Request(url, init)` inside `withTempDataDir`.
6. **Auth:** nothing to do. `handle()` and the proxy already require a session, unless you pass
   `{ public: true }`, which you almost never should.

---

## Testing

- **Vitest, Node environment only** (`vitest.config.mts`). Tests live next to the code as `*.test.ts`.
- **Server tests** wrap each test in `withTempDataDir()` (`src/lib/server/storage/test-utils.ts`), which
  creates fresh temp dirs, points `WRITE_DATA_DIR` and `WRITE_CONFIG_DIR` at them and removes them
  afterwards. They never touch `./data` or `./config`.
- **AI tests** mock `fetch` with canned model responses and streams, so they never call a real model and
  need no key.
- **Live AI suite (opt-in, never in CI).** `src/ai-live/*.live.ts` calls the real Anthropic, OpenAI and
  OpenRouter APIs through the adapters, the `/api` routes and a headless editor, to catch what canned
  answers can't: changed error wording, a public models list, a model echoing the `<note>` tag. Put keys
  in `.env.ai-live` (gitignored; any provider left blank is skipped) and run `npm run test:ai-live`. It
  uses cheap models by default (override with `AI_LIVE_<PROVIDER>_MODEL`), and a full run costs a few
  cents. `npm test` never picks up `*.live.ts`, and its config (`vitest.ai-live.config.mts`) refuses to
  run when `CI` is set. The verbose output shows every reply, which is also a quick way to judge a
  change to the default Instructions.
- **Markdown tests** are driven by fixtures. When you change escaping or an extension, read the fixture
  diffs carefully: they show exactly what would change in people's files.
- **Round-trip fuzz** (`src/lib/markdown/roundtrip-fuzz.test.ts`) builds seeded documents with real
  editor commands and key presses and checks that each re-opens unchanged. The default run is quick; run
  it deeper locally after serializer changes:
  `FUZZ_SEEDS=5000 FUZZ_STEPS=80 npx vitest run src/lib/markdown/roundtrip-fuzz.test.ts`.
- **Autosave tests** inject fake timers and a fake `save()`. There's no DOM.
- UI is verified manually (below). Browser end-to-end tests are planned for later.

## Manual QA checklist

Run through whatever your change touches, at desktop width and at 390×844 (iPhone), in light and dark
mode.

- [ ] **iPhone:** the toolbar docks above the keyboard and ⌄ hides it; nothing hides under the notch or
      home indicator; focusing an input doesn't zoom the page; the library → note → back flow works.
- [ ] **Rename:** commit with Enter and on blur; Escape reverts; an invalid name shows an inline error; a
      taken name shows `A note named "X" already exists in <folder>.`; the URL updates.
- [ ] **Conflict:** open a note, edit the same file in vim and save it. Refocus the tab: a clean note shows
      "Updated from disk"; a note with unsaved edits shows the conflict banner, and Keep mine, Use disk
      version and Save mine as a copy all work. After Keep mine, the vim version is in `.trash`.
- [ ] **Empty new note:** click New note, then open another note without typing: the empty `Untitled`
      file is gone. Click New note and reload instead: it's still there.
- [ ] **Offline:** turn off the network (DevTools → Network → Offline), type, and check the status says
      "Offline · kept on this device". Reload: the draft is restored. Go back online and it saves.
- [ ] **No write on open:** open and close a note without typing, and check that the file's mtime
      (`ls -l --time-style=full-iso`, or `stat` on macOS) is unchanged.
- [ ] **Downloads:** the note ⬇ gives the exact bytes (`cmp` it with the file on disk); folder and
      "Download all" zips unzip with `ditto -x -k`; downloading right after typing includes the latest
      edit. Rename the file on disk, then click ⬇: an error toast appears and the app stays put.
- [ ] **Front matter:** edit a note with YAML front matter, then `diff` it: the front matter is untouched.
- [ ] **Auth** (if touched): with `WRITE_PASSWORD=x`, pages redirect to `/login`, the API returns 401, and
      `curl -H "Authorization: Bearer x" localhost:3000/api/tree` works. After 10 wrong passwords (on
      `/login` or as a Bearer token) the next attempt gets `429` with `Retry-After`, `/login` shows "Too
      many sign-in attempts. Try again in 15 minutes.", and an already signed-in tab keeps working.
      Restart the server to lift the lockout. `/login?next=%2F.%2F%2Fexample.com` must land on `/`, not
      example.com.
- [ ] **AI assistant** (if touched): switched off, it leaves no trace: no ✨ in the header or the phone
      toolbar, ⌘J isn't caught (the browser's own shortcut runs), the AI section of Settings shows only its
      switch, and `POST /api/ai/complete` answers `409 ai_disabled`. Switched on with a real model (Ollama
      is enough): the note doesn't change until Replace or Insert, and one ⌘Z undoes each; Stop ends the
      reply at once and the model server stops generating (check its log); "What gets sent" matches what
      the model server receives. On the iPhone the prompt window docks above the keyboard, the text it's
      about scrolls up above it, and the keyboard stays up when ✨ in the toolbar opens it.

---

## Pull requests and releases

- Keep PRs small and focused. Describe what changed for users, and include screenshots (desktop and
  phone) for UI changes.
- `npm run check` must pass. CI also builds the app and the Docker image, and fails if anything from
  `./data` or `./config` ends up in the build output.
- New dependencies need an issue first (rule 8).
- **Releases:** pushing a tag like `v1.2.3` runs `.github/workflows/release.yml`. It builds the Docker
  image for `linux/amd64` and `linux/arm64` and pushes `ghcr.io/<owner>/<repo>:1.2.3` and `:latest`.

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).

# Design decisions

Why write works the way it does. Each entry records a decision, the reason for it, and where it lives in
the code. Read the entries that touch your change before you start, because most of them protect people's
files.

- **Citing an entry:** code comments link to entries by number, for example
  `docs/design-decisions.md#d8`. Numbers are stable. Never renumber. If a decision is replaced, mark the old
  entry "Superseded by Dn" and add a new entry at the end.
- **The code wins.** If this file and the code disagree, the code is right and this file is out of date.
  When you change a decision, update its entry in the same PR.

**Contents**

- Architecture: [D1](#d1) loaders and route handlers · [D2](#d2) names in queries · [D3](#d3) `handle()`
  and errors · [D4](#d4) few dependencies
- Storage: [D5](#d5) a note is a file · [D6](#d6) names · [D7](#d7) atomic writes and the lock ·
  [D8](#d8) versions and conditional saves · [D9](#d9) never write on open · [D10](#d10) trash ·
  [D11](#d11) empty Untitled notes
- HTTP and auth: [D12](#d12) password · [D13](#d13) proxy · [D14](#d14) CSRF
- Editor: [D15](#d15) escaping · [D16](#d16) fidelity and source mode · [D17](#d17) front matter ·
  [D18](#d18) opening a note · [D19](#d19) autosave · [D20](#d20) conflicts · [D21](#d21) rename ·
  [D22](#d22) paste and links
- Files in and out: [D23](#d23) downloads · [D24](#d24) import
- UI: [D25](#d25) responsive layout · [D26](#d26) tokens and theme
- Self-hosting: [D27](#d27) build output and health · [D28](#d28) configuration

---

<a id="d1"></a>

## D1. Reads via RSC loaders, writes via route handlers

- **Reads:** pages and layouts are Server Components that call `src/lib/server/loaders.ts`, which calls
  storage. After a mutation, and when the tab regains focus (at most every 5 s), the client calls
  `router.refresh()`. There is no client-side store for the tree or the note, so there's only one source of
  truth.
- **Writes and downloads** go through Route Handlers under `src/app/api/`, called from the browser through
  `api` in `src/lib/api-client.ts`. **No Server Actions.** Autosave needs `fetch(…, { keepalive: true })`,
  aborts and retries. Server Actions run one at a time and break across deploys. A plain HTTP API also
  works with `curl`.
- **Every loader calls `connection()`** before it touches the filesystem, so nothing is frozen into the
  build as static HTML. **`cacheComponents` stays off**, because with it on, hidden routes stay mounted
  and so do their editors and autosave timers.

<a id="d2"></a>

## D2. Names travel in the query string or JSON body, never in API paths

- API calls carry note and folder names in the query string (GET, DELETE) or the JSON body (POST, PUT,
  PATCH): `DELETE /api/notes?folder=Work&name=Q3%20plan`. Route Handler params arrive already decoded
  (`%2F` becomes `/`), so they are never used for names. `URLSearchParams` is unambiguous and matches
  `curl`.
- Page URLs are `/notes/<folder>/<note>`, where the note segment is the filename without `.md`. The
  `/notes/` prefix means a folder called `api` or `login` can't collide with an app route. Page params
  arrive **still percent-encoded**, so pages decode them exactly once with `noteRefFromParams` /
  `decodeSegment`.
- All URLs are built and parsed in `src/lib/routes.ts` and nowhere else.

<a id="d3"></a>

## D3. One wrapper for every route, and errors written for people

- Every route exports its handlers as `handle(async (req) => …)` from `src/lib/server/http.ts`. `handle()`
  checks auth ([D12](#d12)), then CSRF ([D14](#d14)), runs the handler, and maps any thrown error to a
  response. Handlers contain only the happy path.
- Errors have one JSON shape, `{ error: { code, message } }` (`ApiErrorBody` in `src/lib/api-contract.ts`).
  `StorageError` and `HttpError` messages are **written to be shown to the user as-is**, so the UI never
  rewords them. Unknown errors become a generic `500` and are logged with `console.error`.
- The autosaver (`stateForError` in `src/lib/autosave.ts`) turns error codes into save states:

  | Code                                                       | Save state                                                    |
  | ---------------------------------------------------------- | ------------------------------------------------------------- |
  | `version_conflict`                                         | Conflict banner with the disk version ([D20](#d20))           |
  | `not_found`                                                | Conflict banner, "deleted" variant                            |
  | network failure                                            | "Offline · kept on this device" when offline, otherwise retry |
  | `storage_unavailable`, `internal`                          | Error, retried with backoff                                   |
  | `unauthorized`                                             | "Signed out". No retry; the edits stay in the draft.          |
  | anything else (`too_large`, `read_only`, `bad_request`, …) | Error with the server's message, no retry                     |

- Request bodies are checked by hand-written type guards in `src/lib/server/validate.ts`
  ([D4](#d4)).

<a id="d4"></a>

## D4. Few dependencies, and no browser in tests

- There is no schema library, state library, UI framework, `clsx` or `server-only`. Type guards are
  written by hand, `cn()` is one line, and dialogs use the native `<dialog>`. Each dependency is something
  a contributor has to learn and keep up to date. New dependencies need an issue first.
- Tiptap packages are pinned to exact versions, because the escaping patch ([D15](#d15)) relies on Tiptap
  internals.
- The app uses system font stacks rather than `next/font/google`, so builds work offline and the app
  looks native on an iPhone.
- Tests run in Vitest's Node environment only, so contributors don't have to download a browser. The UI
  is checked by hand (see the manual QA checklist in `CONTRIBUTING.md`).

---

<a id="d5"></a>

## D5. A note is a file

- A note is a visible `*.md` file (lowercase extension) directly inside a visible folder, directly inside
  `WRITE_DATA_DIR`. There is one level of folders. **The filename is the title**, so renaming a note
  renames its file.
- Everything else is ignored and never touched: hidden entries, symlinks, other extensions, `.md` files
  at the top level, nested directories, and names that aren't valid UTF-8. The one exception is that
  renaming or deleting a folder moves the whole directory, including those files.
- There is no database, index, sidecar file or metadata inside notes. If you stop the app, your notes are
  still just files.
- Paths are built in `src/lib/server/storage/paths.ts`, which checks that every path stays inside the data
  folder. Lookups fall back to a Unicode-normalized (NFC) match, so names written as NFD by older macOS
  file systems or rsync still open.

<a id="d6"></a>

## D6. Names are rejected, not sanitized

- New note and folder names must pass `validateName` in `src/lib/names.ts`: no `/ \ : * ? " < > |`, no
  control characters, no leading or trailing dot, no Windows device names, at most 200 UTF-8 bytes. The
  title must always equal the filename, and exports must unzip on macOS, Windows and Linux, so write
  rejects a bad name instead of silently changing it. Existing files with other names still open.
- Two names that differ only in case or Unicode normalization count as the same (`nameKey`: NFC plus
  lowercase) on every OS, so a data folder stays portable between case-sensitive and case-insensitive
  file systems.
- A new note gets a free name automatically (`Untitled 2`). A rename, move or new folder that collides
  fails with `name_taken`. A case-only rename goes through a temporary hidden name.
- Folders and notes sort by name with natural, case-insensitive ordering (`compareNames`), so the list
  doesn't jump while you type and matches Finder.

<a id="d7"></a>

## D7. Atomic writes behind one lock, and one process per data folder

- `atomicWrite` writes a hidden temp file (`.write-<hex>.tmp`) in the same directory, fsyncs it, then
  renames it over the target. A crash leaves either the old file or the new one, never half of each.
- `withWriteLock` serializes **every** mutation in the process. It is a promise chain kept on
  `globalThis`, so it survives hot reload. Reads never take the lock.
- The lock only works within one process. Two servers on the same data folder can overwrite each other's
  saves, so the README says to run one instance per data folder.
- **Crash cleanup** (`src/lib/server/storage/cleanup.ts`, run by bootstrap under the lock): partial
  `.write-*.tmp` files older than an hour are deleted. A case-only rename interrupted between its two steps
  leaves the only copy under a hidden `.write-rename-*` name. It is never deleted: it comes back as
  "Recovered note" (inside its folder) or "Recovered folder" (in the data folder), and a warning is logged.
- Filesystem errors are mapped to precise codes. For example, `EACCES` and `EROFS` become
  `storage_unavailable` with a hint about ownership, and `ENOSPC` becomes "Disk is full".

<a id="d8"></a>

## D8. Versions are content hashes, and saves are conditional

- A note's `version` is the first 16 hex characters of the SHA-256 of its bytes on disk. Only the server
  computes it. Hashing the bytes, rather than using mtime, also catches edits that only change line
  endings.
- Every save (`PUT /api/notes`) sends the `baseVersion` it started from. `saveNote` in
  `src/lib/server/storage/notes.ts` then decides:
  1. The file is missing: `version_conflict` with `current: null`, unless `force` is set, in which case the
     file is recreated.
  2. The file isn't valid UTF-8: `read_only`.
  3. The version doesn't match: if the text on disk already equals what you're saving, it's a success and
     nothing is written. Otherwise it's `409 version_conflict` with the current note, so the client can
     show the conflict banner without another request.
  4. The encoded file would be over 5 MiB: `too_large`.
  5. The bytes are identical to what's on disk: success, nothing written ([D9](#d9)).
  6. Otherwise, write atomically and return the new version.
- A **forced** save (`force: true`, the banner's "Keep mine") over a file whose version differs from the
  `baseVersion` first copies the bytes on disk to `.trash/<timestamp>-<hex>/<folder>/<name>.md`
  ([D10](#d10)).
- A conflict is one JSON contract (`409` plus `current`), not `If-Match` and `412`.

<a id="d9"></a>

## D9. Never write on open, and never rewrite identical bytes

- When a note opens, the editor serializes it once. That result is the baseline, and autosave only saves
  when the content differs from it. Opening, clicking around or undoing back to the start never touches the
  file. Normalization ([D16](#d16)) is therefore written only on the first real edit.
- On the server, a save whose bytes equal the file on disk returns success without writing, so the
  mtime doesn't change and sync tools stay quiet.
- Line endings and the BOM belong to the file. Reads strip a UTF-8 BOM and turn CRLF into LF. Writes put
  back the existing file's line ending style and BOM (`src/lib/server/storage/text.ts`), so Windows
  users' files keep CRLF.

<a id="d10"></a>

## D10. Deletes go to `.trash`, and nothing is purged

- Deleting a note or folder moves it to `.trash/<timestamp>-<hex>/<folder>[/<name>.md]` inside the data
  folder, after a confirm dialog. `.trash` is hidden, so it's never listed, exported or addressable through
  the API. Nothing is purged automatically, and there is no restore UI: you restore by moving the file back.
  Recoverable deletes need zero UI.
- **Keep mine** in a conflict ([D20](#d20)) copies the version that was on disk into `.trash` before your
  text replaces it ([D8](#d8)), so resolving a conflict never destroys the other side's edits either.
- Deleting the last folder is allowed. On the next load, bootstrap (`src/lib/server/storage/bootstrap.ts`)
  recreates an empty `notebook`, so there is always somewhere to write. A completely empty data folder
  gets `notebook/Welcome.md`.

<a id="d11"></a>

## D11. Empty "Untitled" notes are discarded when you leave them

- **New note** creates a real file (`Untitled`, `Untitled 2`, …) right away, so it has a URL and survives a
  crash. So that clicking **New note** and then going elsewhere doesn't leave empty files behind, leaving
  the note by navigating to another page in write calls `DELETE /api/notes?…&ifEmpty=1` instead of saving.
- The server (`discardIfEmpty`) deletes the file **permanently**, under the write lock, only if its text is
  whitespace-only. It is not moved to `.trash`, because it held nothing. A note with any content, or one
  that doesn't exist, is left alone.
- A **reload**, a tab close or a back/forward-cache visit does not discard the note (`pagehide` only
  saves). Otherwise the page you come back to would show a note that was just deleted under you. Nor does
  leaving while a rename or move of the note is still in flight.
- Code: `createLifecycleHandlers` in `src/components/note/note-lifecycle.ts`, `useNoteSync` in
  `src/components/note/use-note-sync.ts`, and the `ifEmpty` branch of `src/app/api/notes/route.ts`.

---

<a id="d12"></a>

## D12. Optional single password: a signed cookie or a Bearer token, with a lockout

- Auth is off unless `WRITE_PASSWORD` is set. With it set, `/login` exchanges the password for a
  30-day `write_session` cookie (`HttpOnly`, `SameSite=Lax`, and `Secure` when the request came over
  HTTPS, including through a proxy that sends `X-Forwarded-Proto: https`). Scripts send
  `Authorization: Bearer <password>` instead. Basic auth was rejected because it is flaky in iOS Home
  Screen apps and has no sign-out.
- The cookie is stateless: an expiry signed with HMAC-SHA256, using a key derived from the password.
  There's no session store, and changing the password signs out every device. Password and signature
  comparisons are constant-time.
- **Brute-force lockout:** after 10 wrong passwords within 15 minutes, at the sign-in page or in a Bearer
  header, every password check is refused for 15 minutes with `429 Too Many Requests` and `Retry-After`,
  even a correct one. It refuses outright rather than slowing down, and checks, compares and records in
  one synchronous step, so parallel requests can't buy extra guesses. The budget is global rather than
  per IP, because `X-Forwarded-For` can be forged. Devices already signed in keep working, since a valid
  session cookie is not a password check. A script with a stale Bearer password keeps the lockout going.
- **Accepted tradeoff:** because the budget is global, anyone who can reach `/api/auth/login` can keep new
  sign-ins locked with 10 wrong passwords every 15 minutes. Bearer requests stay locked too, since a
  Bearer header is a password guess like any other. Per-IP budgets would need trusted-proxy
  configuration to be safe, which self-hosters rarely get right. We chose "guessing is capped, signed-in
  devices keep working" over "strangers can't delay a new sign-in", and the README tells internet-facing
  installs to use a long random password and a VPN or reverse-proxy auth in front.
- The 429 carries `Retry-After`, and its message names the same wait in minutes (`lockoutResponse`
  computes both from one clock reading), so the sign-in page can show "Try again in N minutes" as is.
  A 429 without that JSON body (from a reverse proxy, for example) still shows the wait:
  `ApiError.retryAfterSeconds` (parsed from `Retry-After` by `parseRetryAfter` in
  `src/lib/api-client.ts`) feeds the login form's fallback message, rounded up to whole minutes like
  `lockoutResponse`, or "Try again later." when there is no header.
- The lockout lives in memory on `globalThis`, shared by the proxy and the route handlers, which fits the
  one-process-per-data-folder rule ([D7](#d7)).
- Code: `src/lib/server/auth.ts` and `src/app/api/auth/`.

<a id="d13"></a>

## D13. The proxy is the first gate, not the only one

- `src/proxy.ts` (Next 16's replacement for `middleware.ts`) gates every page and `/api/**` route
  except static assets, `/login`, `/api/auth/login` and `/api/health`. An unauthenticated page request is
  redirected to `/login?next=…`. An API request gets a JSON `401` (or `429` during a lockout,
  [D12](#d12)), so the client can show "Signed out" instead of following a redirect to HTML.
- `next` only ever redirects within the app: `safeNextPath` (`src/lib/routes.ts`) rejects control
  characters, whitespace and backslashes, then parses the value, requires the same origin and returns the
  re-serialized path. That path is checked again, because parsing resolves dot segments: `/.//evil.com`
  and `/a/%2e%2e//evil.com` both serialize to the protocol-relative `//evil.com`, which a browser treats
  as another host. The login page (server redirect) and the login form (`router.replace`) both use it.
- Handlers (`handle()`) and loaders check auth again. The proxy's matcher is easy to get subtly wrong, so
  it shouldn't be the only check.
- The note size cap (5 MiB) stays below the proxy's 10 MB request body buffer.

<a id="d14"></a>

## D14. CSRF protection without origin checks

- For every request other than GET and HEAD, `handle()` requires that `Sec-Fetch-Site`, if present, is
  `same-origin` or `none` (otherwise `403`), and that POST, PUT and PATCH bodies are
  `Content-Type: application/json` (otherwise `415`).
- Browsers send `Sec-Fetch-Site` themselves and pages can't forge it. A JSON body also forces a CORS
  preflight, which the server never answers. Together they block cross-site writes even when auth is off,
  so a malicious page can't write to a write server on your LAN.
- There is no Origin/Host comparison, so reverse proxies work without any configuration. `curl` sends no
  `Sec-Fetch-Site` header and is allowed through.

---

<a id="d15"></a>

## D15. Markdown escaping is patched per editor and guarded by fixtures

- Tiptap's default Markdown output writes `&amp;`, `\_` and `\[\[` into people's files. write patches the
  serializer **per instance** (`patchMarkdownManager` in `src/lib/markdown/escape.ts`) and escapes
  typed text that would otherwise reopen as markup (`WriteParagraph`). A test fails loudly if a Tiptap
  upgrade breaks the patch.
- **Bare URLs** (`http://`, `https://`, `ftp://`, `www.`) in typed text are not escaped inside the URL
  (`autolinkSpans` in `src/lib/markdown/autolinks.ts`), because marked links everything up to the next
  space, backslashes included: `a_b_` would reopen as a link to `a\_b\_`. Where a bare URL would swallow
  a code span, a link or an emphasis delimiter right after it, it is written as `https\://…` (or
  `www\.…`) so it isn't linked and the formatting survives. A bare URL or email that marked does link
  re-opens as a link (an accepted normalization, like `<autolinks>`), so a later save writes `[url](url)`.
- **Read-back:** every paragraph, heading or table cell whose Markdown holds a syntax character is read
  back with marked (`src/lib/markdown/nodes/read-back.ts`); paragraphs over 16 K characters only when
  they have delimiters or a bare address. If marked reads different marks, other delimiter styles are
  tried, and failing that the text is simplified where marked first misread it: the URL is kept from
  being linked, or else the nearest emphasis stretch is given up, never text. What's left is written
  again, so a second save writes the same bytes. Paragraphs are written in independent parts, so this
  stays close to linear (`src/lib/markdown/nodes/inline.ts`).
- **Safety net:** when that targeted simplification finds nothing left to give up, or has run 4 times in
  a row, the part falls back one step per render, cheapest loss first (`fallBack` in
  `src/lib/markdown/nodes/inline-atoms.ts`): no bare address in it is linked, then every ASCII
  punctuation character in its text is backslash-escaped (`escapeEverything` in `escape.ts`), then all
  emphasis is dropped. The work stays bounded, links and marks the user applied stay, and plain text
  never re-opens as a link, image or emphasis.
- A `!` right before a link is written `\!`, so it can't turn the link into an image. Table cells escape
  every `|` on the finished cell Markdown (`escapeTablePipes`), link destinations and image sources
  included. Link destinations and titles escape backticks, because Tiptap pairs backticks across cells
  before it splits a table row.
- Always read Markdown with `serializeBody(editor)`, never `editor.getMarkdown()`, because only
  `serializeBody` applies the escaping and final-newline rules.
- The document schema is `createSchemaExtensions()` in `src/lib/markdown/extensions.ts`. Both the editor
  (`createExtensions()`, which adds editor-only behavior such as the placeholder and paste handling) and
  the headless `createMarkdownManager()` used by tests are built from it. New Markdown syntax belongs in
  the schema. Otherwise the fixture tests never see it.
- Every extension needs round-trip fixtures in `src/lib/markdown/__fixtures__/`. They check the output
  byte for byte, idempotence (`f(f(x)) === f(x)`) and the fidelity classification.

<a id="d16"></a>

## D16. Notes the editor can't keep open as Markdown source

- On open, `analyzeFidelity` (`src/lib/markdown/fidelity.ts`) compares the note with its round trip
  through the editor. The result is one of three:
  - **exact:** identical after the final-newline rule.
  - **normalized:** it renders to the same HTML (for example `*` bullets becoming `-`, or setext headings
    becoming `#`). The note opens visually, and the normalization is written on the first edit.
  - **lossy:** the note contains raw HTML or HTML comments, footnote definitions, math the round trip
    changes, link reference definitions nothing uses (bookmarks, `[//]: #` comments), backslash escapes
    whose removal would make Obsidian-style syntax live (`\#tag`, `\[\[x]]`, `\=\=`, `\%\%`, `\$`), or
    the rendered structure differs. Code blocks are compared byte for byte. A list marker alone on a
    line with trailing whitespace at the start of a paragraph (`1. ` or `- `, as older versions of write
    wrote an empty item) is **structure** too: CommonMark and GitHub read it as an empty list item, marked
    as text (`hasMisreadEmptyItem`).
- **Lossy notes open in source mode** (a textarea holding the whole file) with a banner. "Edit visually
  anyway" asks for confirmation first. Editing never silently destroys content.
- **Large notes open in source mode**, because inline parsing is superlinear: notes over 256 KiB, and
  notes where one inline run is over 16 K characters (`hasOversizedParagraph` in
  `src/lib/markdown/oversized.ts`, re-exported from `fidelity.ts`). It makes one linear pass over the
  lines (`scanBlocks`) and gives an upper bound on the longest inline run: blank lines, headings,
  thematic breaks, list items that interrupt a paragraph, valid GFM tables, and fenced, indented or HTML
  blocks end runs, and anything unsure counts toward the run, so an unusual note may open as source.
  Long tight lists, tables and quotes still open visually, and fenced or indented code never counts. It
  finishes in a few milliseconds for any input up to 256 KiB; marked's block lexer, used before, was
  superlinear on long list items and on quotes whose depth changes every line. Quotes or lists nested
  more than 32 levels on one line (`> > > …`) also open in source mode, because they could overflow
  marked's stack; the guard skips thematic breaks and allows 256 levels on lines read as code. Notes over
  5 MiB or that aren't valid UTF-8
  are read-only ([D18](#d18)). Both callers, `note-editor.tsx` (the "Large note" notice) and Markdown
  paste ([D22](#d22)), use the same check.
- Switching modes from the ⋯ menu flushes first, then remounts the inner editor from the last saved
  content with a recomputed baseline.

<a id="d17"></a>

## D17. Front matter is split off and kept byte for byte

- YAML (`---`) or TOML (`+++`) front matter is split off before the editor sees the body
  (`splitFrontmatter`) and rejoined unchanged on save (`composeFile`), both in
  `src/lib/markdown/file-format.ts`. Otherwise the editor would turn it into a horizontal rule and a
  setext heading.
- Visual mode shows it read-only as "Properties". Source mode shows the full file, so it can be edited
  there.

<a id="d18"></a>

## D18. Opening a note

In order, in `src/components/note/` and `src/components/editor/note-editor.tsx`:

1. **Read-only:** a note over 5 MiB or not valid UTF-8 renders `ReadOnlyNote`: the reason, a text preview
   for files that aren't UTF-8, and a download button. write never modifies it.
2. **Mode:** over 256 KiB, an inline run (paragraph, list item, heading or table cell) over 16 K
   characters, or quotes and lists nested more than 32 deep goes to source mode ([D16](#d16)). The run
   check is one linear pass over the lines that bounds the longest run from above, so it takes a few
   milliseconds even on adversarial input (`src/lib/markdown/oversized.ts`). Otherwise
   the visual editor is created and the fidelity
   check ([D16](#d16)) runs **synchronously on the first render**. The editor is loaded with
   `next/dynamic(…, { ssr: false })` and `immediatelyRender: true`, so there is no flash of the wrong mode
   and Tiptap is code-split out of the app shell.
3. **Baseline** ([D9](#d9)): the round-tripped body plus the front matter (visual), or the raw file
   (source).
4. **Draft recovery:** a `localStorage` draft ([D19](#d19)) that matches the baseline is dropped. A draft
   based on the current version is restored with the notice "Restored unsaved changes from this device".
   Drafts are restored by **remounting the editor with the draft text**, so the fidelity check applies to
   them too (a draft with HTML opens in source mode). A draft based on an older version is parked under
   its own key (`write:draft-conflict:v1:`), which autosave never touches, and shows the conflict banner's
   "draft" variant ([D20](#d20)) until you pick one of its choices. A pending draft conflict is also
   dropped, together with the regular draft, when the note or its folder is deleted, when the note is
   renamed away from its old name, and when an empty Untitled note is discarded (once the server confirms)
   (`forgetDrafts` / `forgetFolderDrafts` in `src/lib/drafts.ts`). "Save mine as a copy" keeps the
   original's conflict, since that file still exists. The known state of step 5 is forgotten alongside
   (`forgetNote` / `forgetFolder`).
5. **Newest known state:** the editor opens from the newest content and version this tab knows
   (`src/components/note/known-notes.ts`), not from page props that may be stale (back/forward replays
   cached props). The registry keeps each note's content, version and `updatedAt` (the file's mtime). It
   is preferred over props only when the props' `updatedAt` is strictly older (both come from the server
   clock), so equal or newer props always win. An entry is forgotten when the note is deleted,
   discarded, renamed or moved away (both names), when its folder is renamed or deleted, and when a new
   note is created under its name (`forgetNote` / `forgetFolder` / `noteCreated` / `recordMove`), so a
   new note reusing a name never opens with the old note's text. A revalidation `GET` on mount catches a
   stale page restored by the browser; it retries transient failures (after 2, 5 and 15 s) and runs again
   on a back/forward-cache `pageshow`.
6. **Focus:** an empty `Untitled` note focuses and selects its title. On touch devices nothing is
   focused automatically, so the keyboard doesn't jump up. After a rename made while typing in the body,
   the new name's editor gets the old editor's exact document and caret ([D21](#d21)).

<a id="d19"></a>

## D19. Autosave is a framework-free state machine

- `createAutosaver` (`src/lib/autosave.ts`) is plain TypeScript: `saved → dirty → saving → saved`, plus
  `offline`, `error` and `conflict`. It keeps at most one save in flight and retries with backoff (1, 2, 5,
  10, then every 30 seconds). Its tests use fake timers and a fake `save()`, with no DOM.
  `useNoteSync` (`src/components/note/use-note-sync.ts`) wires it to React and the browser.
- **Triggers:**

  | Event                                                          | What happens                                                |
  | -------------------------------------------------------------- | ----------------------------------------------------------- |
  | Typing                                                         | Save after 750 ms idle, and at least every 5 s while typing |
  | ⌘S                                                             | Save now                                                    |
  | Tab hidden                                                     | Save now                                                    |
  | Page hide, or leaving the note in the app                      | `keepalive` save, so it survives the tab closing            |
  | `beforeunload` with unsaved changes                            | Browser's "leave page?" prompt (desktop; iOS ignores it)    |
  | Back online                                                    | Retry                                                       |
  | Before rename, move, delete, download, or folder rename/delete | `await flush()`                                             |

- **Crash-safety drafts:** before every save the content is written to `localStorage`
  (`src/lib/drafts.ts`, key prefix `write:draft:v1:`) together with the version it's based on. Every
  access is wrapped in try/catch. `keepalive` bodies share a 64 KiB browser quota, so the guard measures
  the whole JSON request body (`saveNoteBodyBytes`), not just the note text, and larger notes rely on the
  draft when the tab closes. A draft written while a save is in flight is rebased onto that save's version
  when it lands, even after the page has closed.
- **Save status** (`save-status.tsx`) stays calm when things are fine: "Saved", a dot for "Edited", and
  "Saving…" only after 300 ms. It is specific when they're not: "Offline · kept on this device",
  "Not saved · Retry", "Conflict". Only those last three are announced to screen readers.

<a id="d20"></a>

## D20. External edits and conflicts: detect, never overwrite

- There is no file watcher. A refresh (on focus, or after a mutation) brings new page props carrying the
  note's `version`. If it's a version this tab didn't produce:
  - **Clean note:** load the disk version silently and show "Updated from disk".
  - **Unsaved edits:** do nothing yet. The next save gets `409` ([D8](#d8)) and the conflict banner
    appears.
- The **conflict banner** (`src/components/note/conflict-banner.tsx`) is the only place a conflict is
  resolved, and every choice is explicit:

  | Variant                                                       | Choices                                                                                                                                                                                                                               |
  | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | **changed**: the file changed on disk                         | **Keep mine** force-saves your text and moves the disk version to `.trash` ([D10](#d10)). **Use disk version** loads the file. **Save mine as a copy** creates `<name> (conflict)` and opens it; the original takes the disk version. |
  | **deleted**: the file or its folder is gone                   | **Keep mine** recreates the file. **Save as new note**. **Close**.                                                                                                                                                                    |
  | **own**: the disk version is one this tab saved (a late save) | **Use saved version** (primary) loads it. **Keep mine** and **Save mine as a copy** as for **changed**.                                                                                                                               |
  | **moved**: a stale page of a note this tab renamed or moved   | **Open “X”** opens the new name and carries your edits there as a draft. **Save as new note**. No **Keep mine**, so no stale duplicate is created.                                                                                    |
  | **draft**: this device has unsaved edits on an older version  | The same three choices as **changed**, with a preview of the draft. It survives typing and "Updated from disk".                                                                                                                       |

<a id="d21"></a>

## D21. Renaming remounts the editor

- The title is the filename ([D5](#d5)). A rename commits on blur or Enter (Escape reverts): pending edits
  are flushed, `PATCH /api/notes` renames the file, the draft moves to the new name, and the app navigates
  to the new URL, unless you already went elsewhere (clicked another note, "‹ Notes" or Back), in which
  case only the sidebar refreshes.
- The editor stays editable while the rename lands. Text typed meanwhile is handed to the new name as a
  draft and restored quietly there. The new name's editor also gets the old editor's exact document
  (ProseMirror JSON, `src/components/editor/editor-snapshot.ts`), not just the Markdown draft, so a
  trailing Enter or space typed while the rename lands is kept; the snapshot is only applied when it
  serializes to the same text, so it can never change the file, and it adds no undo step. The caret is put
  back if the body had focus. Downloads and folder actions wait for a rename in flight before they flush,
  and the header and ⋯ menu download works out its URL only after the rename lands, so it fetches the new
  name ([D23](#d23)).
- The page is keyed by folder and name, so the editor remounts and undo history resets. Keeping the
  editor alive across a rename was deferred to keep v1 simple. On iPhone the keyboard may stay closed after
  the remount, because iOS only raises it for a focus inside a user gesture.
- Invalid names show an inline error below the title. A taken name says
  `A note named "X" already exists in <folder>.`

<a id="d22"></a>

## D22. Paste, links and shortcuts

- **Paste:** HTML goes through the editor schema. Plain text that looks like Markdown (`looksLikeMarkdown`
  in `src/lib/markdown/markdown-paste.ts`) is parsed as Markdown, unless the editor would drop part of it
  (the same fidelity check as opening a note, [D16](#d16)): then it is pasted as plain text with a toast.
  Markdown over 256 KiB (`VISUAL_EDITOR_MAX_BYTES`) is pasted as plain text without being parsed, like a
  note that size opening in source mode.
  Inside a code block, text is pasted raw. Pasted files and images are ignored with a toast, because uploads aren't supported yet.
- **Table cells** hold one line of inline text. Blocks pasted or dropped into a cell are flattened to one
  line, joined with spaces (`src/lib/markdown/nodes/table-cells.ts`). A drop is judged by where it lands,
  not by the caret, so blocks dropped outside a table stay blocks even while the caret is in a cell.
- **Enter over a selection that spans blocks** (two list items, a heading and a list…) deletes the
  selection and then splits at the caret, like a word processor: `- al|pha`, `- be|ta` becomes `- al`,
  `- ta` (`src/lib/markdown/nodes/enter-over-selection.ts`). Selections touching a table cell are left to
  the cell's own Enter handling.
- **Links** don't open on a plain click, so clicking a link places the caret to edit it. ⌘-click opens
  http, https and mailto links in a new tab with `noopener`. ⌘K opens the link dialog.
- **Underline is off**, and there's no ⌘U. Its Markdown form (`++x++`) isn't portable.
- Formatting actions are defined once, in `src/components/editor/toolbar-items.ts`, and both toolbars
  render from that list.

---

<a id="d23"></a>

## D23. Downloads save first and never leave the page

- One note downloads the exact bytes on disk. A folder or everything downloads as a `.zip` built in
  memory with `fflate` (`src/lib/server/storage/export.ts`). Zips hold one root directory, only the notes
  the sidebar shows, and entries for empty folders. They never include `.trash`. Timestamps are clamped to
  1980–2099 because zip can't store other dates. Personal notes are small, so streaming wasn't worth it.
- Every download goes through `useDownload()` (`src/components/ui/download-link.tsx`): it flushes the open
  note first, so the download includes your latest edit, then `downloadFile` (`src/lib/download.ts`)
  fetches the file and saves it through a temporary object URL, under the filename from
  `Content-Disposition`. `DownloadLink` stays a real anchor, so modified clicks and "Save link as…" still
  work.
- `useDownload` takes a `DownloadTarget`: a URL, or a function that returns one. `flushThenDownload`
  (`src/lib/download.ts`) resolves it only after the flush, which waits for a rename or move in flight, so
  the open note's download (header and ⋯ menu) is named after where that rename leaves it.
- **A failed download** (for example, the note was renamed elsewhere, or you were signed out) shows an
  error toast and leaves the app where it was, instead of replacing the page with an error.
- The same `GET /api/download` works from `curl` with a Bearer token, for scripted backups.

<a id="d24"></a>

## D24. Import creates notes and never overwrites

- A folder's ⋯ menu → **Import .md files…** accepts `.md`, `.markdown` and `.txt` files
  (`src/components/sidebar/import-notes.ts`). Each file becomes a note through the normal create
  endpoint, so an existing name gets a suffix ("Name 2") instead of being overwritten.
- Outside filenames can contain anything, so the title goes through `toSafeName`, which always returns a
  name that passes `validateName` ([D6](#d6)). Files over 5 MiB are skipped and counted in the summary
  toast.

---

<a id="d25"></a>

## D25. Phones get list and detail views; larger screens get a sidebar

- **Below 768 px** there is no sidebar and no drawer. `/notes` is the library screen, and a note's header
  has "‹ Notes". This is the native iOS pattern: swipe-back works, and there is no focus trap or `inert`
  juggling. **From 768 px up** there is a persistent sidebar, collapsible with ⌘\ and remembered in the
  `write-sidebar` cookie, which the server reads so there's no layout flash. One `Sidebar` component
  serves both layouts.
- The text column widens a little per breakpoint (`editor-skeleton.tsx` holds the shared column classes).
  Heights use `dvh`, never `100vh`.
- **iPhone specifics:**
  - `useKeyboardInset` publishes the keyboard height as `--kb`, so the formatting toolbar docks right
    above the keyboard. iOS ignores `interactive-widget`.
  - Toolbar buttons call `preventDefault()` on pointer down, so the editor keeps focus and the keyboard
    stays open.
  - Touch devices (`pointer-coarse:`) get 44×44 targets everywhere. Fine pointers keep compact desktop
    sizes.
  - Dialogs render as bottom sheets, and safe-area insets keep controls clear of the notch and home
    indicator.

<a id="d26"></a>

## D26. Design tokens and a system theme

- Components use only the color tokens defined in `src/app/globals.css` (`bg-canvas`, `text-muted`,
  `border-line`, `bg-accent`, …). They never use hex values or Tailwind palette colors. That's what makes
  dark mode work.
- The theme follows `prefers-color-scheme`. There is no toggle, so there is no script, no cookie and no
  flash.
- The look is calm and typographic: one accent color (caret, selection, links, focus ring, active row,
  primary buttons), hairline borders, and shadows only on menus, dialogs and toasts. Editor typography
  lives in `src/components/editor/editor.css` and uses token variables only.

---

<a id="d27"></a>

## D27. Standalone output only in Docker, and a quiet health check

- `output: "standalone"` is enabled only when `BUILD_STANDALONE=1`, which the Dockerfile sets. The
  standalone `server.js` changes directory into `.next/standalone`, so on bare metal a relative `./data`
  would land inside the build output and be wiped by the next build. `getDataDir()` also refuses any data
  folder inside `.next/`, and `next.config.ts` keeps `./data` out of build tracing.
- The `/* turbopackIgnore: true */` comment on the data-dir `path.resolve` in
  `src/lib/server/storage/config.ts` is load-bearing. Without it, Turbopack traces the whole project into
  the build.
- The Docker image sets `HOSTNAME=0.0.0.0`, because Docker sets `HOSTNAME` to the container id and
  `server.js` would bind to that.
- **`GET /api/health`** is public, so it doesn't need a password, and it is used by the Docker
  `HEALTHCHECK` every 30 s. A real write test (a hidden `.write-health-*.tmp` file, created and removed
  at once, without fsync) runs **at most every 10 minutes**, shared by concurrent calls; in between, each
  call only checks permissions with `access()`. So frequent probes barely touch the notes folder or wake
  sync tools, while a folder that vanishes or turns read-only still fails at once. Failures are never
  cached (`src/lib/server/storage/health.ts`).
- Every response carries strict security headers (`next.config.ts`): no framing, `nosniff`, and
  `Referrer-Policy: no-referrer`, because note titles appear in URLs.

<a id="d28"></a>

## D28. Configuration comes from the environment

- There are only two app settings: `WRITE_DATA_DIR` (default `./data` relative to the working directory,
  or `/data` in Docker) and `WRITE_PASSWORD`. Both are read at runtime, so they can live in `.env.local`
  for `npm start` / `npm run dev`.
- **The port and bind address can't go in `.env.local`.** `next start` and `next dev` choose them from
  their command-line flags before `.env` files are loaded. Use `npm start -- -p 8080 -H 127.0.0.1`. `PORT`
  also works as a real environment variable (`PORT=8080 npm start`), but `next start` ignores `HOSTNAME`
  entirely. `HOSTNAME` only affects the Docker image's standalone `server.js`.
- Hosting under a subpath isn't supported. Use a subdomain.

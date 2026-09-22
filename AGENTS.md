<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# write project rules

write is a self-hosted Markdown notes app: every note is a plain `.md` file in `WRITE_DATA_DIR`
(`<folder>/<name>.md`). Read `CONTRIBUTING.md` for the architecture map and recipes. These rules are
binding for every change:

1. **Only `src/lib/server/storage/` touches the filesystem.** ESLint enforces it, and it also blocks
   `@/lib/server/*` imports from client-reachable code (`src/components`, `src/lib` outside `server`).
2. **URLs are built only in `src/lib/routes.ts`.** Page `params` arrive percent-encoded: decode them
   exactly once with `noteRefFromParams` / `decodeSegment`. Route Handler params are never used for names;
   API names travel in the query string or the JSON body.
3. **Mutations and downloads go through `/api` Route Handlers wrapped in `handle()`** (auth, CSRF, error
   mapping). No Server Actions. The client calls them only through `api` in `src/lib/api-client.ts`.
4. **Read Markdown with `serializeBody(editor)`, never `editor.getMarkdown()`.**
5. **Every Markdown extension needs round-trip fixtures** in `src/lib/markdown/__fixtures__/`.
6. **Colors only via design tokens** (`bg-canvas`, `text-muted`, `border-line`, …). No hex values and no
   Tailwind palette colors in components.
7. **Small focused files** (about 200 lines at most), with a short JSDoc on each export that explains why.
8. **No new dependency without an issue.** Tiptap packages are pinned exactly; don't bump them casually,
   because the escaping patch relies on Tiptap internals.

Also:

- Never write a note the user didn't edit, and never rewrite identical bytes.
- No `console.log`. Never use `100vh` (use `dvh`).
- `cacheComponents` stays off. Every loader calls `connection()` before reading the filesystem.
- Verify with `npm run check` (lint, `next typegen && tsc`, vitest, prettier). `next build` doesn't lint.

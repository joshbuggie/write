/** Markdown images whose address is a web URL: `![alt](https://…)` or `![alt](<https://…>)`. */
const REMOTE_IMAGE = /!\[[^\]]*\]\(\s*<?(https?:\/\/[^\s)>]+)/gi;

/**
 * Hosts of web images a reply adds that weren't in the text it was given. Once the reply is in the note,
 * the editor loads them, and an image address is a way to send text elsewhere, so the prompt window names
 * them before Replace or Insert (docs/design-decisions.md#d29).
 */
export function addedImageHosts(reply: string, context: string): string[] {
  const hosts = new Set<string>();
  for (const [, url] of reply.matchAll(REMOTE_IMAGE)) {
    if (context.includes(url)) continue;
    try {
      hosts.add(new URL(url).host);
    } catch {
      /* not a URL after all: nothing will load */
    }
  }
  return [...hosts];
}

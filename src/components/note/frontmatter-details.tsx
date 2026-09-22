/**
 * Read-only "Properties" block for a note's front matter (YAML/TOML). The visual editor never sees
 * front matter, so it can't mangle it; it is saved back byte for byte. Editing it means switching to
 * Markdown source mode, as the hint says.
 */
export function FrontmatterDetails({ frontmatter }: { frontmatter: string }) {
  return (
    <details className="mt-4 mb-2">
      <summary className="w-fit cursor-pointer text-[13px] text-muted select-none hover:text-ink">
        Properties
      </summary>
      <pre className="mt-2 overflow-x-auto rounded-md bg-sidebar p-3 font-mono text-[13px] leading-[1.6] text-muted">
        {frontmatter.trimEnd()}
      </pre>
      <p className="mt-1 text-[12px] text-subtle">Use “Edit as Markdown” in the ⋯ menu to change these.</p>
    </details>
  );
}

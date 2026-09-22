import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TextField } from "./text-field";

const render = (error: string | null) =>
  renderToStaticMarkup(createElement(TextField, { id: "name", "aria-label": "Name", error }));

describe("TextField error", () => {
  it("keeps an empty live region mounted, so a later error is announced", () => {
    const html = render(null);
    expect(html).toMatch(/<p id="name-error" aria-live="polite"[^>]*><\/p>/);
    expect(html).not.toContain("aria-describedby");
    expect(html).not.toContain("aria-invalid=");
  });

  it("puts the message in the live region and links it to the input", () => {
    const html = render("Name can't be empty.");
    expect(html).toMatch(/<p id="name-error" aria-live="polite"[^>]*>Name can(&#x27;|')t be empty.<\/p>/);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="name-error"');
  });
});

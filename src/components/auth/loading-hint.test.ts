import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoadingHint } from "./loading-hint";

describe("LoadingHint", () => {
  it("is in the server HTML, behind the delayed reveal", () => {
    const html = renderToStaticMarkup(createElement(LoadingHint));
    expect(html).toContain("reload the page");
    expect(html).toContain("animate-appear-late");
  });
});

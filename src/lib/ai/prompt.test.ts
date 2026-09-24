import { describe, expect, it } from "vitest";
import { buildMessages, unwrapReply } from "./prompt";
import { DEFAULT_AI_SETTINGS } from "./settings";

describe("unwrapReply", () => {
  const { user } = buildMessages(
    DEFAULT_AI_SETTINGS,
    { kind: "selection", text: "- Book the campsite\n- Buy snaks", noteTitle: 'Trip "plan"' },
    "Fix spelling.",
  );
  const echoed = user.slice(0, user.indexOf("</note>") + "</note>".length).replace("snaks", "snacks");

  it("takes off the <note> tag a model echoes around its reply", () => {
    expect(echoed.startsWith('<note title="Trip \'plan\'" part="selection">\n')).toBe(true);
    expect(unwrapReply(echoed)).toBe("- Book the campsite\n- Buy snacks");
    expect(unwrapReply(`  ${echoed}\n\n`)).toBe("- Book the campsite\n- Buy snacks");
  });

  it("drops the opening tag while the reply is still streaming", () => {
    expect(unwrapReply('<note title="Trip" part="whole note">\n- Book')).toBe("- Book");
    expect(unwrapReply('<note title="Trip" par')).toBe('<note title="Trip" par');
  });

  it("leaves other replies alone, including ones that only mention a note tag", () => {
    for (const reply of [
      "- Book the campsite",
      "Use a <note> tag here.\n\n</note>",
      'Intro\n<note title="x" part="selection">\nkept\n</note>',
      "<note>\nplain tag\n</note>",
    ]) {
      expect(unwrapReply(reply)).toBe(reply);
    }
  });
});

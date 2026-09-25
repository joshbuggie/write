import { describe, expect, it } from "vitest";
import { buildBrief } from "./brief";

const note = { folder: "Essays", name: 'The "tide" pools' };

describe("buildBrief", () => {
  it("names the note, passes the instruction on, and asks for the job's request id", () => {
    const brief = buildBrief({
      note,
      instruction: "  Make it shorter.  ",
      sections: [],
      jobId: "a1b2",
      continuing: false,
    });
    expect(brief).toContain(`the note "The 'tide' pools" in the folder "Essays"`);
    expect(brief).toContain("The owner's request:\nMake it shorter.");
    expect(brief).toContain("Read the note with read_note first.");
    expect(brief).toContain('requestId "a1b2"');
    expect(brief).not.toContain("Change only");
  });

  it("limits the job to chosen sections, and a continuation starts from the owner's decisions", () => {
    const brief = buildBrief({
      note,
      instruction: "",
      sections: ["Opening", "Why go"],
      jobId: "x",
      continuing: true,
    });
    expect(brief).toContain('Change only these sections: "Opening", "Why go".');
    expect(brief).toContain("get_proposal");
    expect(brief).toContain("Improve the note.");
  });
});

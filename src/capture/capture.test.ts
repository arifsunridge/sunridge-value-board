import { describe, expect, it } from "vitest";
import { clean, userPrompt } from "./capture";
import { AREAS, COMPANIES, MEMBERS } from "@/store/seed";

describe("Capture", () => {
  it("drops unknown Owners and Areas, bad dates and extra note lines", () => {
    const [s] = clean(
      [
        {
          title: "  Confirm   the line start date ",
          departmentId: "finance",
          areaId: "a-hbf-manufacturing",
          priority: "high",
          ownerIds: ["m-theran", "plant-manager", "m-theran"],
          due: "2026-13-40",
          note: "First line\nsecond line",
        },
      ],
      { areas: AREAS, members: MEMBERS },
    );
    expect(s).toEqual({
      title: "Confirm the line start date",
      departmentId: "operations", // taken from the Area
      areaId: "a-hbf-manufacturing",
      priority: "high",
      ownerIds: ["m-theran"],
      due: null,
      note: "First line",
    });
  });

  it("tells Claude the company's English and lists only Members as Owners", () => {
    const prompt = userPrompt({ company: COMPANIES[0]!, areas: AREAS.filter((a) => a.companyId === "c-hbf"), members: MEMBERS, meetingDate: "2026-10-02", notes: "…" });
    expect(prompt).toContain("US English");
    expect(prompt).toContain("m-theran = Theran Example");
    expect(prompt).toContain("a-hbf-manufacturing = Manufacturing");
    expect(prompt).not.toContain("a-sun-ai"); // only this company's Areas are passed in by the caller
  });
});

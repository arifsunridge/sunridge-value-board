import { describe, expect, it } from "vitest";
import { prepare, splitOwners, type Backup } from "./prototype";

// Invented data only.
const backup: Backup = {
  categories: {
    "d-operations": { name: "Operations", parentId: null, projectId: null },
    "s-acme-plant": { name: "Plant", parentId: "d-operations", projectId: "p-acme" },
  },
  actions: {
    a1: { title: "Sample run review — owner: Theran, Arif (data)", status: "next", categoryId: "s-acme-plant", projectId: "p-acme", due: "2026-10-09" },
    a2: { title: "Check an example supplier's capacity and timing for the new pilot line", status: "now", categoryId: null, projectId: "p-acme", due: "" },
  },
};

describe("prototype import", () => {
  it("moves owner names out of titles", () => {
    expect(splitOwners("Finance baseline — owner: Jack (on site), Arif (GL analysis)")).toEqual({
      title: "Finance baseline",
      names: ["Jack", "Arif"],
    });
    expect(splitOwners("Set up next week's sessions")).toEqual({ title: "Set up next week's sessions", names: [] });
  });

  it("prepares reviewable Tasks without deciding priority for anyone", () => {
    const [first, second] = prepare(backup, { members: { Theran: "m-theran", Arif: "m-arif" }, companies: { "p-acme": "Acme" } });
    expect(first).toMatchObject({
      company: "Acme",
      departmentId: "operations",
      area: "Plant",
      title: "Sample run review",
      ownerIds: ["m-theran"],
      contributorIds: ["m-arif"],
      priority: "medium",
      approved: false,
    });
    expect(second!.title.split(" ")).toHaveLength(8);
    expect(second!.check).toEqual(
      expect.arrayContaining([expect.stringContaining("No Department"), expect.stringContaining("No Owner"), expect.stringContaining("cut to 8 words")]),
    );
    expect(second!.due).toBeNull();
  });
});

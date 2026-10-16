import { describe, expect, it } from "vitest";
import type { Person } from "@/board/model";
import { ownerMatches, ownerOptions } from "./format";

const task = (over: Partial<{ ownerIds: string[]; contributorIds: string[]; ownerNames: string[]; companyOwner: string }>) => ({
  ownerIds: [],
  contributorIds: [],
  ownerNames: [],
  companyOwner: "",
  ...over,
});
const members: Person[] = [
  { id: "m-sam", email: "sam@example.com", name: "Sam Example", kind: "member", companyId: null, signedInAt: null },
  { id: "jordan.example@example.com", email: "jordan.example@example.com", name: "jordan.example@example.com", kind: "member", companyId: null, signedInAt: null },
  { id: "h-lee", email: "lee@example.com", name: "Lee Example", kind: "company", companyId: "c-acme", signedInAt: null },
];

describe("filtering the board by Owner", () => {
  it("matches a Person who owns or contributes, a typed name and the company owner", () => {
    expect(ownerMatches("p:m-sam", task({ ownerIds: ["m-sam"] }))).toBe(true);
    expect(ownerMatches("p:m-sam", task({ contributorIds: ["m-sam"] }))).toBe(true);
    expect(ownerMatches("p:m-sam", task({ ownerIds: ["h-lee"] }))).toBe(false);
    expect(ownerMatches("n:example colleague", task({ ownerNames: ["Example Colleague"] }))).toBe(true);
    expect(ownerMatches("c:Tom", task({ companyOwner: "tom" }))).toBe(true);
    expect(ownerMatches("c:Tom", task({ companyOwner: "" }))).toBe(false);
  });

  it("treats no Owner, or one it can't read, as anyone", () => {
    expect(ownerMatches(undefined, task({}))).toBe(true);
    expect(ownerMatches("", task({ ownerIds: ["m-sam"] }))).toBe(true);
    expect(ownerMatches("x:what", task({}))).toBe(true);
  });

  it("offers the people on the board by side, with counts and names rather than emails", () => {
    const tasks = [
      task({ ownerIds: ["m-sam", "h-lee"], companyOwner: "Tom" }),
      task({ ownerIds: ["jordan.example@example.com"], contributorIds: ["m-sam"] }),
      task({ ownerNames: ["Example Colleague"], companyOwner: "Tom" }),
    ];
    expect(ownerOptions(tasks, members)).toEqual({
      sunridge: [
        { value: "p:jordan.example@example.com", label: "Jordan Example", count: 1 },
        { value: "p:m-sam", label: "Sam Example", count: 2 },
      ],
      company: [
        { value: "p:h-lee", label: "Lee Example", count: 1 },
        { value: "c:Tom", label: "Tom", count: 2 },
      ],
      others: [{ value: "n:Example Colleague", label: "Example Colleague", count: 1 }],
    });
  });
});

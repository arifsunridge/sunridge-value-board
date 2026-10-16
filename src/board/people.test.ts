import { describe, expect, it } from "vitest";
import type { Person } from "./model";
import { People, displayName, nameFromEmail } from "./people";

const person = (id: string, name: string): Person => ({ id, email: id, name, kind: "member", companyId: null, signedInAt: null });

describe("people's names (ADR 0009)", () => {
  it("makes a name from an email, never shows the email", () => {
    expect(nameFromEmail("jordan.example@example.com")).toBe("Jordan Example");
    expect(nameFromEmail("sam_example-two@example.com")).toBe("Sam Example Two");
    expect(displayName("jordan.example@example.com")).toBe("Jordan Example");
    expect(displayName("", "sam@example.com")).toBe("Sam");
    expect(displayName("Jordan Example")).toBe("Jordan Example");
  });

  it("names and finds a Person whose stored name is only their email", () => {
    const people = new People([person("jordan.example@example.com", "jordan.example@example.com"), person("sam@example.com", "Sam Example")]);
    expect(people.names(["jordan.example@example.com", "sam@example.com"])).toEqual(["Jordan Example", "Sam Example"]);
    expect(people.find("Jordan")?.id).toBe("jordan.example@example.com");
    expect(people.owners([], ["Jordan Example"])).toEqual({ ownerIds: ["jordan.example@example.com"], ownerNames: [] });
  });
});

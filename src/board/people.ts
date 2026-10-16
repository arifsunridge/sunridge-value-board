import { OWNER_NAMES_MAX, OWNER_NAME_MAX_CHARS, type Person, type Task } from "./model";
import { BoardError } from "./rules";

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";

/** A name made from an email's first part: "arif.bayrak@…" is "Arif Bayrak". */
export function nameFromEmail(email: string): string {
  const local = email.trim().split("@")[0] ?? "";
  const words = local.split(/[._+-]+/).filter(Boolean);
  return words.map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase()).join(" ") || email.trim();
}

/** A Person's name for people to read: never an email, since sign-in may give the board no name. */
export function displayName(name: string, email = name): string {
  const clean = name.trim();
  return !clean || clean.includes("@") ? nameFromEmail(clean || email) : clean;
}

/**
 * The people on the board, and the one place that turns what someone says ("me", an email, a
 * name) into a Person, and a Task's Owners into names. The screens, Claude and the sync use it,
 * so a typed name and a Person are matched the same way everywhere (ADR 0009).
 */
export class People {
  private readonly byId: Map<string, Person>;

  constructor(readonly all: Person[]) {
    this.byId = new Map(all.map((p) => [p.id, p]));
  }

  get(id: string): Person | undefined {
    return this.byId.get(id);
  }

  hasSignedIn(id: string): boolean {
    return Boolean(this.byId.get(id)?.signedInAt);
  }

  /** A Person by id, email, full name, or a first name only one Person has. Undefined when there is no single match. */
  find(input: string): Person | undefined {
    const text = input.trim();
    if (!text) return undefined;
    const exact = this.all.find((p) => p.id === text || same(p.email, text) || same(p.name, text) || same(this.name(p.id), text));
    if (exact) return exact;
    const byFirst = this.all.filter((p) => same(firstName(this.name(p.id)), text));
    return byFirst.length === 1 ? byFirst[0] : undefined;
  }

  /** Like find, but "me" is the asker, and no match is a message that lists who there is. */
  resolve(input: string, meId: string): string {
    if (same(input, "me")) return meId;
    const found = this.find(input);
    if (found) return found.id;
    const names = this.all.map((p) => this.name(p.id)).join(", ");
    const several = this.all.filter((p) => same(firstName(this.name(p.id)), input)).length > 1;
    throw new BoardError(
      "not_found",
      several ? `"${input}" matches more than one person. Use a full name: ${names}.` : `"${input}" isn't on the board. People: ${names}.`,
    );
  }

  /**
   * Owners as given: People's ids, and names typed for anyone else. A typed name that is exactly a
   * Person's name or email becomes that Person, so the same colleague is never on a Task twice.
   */
  owners(ids: string[], names: string[]): { ownerIds: string[]; ownerNames: string[] } {
    const ownerIds = [...new Set(ids)];
    const ownerNames: string[] = [];
    for (const raw of names) {
      const name = raw.trim().replace(/\s+/g, " ");
      if (!name) continue;
      if (name.length > OWNER_NAME_MAX_CHARS) throw new BoardError("invalid", `Keep each Owner's name to ${OWNER_NAME_MAX_CHARS} characters or fewer.`);
      const person = this.all.find((p) => same(p.name, name) || same(this.name(p.id), name) || same(p.email, name));
      if (person) {
        if (!ownerIds.includes(person.id)) ownerIds.push(person.id);
      } else if (!ownerNames.some((n) => same(n, name))) {
        ownerNames.push(name);
      }
    }
    if (ownerNames.length > OWNER_NAMES_MAX) throw new BoardError("invalid", `Type at most ${OWNER_NAMES_MAX} Owners by name.`);
    return { ownerIds, ownerNames };
  }

  name(id: string): string {
    const person = this.byId.get(id);
    return person ? displayName(person.name, person.email) : "Former member";
  }

  names(ids: string[]): string[] {
    return ids.map((id) => this.name(id));
  }

  /** Every Owner of a Task as a name: People first, then typed names. */
  ownerNames(task: Pick<Task, "ownerIds" | "ownerNames">): string[] {
    return [...this.names(task.ownerIds), ...task.ownerNames];
  }
}

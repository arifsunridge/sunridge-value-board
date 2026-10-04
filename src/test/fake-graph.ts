import { Graph } from "@/server/graph";

interface FakeItem {
  id: string;
  fields: Record<string, unknown>;
}

/**
 * Enough of Microsoft Graph's Lists API, in memory, to test the Lists store:
 * list lookup, item reads with simple $filter clauses, create and patch.
 */
export class FakeGraphServer {
  lists = new Map<string, { displayName: string; items: FakeItem[] }>();
  requests: string[] = [];
  private nextId = 1;

  constructor(listNames: string[]) {
    listNames.forEach((name, i) => this.lists.set(`list-${i}`, { displayName: name, items: [] }));
  }

  graph(): Graph {
    return new Graph("site-1", async () => "token", this.fetch);
  }

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    this.requests.push(`${method} ${url.pathname}`);
    const path = url.pathname.replace("/v1.0/sites/site-1", "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;

    if (path === "/lists" && method === "GET") {
      return json({ value: [...this.lists].map(([id, l]) => ({ id, displayName: l.displayName })) });
    }
    const match = path.match(/^\/lists\/([^/]+)\/items(?:\/([^/]+)\/fields)?$/);
    const list = match && this.lists.get(match[1]!);
    if (!list) return json({ error: { code: "itemNotFound" } }, 404);

    if (method === "GET") {
      const filter = url.searchParams.get("$filter");
      return json({ value: list.items.filter((item) => !filter || matches(item.fields, filter)) });
    }
    if (method === "POST") {
      const item = { id: String(this.nextId++), fields: { ...body.fields } };
      list.items.push(item);
      return json(item, 201);
    }
    if (method === "PATCH" && match[2]) {
      const item = list.items.find((i) => i.id === match[2]);
      if (!item) return json({ error: { code: "itemNotFound" } }, 404);
      Object.assign(item.fields, body);
      return json(item.fields);
    }
    return json({ error: { code: "invalidRequest" } }, 400);
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function matches(fields: Record<string, unknown>, filter: string): boolean {
  const clause = (c: string) => {
    const m = c.trim().match(/^fields\/(\w+) (eq|ge) '(.*)'$/);
    if (!m) throw new Error(`Fake Graph can't parse filter: ${c}`);
    const value = String(fields[m[1]!] ?? "");
    const target = m[3]!.replace(/''/g, "'");
    return m[2] === "eq" ? value === target : value >= target;
  };
  return filter.split(" or ").some((part) => part.split(" and ").every(clause));
}

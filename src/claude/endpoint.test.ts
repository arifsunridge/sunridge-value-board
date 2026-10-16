import { beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Board } from "@/board/board";
import { NOW_CAP } from "@/board/model";
import { MemoryStore } from "@/store/memory";
import { demoSeed } from "@/store/seed";
import { handleMcp, protectedResourceMetadata, type EndpointOptions } from "./endpoint";

const baseUrl = "https://board.example.com";
let store: MemoryStore;
let options: EndpointOptions;

beforeEach(() => {
  store = new MemoryStore(demoSeed());
  options = {
    board: new Board(store, () => new Date("2026-10-04T10:00:00Z")),
    enabled: true,
    baseUrl,
    tenantId: "tenant-sunridge",
    clientId: "client-board",
    devTokens: true,
  };
});

/** An MCP client whose requests go straight to the endpoint handler, as Theran unless told otherwise. */
async function connect(token = "dev:m-theran") {
  const client = new Client({ name: "test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: (url, init) => handleMcp(new Request(url, init), options),
  });
  await client.connect(transport);
  return client;
}

type Result = Awaited<ReturnType<Client["callTool"]>>;
const NUMBERS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
/** Titles that fill a Company's Now up to the cap, after the demo seed's 2. */
const NOW_FILLERS = NUMBERS.slice(0, NOW_CAP - 2).map((n) => `Draft plan ${n}`);

const text = (r: Result) => (r.content as { type: string; text: string }[])[0]!.text;
const json = (r: Result) => JSON.parse(text(r));

describe("Claude endpoint: access", () => {
  it("is off unless switched on", async () => {
    options.enabled = false;
    const res = await handleMcp(new Request(`${baseUrl}/mcp`, { method: "POST" }), options);
    expect(res.status).toBe(404);
  });

  it("asks for a Microsoft token, pointing at the metadata and the board's scope", async () => {
    const res = await handleMcp(new Request(`${baseUrl}/mcp`, { method: "POST", body: "{}" }), options);
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe(
      `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource/mcp", scope="${baseUrl}/mcp/Board.ReadWrite"`,
    );
    expect(protectedResourceMetadata(options)).toMatchObject({
      resource: `${baseUrl}/mcp`,
      authorization_servers: ["https://login.microsoftonline.com/tenant-sunridge/v2.0"],
      scopes_supported: [`${baseUrl}/mcp/Board.ReadWrite`],
    });
  });

  it("is for Members only: someone from the HBF team is refused", async () => {
    await expect(connect("dev:h-jordan")).rejects.toThrow();
  });

  it("refuses a bad token with invalid_token", async () => {
    options.devTokens = false;
    const res = await handleMcp(
      new Request(`${baseUrl}/mcp`, { method: "POST", headers: { Authorization: "Bearer nonsense" }, body: "{}" }),
      options,
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain('error="invalid_token"');
  });
});

describe("Claude endpoint: tools", () => {
  it("lists the board's tools, marking reads as read-only", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "add_document_link",
        "add_project_update",
        "company_summary",
        "create_project",
        "create_task",
        "get_project",
        "get_task",
        "join_task",
        "list_companies",
        "list_members",
        "list_projects",
        "list_tasks",
        "make_private",
        "mark_done_with_evidence",
        "set_task_owners",
        "update_project",
        "move_task",
        "my_tasks",
        "remove_task",
        "restore_task",
        "share_task",
        "update_document",
        "update_task",
      ].sort(),
    );
    expect(tools.find((t) => t.name === "list_tasks")?.annotations?.readOnlyHint).toBe(true);
    expect(client.getInstructions()).toContain(`at most ${NOW_CAP} Tasks in Now`);
  });

  it("answers 'what is blocked at HBF?' with names, not IDs", async () => {
    const client = await connect();
    const tasks = json(await client.callTool({ name: "list_tasks", arguments: { company: "hbf", status: "blocked" } }));
    expect(tasks).toEqual([
      expect.objectContaining({ title: "Renew the credit facility", status: "Blocked", owners: ["Jack Example"], waiting_on: "Lender term sheet" }),
    ]);
  });

  it("makes changes as the Member, via Claude, on the Trail", async () => {
    const client = await connect();
    const created = json(
      await client.callTool({
        name: "create_task",
        arguments: { company: "HBF", department: "Operations", area: "Manufacturing", title: "Confirm the new line start date", priority: "medium", owners: ["me"], contributors: ["Arif"] },
      }),
    );
    expect(created).toMatchObject({ area: "Manufacturing", owners: ["Theran Example"], contributors: ["Arif Bayrak"], you_can_change_it: true });

    await client.callTool({ name: "move_task", arguments: { task_id: created.id, status: "blocked", waiting_on: "Plant manager's schedule" } });
    const detail = json(await client.callTool({ name: "get_task", arguments: { task_id: created.id } }));
    expect(detail.waiting_on).toBe("Plant manager's schedule");
    expect(detail.trail.map((e: { what: string }) => e.what)).toEqual([
      "Theran Example added this Task via Claude",
      "Theran Example changed the status from Next to Blocked via Claude",
      "Theran Example changed the note from nothing to “Plant manager's schedule” via Claude",
    ]);
    const raw = await store.listTrail({ taskId: created.id });
    expect(new Set(raw.map((e) => e.via))).toEqual(new Set(["claude"]));
  });

  it("applies the same rules as the screen, as messages Claude can act on", async () => {
    const client = await connect("dev:m-hugues");
    const refused = await client.callTool({ name: "update_task", arguments: { task_id: "t-1", priority: "low" } });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain("Only this Task's Owners and Contributors can change it");

    const longTitle = await client.callTool({
      name: "create_task",
      arguments: { company: "HBF", department: "Finance", title: "one two three four five six seven eight nine", priority: "low", owners: ["me"] },
    });
    expect(text(longTitle)).toBe("Keep the title to 8 words or fewer.");

    const unknown = await client.callTool({ name: "list_tasks", arguments: { company: "Acme" } });
    expect(text(unknown)).toBe('No company called "Acme". Companies: HBF, Sunridge.');

    const notMember = await client.callTool({
      name: "create_task",
      arguments: { company: "HBF", department: "Finance", title: "Draft the lender update", priority: "low", owners: ["plant manager"] },
    });
    expect(text(notMember)).toContain(`"plant manager" isn't on the board`);
  });

  it("keeps Projects, typed Owners and finished work with its evidence", async () => {
    const client = await connect();
    const project = json(
      await client.callTool({
        name: "create_project",
        arguments: { company: "HBF", department: "Innovation & efficiency", area: "Systems & tools", name: "Example app", owner: "me", phase: "building", repository: "example-org/example-app" },
      }),
    );
    expect(project).toMatchObject({ name: "Example app", owner: "Theran Example", phase: "Building", area: "Systems & tools" });

    const task = json(
      await client.callTool({
        name: "create_task",
        arguments: { company: "HBF", department: "Operations", project: "Example app", title: "Ship the example app", priority: "medium", owner_names: ["Example Colleague"] },
      }),
    );
    expect(task).toMatchObject({ project: "Example app", area: "Systems & tools", owners: ["Example Colleague"], you_can_change_it: true });

    const done = json(
      await client.callTool({
        name: "mark_done_with_evidence",
        arguments: { task_id: task.id, evidence_name: "Release notes", evidence_url: "https://example.com/notes", project_update: "First version is live." },
      }),
    );
    expect(done).toMatchObject({ task: { status: "Done" }, document: { name: "Release notes", status: "Final" }, project_update: "First version is live." });

    const detail = json(await client.callTool({ name: "get_project", arguments: { project: "Example app" } }));
    expect(detail).toMatchObject({ progress: "1 of 1 Tasks done", updates: [expect.objectContaining({ by: "Theran Example", text: "First version is live." })] });

    const owners = json(await client.callTool({ name: "set_task_owners", arguments: { task_id: task.id, owners: [] } }));
    expect(owners).toMatchObject({ owners: [], needs_an_owner: true });
  });

  it("refuses one more Task in Now than the cap", async () => {
    const client = await connect();
    for (const title of NOW_FILLERS) {
      await client.callTool({ name: "create_task", arguments: { company: "HBF", department: "Strategic planning", title, priority: "low", owners: ["me"], status: "now" } });
    }
    const extra = await client.callTool({ name: "move_task", arguments: { task_id: "t-2", status: "now" } });
    expect(text(extra)).toBe(`HBF already has ${NOW_CAP} Tasks in Now. Move one out first.`);
  });

  it("gives the Partner summary", async () => {
    const client = await connect("dev:m-philipp");
    const summary = json(await client.callTool({ name: "company_summary", arguments: { company: "HBF" } }));
    expect(summary.needs_attention[0]).toMatchObject({ title: "Renew the credit facility", you_can_change_it: false });
  });
});

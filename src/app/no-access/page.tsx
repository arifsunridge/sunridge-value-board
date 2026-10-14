import { config } from "@/server/config";

const WHY: Record<string, string> = {
  signin: "Open the board from the HBF Portal, so it knows who you are.",
  no_access: "You don’t have access to the Value Board yet. A portal admin can give it to you.",
  audience: "The Value Board is for Sunridge, and for company managers Sunridge has added.",
  portal_unreachable: "The board couldn’t reach the HBF Portal to check your access. Try again in a minute.",
};

export default async function NoAccess({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  return (
    <main className="narrow">
      <h1>Sunridge Value Board</h1>
      <p>{WHY[reason ?? ""] ?? WHY.no_access}</p>
      <p>
        <a className="button" href={config().PORTAL_URL}>
          Go to the HBF Portal
        </a>
      </p>
    </main>
  );
}

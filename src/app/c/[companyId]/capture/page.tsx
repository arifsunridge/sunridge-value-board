import { notFound } from "next/navigation";
import { isMember } from "@/board/model";
import { board } from "@/server/context";
import { config } from "@/server/config";
import { requirePerson } from "@/server/session";
import { CaptureScreen } from "@/ui/CaptureScreen";
import { CompanyViews } from "@/ui/CompanyViews";

export default async function CapturePage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const me = await requirePerson(`/c/${companyId}/capture`);
  if (!isMember(me)) notFound();
  const b = board();
  const [view, people] = await Promise.all([b.board(me, companyId), b.people(me)]);
  // Capture suggests Owners from Members only; the Company team is added to Shared Tasks on the board.
  const members = people.filter(isMember);
  const enabled = config().CAPTURE_ENABLED === "true";
  return (
    <main>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>{view.company.name}: capture from meeting notes</h1>
        <CompanyViews companyId={companyId} current="/capture" />
      </div>
      {enabled ? (
        <CaptureScreen company={view.company} areas={view.areas} members={members} today={b.today()} />
      ) : (
        <p className="banner">Capture is switched off for now. Add Tasks from the board.</p>
      )}
    </main>
  );
}

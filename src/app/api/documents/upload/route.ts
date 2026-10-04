import { NextResponse, type NextRequest } from "next/server";
import { departmentName, type DocumentStatus } from "@/board/model";
import { BoardError } from "@/board/rules";
import { board, graph } from "@/server/context";
import { config } from "@/server/config";
import { Files, MAX_UPLOAD_BYTES } from "@/server/files";
import { session } from "@/server/session";

const DOCUMENT_STATUSES = new Set(["draft", "in_review", "final"]);

/**
 * Uploads a File to the board's SharePoint library (ADR 0002) and links it to a Task.
 * With documentId, uploads a new Version of an existing File instead.
 */
export async function POST(request: NextRequest) {
  const member = (await session()).member;
  if (!member) return NextResponse.json({ message: "Sign in first." }, { status: 401 });
  if (config().STORE !== "lists") {
    return NextResponse.json({ message: "File upload needs SharePoint, which isn't connected here. Add a link instead." }, { status: 501 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ message: "Choose a file." }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ message: "Files must be 100 MB or smaller." }, { status: 400 });

  const actor = { memberId: member.id, via: "screen" as const };
  const b = board();
  const files = new Files(graph());
  const bytes = new Uint8Array(await file.arrayBuffer());

  try {
    const documentId = form.get("documentId");
    if (typeof documentId === "string" && documentId) {
      const doc = await b.document(documentId);
      if (doc.kind !== "file" || !doc.driveItemId) {
        return NextResponse.json({ message: "Only Files can take a new version." }, { status: 400 });
      }
      await b.checkCanEdit(actor, doc.taskId);
      const uploaded = await files.uploadNewVersion(doc.driveItemId, bytes);
      await b.replaceDocument(actor, doc.id, { url: uploaded.webUrl, driveItemId: uploaded.driveItemId });
      return NextResponse.json({ ok: true });
    }

    const task = await b.checkCanEdit(actor, String(form.get("taskId") ?? ""));
    const company = await b.company(task.companyId);
    const area = task.areaId ? (await b.board(task.companyId)).areas.find((a) => a.id === task.areaId) : undefined;
    const folder = [company.name, departmentName(task.departmentId), ...(area ? [area.name] : [])];
    const uploaded = await files.upload(folder, file.name, bytes);
    const status = String(form.get("status") ?? "draft");
    await b.addDocument(actor, task.id, {
      kind: "file",
      name: uploaded.name,
      url: uploaded.webUrl,
      driveItemId: uploaded.driveItemId,
      status: (DOCUMENT_STATUSES.has(status) ? status : "draft") as DocumentStatus,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof BoardError) return NextResponse.json({ message: error.message }, { status: 400 });
    console.error("Upload failed:", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ message: "The upload didn't reach SharePoint. Try again." }, { status: 502 });
  }
}


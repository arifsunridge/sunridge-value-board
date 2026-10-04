import "server-only";
import type { Graph } from "./graph";

const CHUNK = 320 * 1024 * 12; // Graph requires multiples of 320 KiB.
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export interface UploadedFile {
  driveItemId: string;
  webUrl: string;
  name: string;
}

/** SharePoint folder names can't contain these characters. */
export function safeSegment(value: string): string {
  return value.replace(/["*:<>?/\\|#%]/g, "-").replace(/\s+/g, " ").trim().slice(0, 100) || "Untitled";
}

/**
 * Files live in the board site's document library, never in the app (ADR 0002).
 * Folder: Company / Department or Area. Re-uploading to an existing item adds a SharePoint Version.
 */
export class Files {
  constructor(private readonly graph: Graph) {}

  async upload(folder: string[], fileName: string, bytes: Uint8Array<ArrayBuffer>): Promise<UploadedFile> {
    const path = [...folder.map(safeSegment), safeSegment(fileName)].map(encodeURIComponent).join("/");
    const session = await this.graph.request<{ uploadUrl: string }>(
      "POST",
      `${this.graph.site}/drive/root:/${path}:/createUploadSession`,
      { item: { "@microsoft.graph.conflictBehavior": "rename" } },
    );
    return this.send(session.uploadUrl, bytes);
  }

  /** Upload new content to an existing file. SharePoint keeps the old Version. */
  async uploadNewVersion(driveItemId: string, bytes: Uint8Array<ArrayBuffer>): Promise<UploadedFile> {
    const session = await this.graph.request<{ uploadUrl: string }>(
      "POST",
      `${this.graph.site}/drive/items/${encodeURIComponent(driveItemId)}/createUploadSession`,
      { item: { "@microsoft.graph.conflictBehavior": "replace" } },
    );
    return this.send(session.uploadUrl, bytes);
  }

  private async send(uploadUrl: string, bytes: Uint8Array<ArrayBuffer>): Promise<UploadedFile> {
    if (bytes.length === 0) throw new Error("File is empty.");
    if (bytes.length > MAX_UPLOAD_BYTES) throw new Error("File is too large.");
    let response: Response | undefined;
    for (let start = 0; start < bytes.length; start += CHUNK) {
      response = await this.graph.uploadChunk(uploadUrl, bytes.subarray(start, start + CHUNK), start, bytes.length);
    }
    const item = (await response!.json()) as { id: string; webUrl: string; name: string };
    return { driveItemId: item.id, webUrl: item.webUrl, name: item.name };
  }
}

import { z } from "zod";
import { DEPARTMENTS, DOCUMENT_STATUSES, PRIORITIES, STATUSES } from "@/board/model";

/**
 * One Task proposed for import, as a Member reviews it before anything reaches the board (spec P0.14).
 * Made by `prepare` (the old prototype backup) or `prepareTeamBoard` (the team board artifact),
 * and applied by `applyReview`, from the import screen or the command line.
 */
export const reviewItemSchema = z.object({
  prototypeId: z.string(),
  company: z.string(),
  departmentId: z.enum(DEPARTMENTS.map((d) => d.id) as [string, ...string[]]),
  area: z.string().nullable(),
  title: z.string(),
  originalTitle: z.string(),
  priority: z.enum(PRIORITIES),
  status: z.enum(STATUSES),
  ownerIds: z.array(z.string()),
  contributorIds: z.array(z.string()),
  due: z.string().nullable(),
  /** At most 2 lines and 200 characters. For a Blocked Task, what it is waiting on. */
  note: z.string().optional(),
  documents: z
    .array(
      z.object({
        kind: z.enum(["link", "claude"]),
        name: z.string(),
        url: z.string(),
        status: z.enum(DOCUMENT_STATUSES),
      }),
    )
    .optional(),
  /** Reasons a Member should look at this one before importing it. */
  check: z.array(z.string()),
  /** Only approved items are imported. */
  approved: z.boolean(),
});

export type ReviewItem = z.infer<typeof reviewItemSchema>;
export const reviewFileSchema = z.array(reviewItemSchema).max(2000);

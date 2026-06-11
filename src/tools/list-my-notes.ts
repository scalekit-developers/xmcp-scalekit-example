import { type ToolMetadata } from "xmcp";
import { getSession } from "../lib/scalekit-auth";
import { listNotes } from "../lib/notes-store";

export const metadata: ToolMetadata = {
  name: "list_my_notes",
  description:
    "List notes saved by the authenticated user. Each user only sees their own notes.",
};

export default function listMyNotes(): string {
  const session = getSession();
  const notes = listNotes(session.userId);

  return JSON.stringify(
    {
      userId: session.userId,
      count: notes.length,
      notes,
    },
    null,
    2
  );
}
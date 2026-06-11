import { z } from "zod";
import { type InferSchema, type ToolMetadata } from "xmcp";
import { getSession } from "../lib/scalekit-auth";
import { saveNote } from "../lib/notes-store";

export const schema = {
  content: z.string().min(1).describe("Note text to save for the current user"),
};

export const metadata: ToolMetadata = {
  name: "save_note",
  description:
    "Save a note for the authenticated user. Notes are scoped to the JWT sub claim.",
};

export default function saveNoteTool({
  content,
}: InferSchema<typeof schema>): string {
  const session = getSession();
  const note = saveNote(session.userId, content);

  return JSON.stringify(
    {
      userId: session.userId,
      note,
    },
    null,
    2
  );
}
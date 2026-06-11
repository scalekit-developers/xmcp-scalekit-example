import fs from "fs";
import path from "path";

export interface Note {
  readonly id: string;
  readonly content: string;
  readonly createdAt: string;
}

interface NotesFile {
  readonly [userId: string]: readonly Note[];
}

const DATA_DIR = path.join(process.cwd(), ".data");
const NOTES_PATH = path.join(DATA_DIR, "notes.json");

function readStore(): NotesFile {
  if (!fs.existsSync(NOTES_PATH)) {
    return {};
  }

  const raw = fs.readFileSync(NOTES_PATH, "utf8");
  return JSON.parse(raw) as NotesFile;
}

function writeStore(store: NotesFile): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(NOTES_PATH, JSON.stringify(store, null, 2));
}

export function listNotes(userId: string): readonly Note[] {
  const store = readStore();
  return store[userId] ?? [];
}

export function saveNote(userId: string, content: string): Note {
  const store = readStore();
  const note: Note = {
    id: crypto.randomUUID(),
    content,
    createdAt: new Date().toISOString(),
  };

  const existing = store[userId] ?? [];
  writeStore({
    ...store,
    [userId]: [...existing, note],
  });

  return note;
}
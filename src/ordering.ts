import type { Note, Item } from './notes';

export function orderedNotes(notes: Note[]) {
  return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0) || a.id.localeCompare(b.id));
}

export function orderedItems(items: Item[]) {
  return [...items].sort((a, b) => ((a.sortAt ?? a.createdAt)?.toMillis() ?? 0) - ((b.sortAt ?? b.createdAt)?.toMillis() ?? 0) || a.id.localeCompare(b.id));
}

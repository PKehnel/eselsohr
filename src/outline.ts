import type { Item, ItemLevel, LevelChange } from './notes';
import { orderedItems } from './ordering.ts';

// Legacy booleans remain readable; new writes use the same field with levels 0–2.
export function outlineItems(items: Item[]) {
  let previous = -1;
  return orderedItems(items).map(item => {
    const stored = item.indented === true ? 1 : item.indented || 0;
    const level = Math.min(stored, previous + 1) as ItemLevel;
    previous = level;
    return { ...item, level };
  });
}

export function descendants(items: Item[], id: string) {
  const rows = outlineItems(items);
  const index = rows.findIndex(item => item.id === id);
  if (index < 0) return [];
  let end = index + 1;
  while (end < rows.length && rows[end].level > rows[index].level) end++;
  return rows.slice(index + 1, end);
}

export function levelChanges(items: Item[], id: string, next: ItemLevel): LevelChange[] | null {
  const rows = outlineItems(items);
  const index = rows.findIndex(item => item.id === id);
  if (index < 0 || next < 0 || next > 2 || next > (index ? rows[index - 1].level + 1 : 0)) return null;
  const row = rows[index];
  if (row.level === next) return [];
  const delta = next - row.level;
  const group = [row, ...descendants(items, id)];
  if (group.some(item => item.level + delta > 2)) return null;
  return group.map(item => ({ id: item.id, level: item.level + delta as ItemLevel }));
}

export function deletionPromotions(items: Item[], id: string): LevelChange[] {
  return descendants(items, id).map(item => ({ id: item.id, level: item.level - 1 as ItemLevel }));
}

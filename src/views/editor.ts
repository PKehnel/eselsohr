import type { Item, ItemLevel, ItemPatch, Note, NotePatch } from '../notes';
import { noteScope, sharingLabel } from '../notes';
import { outlineItems, levelChanges } from '../outline';
import { button, element } from './dom';
import { art, iconButtonLabel } from './icons';
import { swipeAction } from './swipe';

export interface EditorActions {
  back: () => void;
  flush: () => void;
  save: (patch: NotePatch, immediate?: boolean) => void;
  saveItem: (id: string, patch: ItemPatch, immediate?: boolean) => void;
  setItemLevel: (id: string, level: ItemLevel) => void;
  newItem: () => string;
  removeItem: (id: string) => Promise<boolean>;
  restore: () => void;
  protects: (itemId: string | null, field: string) => boolean;
  sharing: () => void;
}

export class EditorView {
  readonly root = element('main', 'shell editor');
  private note: Note;
  private title = element('input', 'editor-title');
  private body = element('textarea', 'body-input');
  private pin: HTMLButtonElement;
  private sharing: HTMLElement;
  private restore: HTMLButtonElement;
  private list = element('div', 'checklist');
  private newItem = element('textarea', 'item-input');
  private composingItem: string | null = null;
  private items: Item[] = [];
  private levels = element('dialog', 'level-menu');
  private menuItemId = '';
  private rows = new Map<string, { root: HTMLElement; text: HTMLTextAreaElement; check: HTMLInputElement; options: HTMLButtonElement; remove: HTMLButtonElement }>();
  private resizeWidth = 0;
  private titleHeight = 0;
  private resize = new ResizeObserver(entries => {
    let changed = false;
    for (const entry of entries) {
      if (entry.target === this.root && entry.contentRect.width !== this.resizeWidth) {
        this.resizeWidth = entry.contentRect.width; changed = true;
      }
      if (entry.target === this.title && entry.contentRect.height !== this.titleHeight) {
        this.titleHeight = entry.contentRect.height; changed = true;
      }
    }
    if (changed) this.resizeItems();
  });

  constructor(note: Note, private actions: EditorActions, companion: HTMLElement) {
    this.note = note;
    const nav = element('nav', 'editor-nav'); nav.setAttribute('aria-label', 'Note actions');
    this.pin = button('Pin', 'plain', () => actions.save({ pinned: !this.note.pinned }, true));
    this.restore = button('Restore', 'plain', actions.restore);
    const back = button('‹', 'plain back-button', actions.back); iconButtonLabel(back, 'Back');
    const scope = noteScope(note);
    this.root.dataset.scope = scope;
    this.sharing = button(sharingLabel(note), 'plain editor-scope', actions.sharing);
    this.sharing.setAttribute('aria-haspopup', 'dialog'); this.sharing.setAttribute('aria-label', `Sharing: ${sharingLabel(note)}`);
    nav.append(back, this.sharing, this.pin, this.restore, companion); this.root.append(nav);
    this.title.value = note.title; this.title.placeholder = 'Untitled'; this.title.maxLength = 120; this.title.setAttribute('aria-label', 'Note title');
    this.title.addEventListener('input', () => actions.save({ title: this.title.value }));
    this.title.addEventListener('blur', actions.flush);
    this.title.enterKeyHint = 'next';
    this.title.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); this.focusWriting(); }
    });
    this.root.append(this.title);
    if (note.kind === 'text') {
      this.body.value = note.body; this.body.placeholder = 'Start writing…'; this.body.maxLength = 40000;
      this.body.setAttribute('aria-label', 'Note text');
      this.body.addEventListener('input', () => actions.save({ body: this.body.value }));
      this.body.addEventListener('blur', actions.flush);
      this.root.append(this.body);
    } else {
      this.root.append(this.list);
      const form = element('form', 'add-item');
      const plus = element('span', 'new-item-mark', '+'); plus.setAttribute('aria-hidden', 'true');
      this.newItem.rows = 1; this.newItem.placeholder = 'List item'; this.newItem.maxLength = 1000; this.newItem.enterKeyHint = 'next';
      this.newItem.setAttribute('aria-label', 'New checklist item');
      this.newItem.addEventListener('input', () => {
        this.resizeItems([this.newItem]);
        if (!this.composingItem && !this.newItem.value.trim()) return;
        this.composingItem ??= actions.newItem();
        actions.saveItem(this.composingItem, { text: this.newItem.value });
      });
      this.newItem.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); this.finishItem(); }
      });
      this.newItem.addEventListener('blur', () => this.finishItem());
      form.addEventListener('submit', event => { event.preventDefault(); this.finishItem(); });
      form.append(plus, this.newItem); this.root.append(form);
    }
    this.levels.setAttribute('aria-label', 'List item actions');
    this.levels.addEventListener('click', event => { if (event.target === this.levels) this.levels.close(); });
    this.levels.addEventListener('close', () => {
      if (this.root.isConnected && document.activeElement === document.body) this.rows.get(this.menuItemId)?.options.focus({ preventScroll: true });
    });
    this.root.append(this.levels); this.update(note, []);
    this.resize.observe(this.root);
    this.resize.observe(this.title);
  }

  update(note: Note, items: Item[]) {
    this.note = note; this.items = items;
    this.root.dataset.scope = noteScope(note);
    this.sharing.textContent = sharingLabel(note); this.sharing.setAttribute('aria-label', `Sharing: ${sharingLabel(note)}`);
    items = items.filter(item => item.id !== this.composingItem);
    this.sync(this.title, note.title, null, 'title');
    this.sync(this.body, note.body, null, 'body');
    this.pin.textContent = note.pinned ? 'Unpin' : 'Pin'; this.pin.setAttribute('aria-pressed', String(note.pinned));
    this.pin.hidden = note.state !== 'active'; this.restore.hidden = note.state === 'active';
    const ids = new Set(items.map(item => item.id));
    const resized: HTMLTextAreaElement[] = [];
    for (const [id, row] of this.rows) if (!ids.has(id) && document.activeElement !== row.text && !this.actions.protects(id, 'text')) { row.root.remove(); this.rows.delete(id); }
    let previous: HTMLElement | null = null;
    for (const item of outlineItems(items)) {
      let row = this.rows.get(item.id);
      let needsResize = !row;
      if (!row) {
        const root = element('div', 'check-row');
        const content = element('div', 'check-content');
        const check = element('input'); check.type = 'checkbox'; check.checked = item.checked;
        const text = element('textarea', 'item-input'); text.rows = 1; text.value = item.text; text.maxLength = 1000; text.setAttribute('aria-label', 'Checklist item');
        check.addEventListener('change', () => this.actions.saveItem(item.id, { checked: check.checked }, true));
        text.addEventListener('input', () => { this.labelItem(item.id); this.resizeItems([text]); this.actions.saveItem(item.id, { text: text.value }); });
        text.addEventListener('blur', this.actions.flush);
        text.enterKeyHint = 'next';
        text.addEventListener('keydown', event => {
          if (event.altKey && ['ArrowRight', 'ArrowLeft'].includes(event.key)) { event.preventDefault(); this.setIndent(item.id, event.key === 'ArrowRight'); return; }
          if (event.key !== 'Enter' || event.isComposing) return;
          event.preventDefault(); this.actions.flush();
          (root.nextElementSibling?.querySelector<HTMLTextAreaElement>('.item-input') ?? this.newItem).focus();
        });
        const toggle = element('label', 'check-toggle'); toggle.append(check);
        const options = button('⋯', 'item-options', () => this.chooseActions(item.id));
        options.setAttribute('aria-haspopup', 'dialog');
        const remove = element('button', 'swipe-bin'); remove.type = 'button';
        remove.append(art('bin', '▣'));
        content.append(toggle, text, options); root.append(remove, content);
        row = { root, check, text, options, remove }; this.rows.set(item.id, row);
        swipeAction(root, content, remove, () => { void this.removeItem(item.id); }, { indent: right => this.setIndent(item.id, right) });
      }
      if (this.sync(row.text, item.text, item.id, 'text') || row.root.dataset.level !== String(item.level)) needsResize = true;
      if (!this.actions.protects(item.id, 'checked')) row.check.checked = item.checked;
      this.labelItem(item.id);
      row.root.classList.toggle('indented', item.level > 0);
      row.root.dataset.level = String(item.level);
      row.text.setAttribute('aria-description', ['List item', 'Subitem', 'Nested subitem'][item.level]);
      row.root.classList.toggle('checked', row.check.checked);
      // Keep existing inputs attached while typing; only move a row if its order changed.
      const expected: Element | null = previous ? previous.nextElementSibling : this.list.firstElementChild;
      if (expected !== row.root) this.list.insertBefore(row.root, expected);
      if (needsResize) resized.push(row.text);
      previous = row.root;
    }
    this.resizeItems(resized);
  }

  focusWriting() {
    (this.note.kind === 'text' ? this.body : this.list.querySelector<HTMLTextAreaElement>('.item-input') ?? this.newItem).focus();
  }

  focusItem(id: string) { this.rows.get(id)?.text.focus(); }

  dispose() { this.resize.disconnect(); this.levels.close(); }

  private resizeItems(inputs = [this.newItem, ...[...this.rows.values()].map(row => row.text)]) {
    if (!this.root.isConnected || !inputs.length) return;
    for (const input of inputs) input.style.height = 'auto';
    const heights = inputs.map(input => input.scrollHeight + 2);
    inputs.forEach((input, index) => { input.style.height = `${heights[index]}px`; });
  }

  private labelItem(id: string) {
    const row = this.rows.get(id)!;
    row.check.setAttribute('aria-label', `Done: ${row.text.value || 'Empty item'}`);
    iconButtonLabel(row.options, `Actions: ${row.text.value || 'empty item'}`);
    iconButtonLabel(row.remove, `Remove ${row.text.value || 'empty item'}`);
  }

  private setIndent(id: string, indented: boolean) {
    const item = outlineItems(this.items.filter(item => item.id !== this.composingItem)).find(item => item.id === id);
    if (!item) return;
    const next = item.level + (indented ? 1 : -1);
    if (next >= 0 && next <= 2) this.actions.setItemLevel(id, next as ItemLevel);
  }

  private chooseActions(id: string) {
    const items = this.items.filter(item => item.id !== this.composingItem);
    const current = outlineItems(items).find(item => item.id === id);
    if (!current) return;
    this.menuItemId = id;
    this.levels.replaceChildren();
    for (const [level, text] of ['Item', 'Subitem', 'Nested subitem'].entries()) {
      const choice = button(text, 'plain', () => { this.levels.close(); this.actions.setItemLevel(id, level as ItemLevel); });
      choice.disabled = level === current.level || !levelChanges(items, id, level as ItemLevel);
      this.levels.append(choice);
    }
    const remove = button('Remove', 'plain', () => { void this.removeItem(id); });
    iconButtonLabel(remove, `Remove ${current.text || 'empty item'}`); this.levels.append(remove);
    this.levels.showModal();
  }

  private async removeItem(id: string) {
    const row = this.rows.get(id);
    if (!row || row.remove.disabled) return;
    const focusNext = this.levels.open || row.root.contains(document.activeElement);
    this.levels.close();
    const next = row.root.nextElementSibling?.querySelector<HTMLTextAreaElement>('.item-input') ?? row.root.previousElementSibling?.querySelector<HTMLTextAreaElement>('.item-input') ?? this.newItem;
    // A swiped textarea may still be focused when its deletion snapshot arrives.
    row.text.blur();
    row.options.disabled = row.remove.disabled = true;
    if (!await this.actions.removeItem(id)) row.options.disabled = row.remove.disabled = false;
    else if (focusNext && this.root.isConnected) next.focus({ preventScroll: true });
  }

  private finishItem() {
    if (!this.composingItem) return;
    this.composingItem = null; this.newItem.value = '';
    this.resizeItems([this.newItem]);
    this.update(this.note, this.items); this.actions.flush();
  }

  private sync(input: HTMLInputElement | HTMLTextAreaElement, value: string, itemId: string | null, field: string) {
    if (document.activeElement === input || this.actions.protects(itemId, field) || input.value === value) return false;
    input.value = value;
    return true;
  }
}

import type { Item, Member, Note, NoteFilter, NoteKind, NoteState } from '../notes';
import { noteScope, sharingLabel } from '../notes';
import { orderedNotes } from '../ordering.ts';
import { outlineItems } from '../outline';
import { button, element, heading } from './dom';
import { art, iconButtonLabel, restoreIcon } from './icons';
import { swipeAction } from './swipe';

interface HomeActions {
  open: (id: string) => void;
  create: (kind: NoteKind) => void;
  filter: (filter: NoteFilter) => void;
  navigate: (route: string) => void;
  companion: HTMLElement;
  changeState: (id: string, state: NoteState) => void;
  pin: (id: string, pinned: boolean) => void;
  sharing: (note: Note) => void;
}

export interface HomeContext { search: string; scrollY: number; noteId?: string }

export class HomeView {
  readonly root = element('main', 'shell notebook');
  private list = element('div', 'note-list');
  private search = element('input', 'search');
  private people: HTMLButtonElement;
  private count = element('span', 'member-count');
  private notes: Note[] = [];
  private items = new Map<string, Item[]>();
  private loading = true;
  private dragging = false;
  private menu = element('dialog', 'create-menu');
  private noteMenu = element('dialog', 'note-menu');
  private menuNoteId = '';
  private layout = new ResizeObserver(() => this.layoutCards());

  constructor(readonly state: NoteState, private filter: NoteFilter, private actions: HomeActions, search = '') {
    const { navigate, create, companion } = actions;
    this.people = button('', 'people-link art-button', () => navigate('people'));
    this.people.append(art('people', '♟'), this.count);
    iconButtonLabel(this.people, 'People');
    const label = element('label', 'sr-only', 'Search notes'); label.htmlFor = 'search-notes';
    this.search.id = 'search-notes'; this.search.type = 'search'; this.search.placeholder = 'Search';
    this.search.value = search;
    this.search.addEventListener('input', () => this.renderList());
    const filters = element('div', 'note-filters'); filters.setAttribute('role', 'group'); filters.setAttribute('aria-label', 'Show notes');
    for (const [value, label] of [['all', 'All'], ['shared', 'Shared'], ['private', 'Private']] as const) {
      const choice = button(label, 'filter-choice', () => {
        this.filter = value; actions.filter(value);
        for (const control of filters.querySelectorAll('button')) control.setAttribute('aria-pressed', String(control === choice));
        this.renderList();
      });
      choice.setAttribute('aria-pressed', String(value === filter)); filters.append(choice);
    }
    if (state === 'active') {
      this.root.append(element('h1', 'sr-only', 'Notes'));
      const top = element('header', 'notebook-toolbar');
      top.append(companion, label, this.search, this.people); this.root.append(top);
    } else {
      const back = button('‹', 'plain back-button', () => navigate('')); iconButtonLabel(back, 'Back');
      this.root.append(back, heading('Bin', undefined, companion), label, this.search);
    }
    this.root.append(filters, this.list);
    this.noteMenu.setAttribute('aria-label', 'Note actions');
    this.noteMenu.addEventListener('click', event => { if (event.target === this.noteMenu) this.noteMenu.close(); });
    this.noteMenu.addEventListener('close', () => {
      if (this.root.isConnected && document.activeElement === document.body) {
        (this.noteControl(this.menuNoteId, '.note-options') ?? this.list.querySelector<HTMLButtonElement>('.note-row') ?? this.search).focus({ preventScroll: true });
      }
    });
    this.root.append(this.noteMenu);
    if (state === 'active') {
      const dock = element('nav', 'notebook-dock'); dock.setAttribute('aria-label', 'Notebook actions');
      const add = button('+', 'add-note', () => {
        this.menu.showModal();
        this.menu.querySelector<HTMLButtonElement>('.create-choice')?.focus({ preventScroll: true });
      });
      iconButtonLabel(add, 'Add'); add.setAttribute('aria-haspopup', 'dialog');
      const bin = button('', 'art-button bin-link', () => navigate('bin'));
      bin.append(art('bin', '▣')); iconButtonLabel(bin, 'Bin');
      dock.append(add, bin); this.root.append(dock);
      this.menu.setAttribute('aria-label', 'Add a note');
      const choices = element('div', 'create-choices');
      for (const [kind, symbol, text] of [['checklist', '☑', 'List'], ['text', 'Tt', 'Text']] as const) {
        const choice = button('', 'create-choice', () => { this.menu.close(); create(kind); });
        choice.setAttribute('aria-label', text);
        const icon = element('span', 'choice-icon', symbol); icon.setAttribute('aria-hidden', 'true');
        const title = element('span', 'choice-title'); title.append(icon, document.createTextNode(text));
        choice.append(title); choices.append(choice);
      }
      const close = button('×', 'add-note close-menu', () => this.menu.close()); iconButtonLabel(close, 'Close');
      this.menu.append(choices, close);
      this.menu.addEventListener('click', event => { if (event.target === this.menu) this.menu.close(); });
      this.root.append(this.menu);
    }
  }

  update(notes: Note[], members: Member[], items: Map<string, Item[]>, loading: boolean) {
    this.notes = notes; this.items = items; this.loading = loading;
    const count = members.filter(member => member.active).length;
    this.count.textContent = String(count);
    iconButtonLabel(this.people, `People, ${count} members`);
    if (!this.dragging) this.renderList();
  }

  dispose() { this.layout.disconnect(); }

  context(): HomeContext {
    return { search: this.search.value, scrollY: window.scrollY, noteId: document.activeElement?.closest<HTMLElement>('.note-swipe')?.dataset.noteId };
  }

  clearSearch() { this.search.value = ''; }

  restoreContext(context: HomeContext) {
    (context.noteId && this.noteControl(context.noteId, '.note-row') || this.root).focus({ preventScroll: true });
    window.scrollTo(0, context.scrollY);
  }

  private renderList() {
    const focused = document.activeElement;
    const cards = [...this.list.querySelectorAll<HTMLElement>('.note-swipe')];
    const focusedCard = cards.find(card => card.contains(focused));
    const focusedId = focusedCard?.dataset.noteId;
    const focusedIndex = focusedCard ? cards.indexOf(focusedCard) : 0;
    const restoreFocus = () => {
      if (!focusedId) return;
      const remaining = this.list.querySelectorAll<HTMLElement>('.note-swipe');
      const target = this.noteControl(focusedId, focused?.matches('.note-options') ? '.note-options' : '.note-row') ??
        remaining[Math.min(focusedIndex, remaining.length - 1)]?.querySelector<HTMLElement>('.note-row') ?? this.search;
      target.focus({ preventScroll: true });
    };
    const scrollY = window.scrollY;
    const term = this.search.value.trim().toLocaleLowerCase();
    const notes = orderedNotes(this.notes).filter(note => (this.filter === 'all' || noteScope(note) === this.filter) && (this.state === 'active' ? !!term || note.state === 'active' : note.state !== 'active') && [note.title, note.body, ...(this.items.get(note.id) ?? []).map(item => item.text)].join('\n').toLocaleLowerCase().includes(term));
    this.layout.disconnect();
    this.list.replaceChildren();
    if (!notes.length) {
      this.list.append(element('p', 'empty', this.loading ? 'Opening notes…' : term ? 'No notes found.' : this.state === 'active' ? 'No notes yet.' : 'Bin is empty.'));
      window.scrollTo(0, scrollY);
      restoreFocus();
      return;
    }
    for (const pinned of [true, false]) {
      const group = notes.filter(note => note.pinned === pinned);
      if (!group.length) continue;
      const section = element('section', 'note-section');
      const label = pinned ? 'Pinned' : this.state !== 'active' ? 'Notes in bin' : 'Notes';
      const title = element('h2', pinned || this.state !== 'active' ? 'group-label' : 'sr-only', label); title.id = `notes-${pinned ? 'pinned' : 'other'}`;
      section.setAttribute('aria-labelledby', title.id);
      const grid = element('div', 'note-grid'); section.append(title, grid);
      for (const note of group) {
        const wrapper = element('div', 'note-swipe'); wrapper.dataset.noteId = note.id; wrapper.dataset.scope = noteScope(note);
        const row = button('', 'note-row', () => this.actions.open(note.id));
        row.append(element('span', 'note-title', note.title || 'Untitled'));
        row.append(element('span', 'scope-label', noteScope(note) === 'private' ? 'Private' : `Shared · ${sharingLabel(note)}`));
        if (this.state === 'active' && note.state !== 'active') row.append(element('span', 'bin-label', 'Bin'));
        const snippet = element('span', 'note-snippet');
        if (note.kind === 'text') snippet.textContent = note.body.split('\n').filter(Boolean).slice(0, 4).join('\n').slice(0, 320) || 'Empty note';
        else {
          snippet.classList.add('checklist-snippet');
          const items = outlineItems(this.items.get(note.id) ?? []);
          const preview = items.slice(0, 7);
          for (const item of preview) {
            const line = element('span', `mini-check${item.checked ? ' done-text' : ''}${item.level ? ' indented' : ''}`);
            line.dataset.level = String(item.level);
            const box = element('span', `mini-box${item.checked ? ' done' : ''}`); box.setAttribute('aria-hidden', 'true');
            line.append(box, document.createTextNode(item.text || 'Empty item')); snippet.append(line);
          }
          if (items.length > preview.length) snippet.append(element('span', 'note-more', `+ ${items.length - preview.length} more`));
          if (!items.length) snippet.textContent = 'Checklist';
          if (items.length) {
            const progress = element('span', 'note-progress', `${items.filter(item => item.checked).length}/${items.length} done`);
            row.append(progress);
          }
        }
        row.insertBefore(snippet, row.querySelector('.note-progress')); wrapper.append(row);
        const options = button('⋯', 'note-options', () => this.openNoteMenu(note));
        iconButtonLabel(options, `Actions: ${note.title || 'Untitled'}`); options.setAttribute('aria-haspopup', 'dialog');
        wrapper.append(options);
        {
          const restoring = note.state !== 'active';
          const act = () => this.actions.changeState(note.id, restoring ? 'active' : 'archived');
          const bin = element('button', 'swipe-bin'); bin.type = 'button';
          bin.append(restoring ? restoreIcon() : art('bin', '▣'));
          iconButtonLabel(bin, `${restoring ? 'Restore' : 'Move to bin:'} ${note.title || 'untitled note'}`);
          wrapper.prepend(bin);
          swipeAction(wrapper, row, bin, () => { act(); this.renderList(); }, { dragging: active => { this.dragging = active; } });
        }
        grid.append(wrapper);
      }
      this.list.append(section);
    }
    this.layoutCards();
    this.layout.observe(this.list);
    for (const card of this.list.querySelectorAll('.note-swipe')) this.layout.observe(card);
    window.scrollTo(0, scrollY);
    restoreFocus();
  }

  private layoutCards() {
    // Dense single-column spans fill the shortest column without reordering DOM.
    // Keep existing spans during measurement so a scrolled page never collapses.
    for (const grid of this.list.querySelectorAll<HTMLElement>('.note-grid')) {
      const cards = [...grid.children] as HTMLElement[];
      const heights = cards.map(card => Math.ceil(card.getBoundingClientRect().height));
      for (const [index, card] of cards.entries()) {
        card.style.gridRowEnd = `span ${heights[index] + 12}`;
      }
    }
  }

  private noteControl(id: string, selector: string) {
    return this.list.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(id)}"]`)?.querySelector<HTMLElement>(selector);
  }

  private openNoteMenu(note: Note) {
    this.menuNoteId = note.id;
    const restoring = note.state !== 'active';
    this.noteMenu.replaceChildren(element('h2', 'note-menu-title', note.title || 'Untitled'));
    const close = (action: () => void) => () => { this.noteMenu.close(); action(); };
    this.noteMenu.append(
      button(note.pinned ? 'Unpin' : 'Pin', 'plain menu-choice', close(() => this.actions.pin(note.id, !note.pinned))),
      button(restoring ? 'Restore' : 'Move to bin', 'plain menu-choice', close(() => this.actions.changeState(note.id, restoring ? 'active' : 'archived'))),
    );
    this.noteMenu.append(button('Sharing', 'plain menu-choice', close(() => this.actions.sharing(note))));
    this.noteMenu.showModal();
  }
}

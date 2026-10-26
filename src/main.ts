import type { User } from 'firebase/auth';
import { Timestamp, type Unsubscribe } from 'firebase/firestore';
import { initializeBackend } from './firebase';
import { logOut, loginError, observeAuth, signIn } from './auth';
import { NotesRepository, noteSharing } from './notes';
import type { Item, ItemLevel, ItemPatch, Member, Note, NoteFilter, NoteKind, NotePatch, NoteState, Sharing } from './notes';
import { deletionPromotions, levelChanges } from './outline';
import { DraftSaves } from './saves';
import { AccountSession } from './account-session';
import type { SaveChange } from './saves';
import { button, element, heading, status } from './views/dom';
import { loginView } from './views/login';
import { HomeView } from './views/home';
import type { HomeContext } from './views/home';
import { EditorView } from './views/editor';
import { PeopleView } from './views/people';
import { SaveCompanion } from './views/save-companion';
import { DonkeyMotion } from './views/donkey-motion';
import { donkeySettings } from './views/donkey-settings';
import { SharingDialog } from './views/sharing';
import './styles.css';

const host = document.querySelector<HTMLDivElement>('#app')!;
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {
    // Normal connected use still works if this browser cannot install a worker.
  });
}

class App {
  private user: User | null = null;
  private repository: NotesRepository | null = null;
  private membership: Unsubscribe | null = null;
  private subscriptions: Unsubscribe[] = [];
  private checklistSubscriptions = new Map<string, Unsubscribe>();
  private notes: Note[] = [];
  private members: Member[] = [];
  private items = new Map<string, Item[]>();
  private newItems = new Map<string, { noteId: string; item: Item; acknowledged: boolean }>();
  private access = false;
  private generation = 0;
  private loading = true;
  private fromCache = true;
  private pendingNotes = false;
  private pendingItems = new Set<string>();
  private cachedItems = new Set<string>();
  private view: HomeView | EditorView | PeopleView | null = null;
  private openedNote: string | null = null;
  private focusCreatedNote: string | null = null;
  private noteFilter: NoteFilter = 'all';
  private homeContexts = new Map<NoteState, HomeContext>();
  private renderedRoute: string | null = null;
  private feedback = status();
  private saveBar = element('div', 'save-bar');
  private companion = new SaveCompanion(route => this.navigate(route), () => { void this.signOut(); }, () => {
    this.motionSettings?.close(); this.motionSettings = donkeySettings(this.motion);
  }, () => this.retrySave());
  private motion = new DonkeyMotion();
  private motionSettings?: HTMLDialogElement;
  private sharing?: SharingDialog;
  private sharingNoteId?: string;
  private revokedNotes = new Set<string>();
  private completionCandidates = new Map<string, number>();
  private completionVersion = 0;
  private binCandidates = new Map<string, number>();
  private binVersion = 0;
  private undoBar = element('div', 'undo-bar');
  private undoTimer?: ReturnType<typeof setTimeout>;
  private undoRemaining = 0;
  private undoStarted = 0;
  private undoVersion = 0;
  private retry = button('Retry', 'plain', () => this.retrySave());
  private updateApp = button('Update app', 'plain', () => this.reloadApp());
  private updateNeeded = false;
  private reloading = false;
  private saves = new DraftSaves(change => this.saveChanged(change));
  private session?: AccountSession;
  private operations = 0;
  private error = '';
  private connectionFailed = false;
  private signOutBlocked = false;
  private openingTimer?: ReturnType<typeof setTimeout>;

  constructor(private backend: NonNullable<ReturnType<typeof initializeBackend>>) {
    this.saveBar.append(this.feedback, this.retry, this.updateApp);
    for (const event of ['pointerenter', 'pointerdown', 'focusin']) this.undoBar.addEventListener(event, () => this.pauseUndo());
    for (const event of ['pointerleave', 'pointerup', 'pointercancel', 'focusout']) this.undoBar.addEventListener(event, () => queueMicrotask(() => this.resumeUndo()));
    window.addEventListener('hashchange', () => { this.saves.flush(); if (this.access) this.renderRoute(); });
    window.addEventListener('beforeunload', event => { if (!this.reloading && (this.saves.pending || this.operations)) { this.saves.flush(); event.preventDefault(); event.returnValue = ''; } });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { this.saves.flush(); this.pauseUndo(); } else this.resumeUndo();
    });
    window.addEventListener('online', () => this.showSaveStatus());
    window.addEventListener('offline', () => this.showSaveStatus());
    window.addEventListener('storage', event => {
      if (this.signOutBlocked && this.user && event.key?.startsWith(`${this.backend.cacheKey}/drafts/${this.user.uid}`)) this.showSaveStatus();
    });
  }

  async start() {
    this.backend.onCacheClose(() => {
      if (!this.repository) return;
      this.clearGroup();
      if (this.user) this.message('This session ended in another Eselsohr window. Sign out and sign in again to continue.', true);
    });
    this.opening();
    try { await this.backend.ready; }
    catch { this.message('Could not open sign-in on this device.', true); return; }
    observeAuth(this.backend.auth, user => this.authChanged(user));
  }

  private authChanged(user: User | null) {
    const previousUser = this.user;
    this.clearGroup(); this.user = user;
    if (user && this.backend.closed) { location.reload(); return; }
    if (!user) {
      const generation = this.generation;
      const showLogin = () => {
        if (generation !== this.generation) return;
        host.replaceChildren(loginView(async (email, password) => {
          try { await signIn(this.backend.auth, email, password); return null; }
          catch (error) { return loginError(error); }
        }));
      };
      if (previousUser) {
        this.opening();
        void this.backend.clearCache().then(showLogin).catch(() => {
          if (generation === this.generation) this.message('Signed out. Close other Eselsohr tabs, then reopen to finish clearing device storage.');
        });
      } else showLogin();
      return;
    }
    this.opening();
    this.repository = new NotesRepository(this.backend.db, user.uid, this.backend.membershipDb);
    this.session = new AccountSession(`${this.backend.cacheKey}/accounts/${user.uid}`,
      () => this.busy(), () => this.saves.flush(), paused => {
        host.inert = paused;
        for (const dialog of host.querySelectorAll('dialog')) dialog.inert = paused;
      });
    const generation = this.generation;
    void this.session.ready.then(() => { if (generation === this.generation) this.watchMembership(); });
  }

  private watchMembership() {
    if (!this.repository) return;
    const generation = this.generation;
    let checking: Promise<void> | undefined;
    this.membership = this.repository.ownMembership((member, cached) => {
      if (generation !== this.generation) return;
      if (!member?.active) {
        if (cached && !this.access) return;
        // Even a non-cache missing snapshot can come from stale cross-tab state.
        if (!checking) checking = this.confirmMembership(generation).finally(() => { checking = undefined; });
        return;
      }
      if (!cached) localStorage.setItem(`${this.backend.cacheKey}/member`, this.user!.uid);
      // Offline access is limited to the last server-approved signed-in account.
      if (!this.access && (!cached || localStorage.getItem(`${this.backend.cacheKey}/member`) === this.user!.uid)) this.openGroup();
    }, error => { if (generation === this.generation) this.listenerFailed(error); });
  }

  private async confirmMembership(generation: number) {
    try {
      const active = await this.repository!.checkMembership();
      if (generation !== this.generation) return;
      if (!active) {
        this.accessLost('This account does not have access to the notebook. Ask the person who set it up.');
      } else {
        localStorage.setItem(`${this.backend.cacheKey}/member`, this.user!.uid);
        if (!this.access) this.openGroup();
      }
    } catch (error) {
      if (generation === this.generation) this.listenerFailed(error as Error);
    }
  }

  private async openGroup() {
    if (!this.repository) return;
    this.access = true; const generation = this.generation;
    const repo = this.repository;
    try { this.revokedNotes = new Set(JSON.parse(localStorage.getItem(`${this.backend.cacheKey}/revoked/${this.user!.uid}`) ?? '[]')); }
    catch { this.revokedNotes.clear(); }
    this.saves = new DraftSaves(change => this.saveChanged(change), `${this.backend.cacheKey}/drafts/${this.user!.uid}`);
    await this.saves.restore(key => {
      const [kind, noteId, itemId] = key.split('/');
      if (kind === 'note') return fields => this.writeNote(repo, noteId, fields, generation);
      const item: Item = { id: itemId, text: '', checked: false, createdBy: this.user!.uid, updatedBy: this.user!.uid, createdAt: Timestamp.now(), updatedAt: null };
      this.newItems.set(itemId, { noteId, item, acknowledged: false });
      return async fields => {
        await repo.restoreItem(noteId, itemId, fields);
        this.newItems.delete(itemId);
      };
    });
    if (generation !== this.generation) return;
    this.subscriptions.push(this.repository.members(members => { if (generation !== this.generation) return; this.members = members; this.updateView(); }, error => { if (generation === this.generation) this.listenerFailed(error); }));
    this.subscriptions.push(this.repository.notes(snapshot => {
      if (generation !== this.generation) return;
      if (!snapshot.fromCache && !snapshot.pending) {
        const allowed = new Set(snapshot.records.map(note => note.id));
        for (const note of this.notes) if (!allowed.has(note.id)) this.forgetNote(note.id);
        this.saves.retainNotes(allowed);
        for (const id of allowed) this.revokedNotes.delete(id);
        this.persistRevocations();
      }
      this.notes = snapshot.records.filter(note => !this.revokedNotes.has(note.id)); this.fromCache = snapshot.fromCache; this.pendingNotes = snapshot.pending;
      this.loading = false;
      this.syncChecklistListeners(); this.updateView(); this.showSaveStatus();
    }, error => { if (generation === this.generation) this.listenerFailed(error); }));
  }

  private syncChecklistListeners() {
    // Home search includes the bin, including matches in checklist row text.
    const wanted = new Set(this.notes.filter(note => note.kind === 'checklist' && !note.creating).map(note => note.id));
    for (const [id, unsubscribe] of this.checklistSubscriptions) if (!wanted.has(id)) { unsubscribe(); this.checklistSubscriptions.delete(id); this.items.delete(id); this.pendingItems.delete(id); this.cachedItems.delete(id); }
    const generation = this.generation;
    for (const id of wanted) if (!this.checklistSubscriptions.has(id)) {
      this.cachedItems.add(id);
      this.checklistSubscriptions.set(id, this.repository!.items(id, snapshot => {
        if (generation !== this.generation) return;
        this.items.set(id, snapshot.records);
        if (snapshot.pending) this.pendingItems.add(id); else this.pendingItems.delete(id);
        if (snapshot.fromCache) this.cachedItems.add(id); else this.cachedItems.delete(id);
        this.updateView();
        for (const item of snapshot.records) if (this.newItems.get(item.id)?.acknowledged) this.newItems.delete(item.id);
      }, error => {
        if (generation !== this.generation) return;
        if ((error as { code?: string }).code === 'permission-denied') {
          this.forgetNote(id); this.notes = this.notes.filter(note => note.id !== id);
          this.syncChecklistListeners(); this.updateView();
        } else this.listenerFailed(error);
      }));
    }
  }

  private folder(): NoteState {
    return ['#/bin', '#/archived', '#/trash'].includes(location.hash) ? 'archived' : 'active';
  }

  private navigate(route = '') { location.hash = route ? `/${route}` : '/'; }

  private renderRoute() {
    if (!this.repository || !this.user) return;
    if (this.loading && !this.view) return;
    const route = location.hash.replace(/^#\/?/, '');
    if (this.view instanceof HomeView) this.homeContexts.set(this.view.state, this.view.context());
    if (this.view instanceof EditorView || this.view instanceof HomeView) this.view.dispose();
    const storedBack = history.state?.eselsohrBack;
    const backRoute = typeof storedBack === 'string' && /^(?:bin|archived|trash|people|notes\/[^/]+)?$/.test(storedBack) && storedBack !== route ? storedBack :
      this.view instanceof HomeView ? this.view.state === 'active' ? '' : 'bin' : route === 'people' ? this.renderedRoute ?? undefined : undefined;
    this.renderedRoute = route;
    this.companion.close(); this.motionSettings?.close(); this.sharing?.dispose(); this.sharing = undefined;
    this.motion.attach(null);
    this.openedNote = route.startsWith('notes/') ? route.slice(6) : null;
    if (this.openedNote) {
      const note = this.currentNotes().find(note => note.id === this.openedNote);
      if (!note) { this.view = null; this.mountMessage(this.loading ? 'Opening note…' : 'This note is unavailable.'); return; }
      const id = note.id;
      const parent = backRoute ?? (note.state === 'active' ? '' : 'bin');
      history.replaceState({ ...history.state, eselsohrBack: parent }, '');
      this.view = new EditorView(note, {
        back: () => this.navigate(parent),
        flush: () => { this.saves.flush(); this.updateView(); },
        save: (patch, immediate) => this.saveNote(id, patch, immediate),
        saveItem: (itemId, patch, immediate) => this.saveItem(id, itemId, patch, immediate),
        setItemLevel: (itemId, level) => this.setItemLevel(id, itemId, level),
        protects: (itemId, field) => this.saves.protects(itemId ? `item/${id}/${itemId}` : `note/${id}`, field),
        newItem: () => this.reserveItem(id),
        removeItem: itemId => this.removeItem(id, itemId),
        restore: () => this.changeNoteState(id, 'active'),
        sharing: () => this.openSharing(this.notes.find(note => note.id === id)),
      }, this.companion.root);
    } else if (route === 'people') {
      const parent = backRoute ?? '';
      history.replaceState({ ...history.state, eselsohrBack: parent }, '');
      this.view = new PeopleView(() => this.navigate(parent), () => { void this.signOut(); }, this.companion.root);
    }
    else this.view = new HomeView(this.folder(), this.noteFilter, {
      open: id => this.navigate(`notes/${id}`), create: kind => { void this.createNote(kind); },
      filter: value => { this.noteFilter = value; },
      navigate: route => this.navigate(route), companion: this.companion.root,
      changeState: (id, state) => this.changeNoteState(id, state), pin: (id, pinned) => this.saveNote(id, { pinned }, true),
      sharing: note => this.openSharing(note),
    }, this.homeContexts.get(this.folder())?.search);
    this.mount(this.view.root); this.syncChecklistListeners(); this.updateView();
    if (this.view instanceof HomeView) {
      const view = this.view, context = this.homeContexts.get(view.state);
      if (context) requestAnimationFrame(() => { if (this.view === view) view.restoreContext(context); });
    }
    if (this.view instanceof EditorView && this.openedNote === this.focusCreatedNote) { this.focusCreatedNote = null; this.view.focusWriting(); }
  }

  private changeNoteState(id: string, state: NoteState) {
    const previous = this.currentNotes().find(note => note.id === id)?.state;
    if (!previous || previous === state || !this.repository) return;
    const save = (next: NoteState) => {
      if (next === 'active') this.binCandidates.delete(id); else this.binCandidates.set(id, ++this.binVersion);
      this.saveNote(id, { state: next }, true);
    };
    save(state);
    if (state === 'active') return;
    this.offerUndo('Moved to bin', async () => { save(previous); return true; });
  }

  private openSharing(note?: Note) {
    if (!this.user || !this.repository || !note) return;
    this.saves.flush(); this.sharing?.dispose();
    const repo = this.repository, generation = this.generation;
    const previous = noteSharing(note);
    const dialog = new SharingDialog({
      uid: this.user.uid, creator: note.createdBy,
      sharing: previous, members: this.members,
      ...(note.createdBy === this.user.uid ? { save: async (sharing: Sharing) => {
          if (!navigator.onLine || this.fromCache || this.connectionFailed) {
            dialog.showError('Could not update sharing. Check your connection and try again.'); return false;
          }
          this.operations++; this.showSaveStatus();
          try { await repo.setSharing(note.id, sharing, previous); return generation === this.generation; }
          catch (error) {
            dialog.showError(error instanceof Error && error.message.startsWith('Sharing changed') ? error.message : 'Could not update sharing. Check your connection and try again.');
            return false;
          } finally { if (generation === this.generation) { this.operations--; this.showSaveStatus(); } }
        } } : {}),
      closed: () => { dialog.root.remove(); if (this.sharing === dialog) this.sharing = undefined; },
    });
    this.sharing = dialog;
    this.sharingNoteId = note.id;
    this.view?.root.append(dialog.root); dialog.root.showModal();
  }

  private forgetNote(id: string) {
    this.revokedNotes.add(id); this.persistRevocations();
    if (this.sharingNoteId === id) { this.sharing?.dispose(); this.sharing = undefined; this.sharingNoteId = undefined; }
    this.saves.discard(`note/${id}`); this.saves.discard(`item/${id}/`);
    for (const [itemId, item] of this.newItems) if (item.noteId === id) this.newItems.delete(itemId);
    this.items.delete(id); this.pendingItems.delete(id); this.cachedItems.delete(id);
    this.clearUndo();
  }

  private persistRevocations() {
    if (!this.user) return;
    try {
      const key = `${this.backend.cacheKey}/revoked/${this.user.uid}`;
      if (this.revokedNotes.size) localStorage.setItem(key, JSON.stringify([...this.revokedNotes])); else localStorage.removeItem(key);
    } catch { this.error = 'Could not update device access history. Keep this page open until connected.'; }
  }

  private offerUndo(text: string, action: () => Promise<boolean>) {
    const duration = 2500;
    this.clearUndo();
    const version = this.undoVersion;
    const undo = button('Undo', 'plain', async () => {
      this.pauseUndo(); undo.disabled = true;
      const completed = await action();
      if (version !== this.undoVersion) return;
      if (completed) this.clearUndo();
      else { undo.disabled = false; this.undoRemaining = duration; this.resumeUndo(); }
    });
    this.undoBar.append(status(text), undo);
    this.undoBar.hidden = false;
    this.undoRemaining = duration; this.resumeUndo();
  }

  private saveNote(id: string, patch: NotePatch, immediate = false) {
    const repo = this.repository!; const generation = this.generation;
    this.saves.schedule(`note/${id}`, patch, fields => this.writeNote(repo, id, fields, generation), immediate);
    if ('pinned' in patch || 'state' in patch) this.updateView();
  }

  private async writeNote(repo: NotesRepository, id: string, fields: NotePatch, generation: number) {
    const candidate = this.binCandidates.get(id);
    await repo.save(id, fields);
    if (generation === this.generation && fields.state === 'archived' && candidate !== undefined && candidate === this.binCandidates.get(id)) {
      this.binCandidates.delete(id);
      const bin = this.view instanceof HomeView && this.view.root.querySelector<HTMLElement>('.bin-link');
      if (bin) this.motion.bin(bin);
    }
  }

  private clearUndo() {
    this.undoVersion++;
    clearTimeout(this.undoTimer); this.undoTimer = undefined;
    this.undoRemaining = 0;
    this.undoBar.replaceChildren(); this.undoBar.hidden = true;
  }

  private pauseUndo() {
    if (this.undoTimer === undefined) return;
    clearTimeout(this.undoTimer); this.undoTimer = undefined;
    this.undoRemaining = Math.max(0, this.undoRemaining - (performance.now() - this.undoStarted));
  }

  private resumeUndo() {
    if (this.undoBar.hidden || this.undoTimer !== undefined || this.undoBar.querySelector('button')?.disabled || document.visibilityState === 'hidden' ||
      this.undoBar.contains(document.activeElement) || this.undoBar.matches(':active') ||
      matchMedia('(hover: hover)').matches && this.undoBar.matches(':hover')) return;
    if (this.undoRemaining <= 0) { this.clearUndo(); return; }
    this.undoStarted = performance.now();
    this.undoTimer = setTimeout(() => this.clearUndo(), this.undoRemaining);
  }

  private currentNotes(): Note[] {
    return this.notes.map(note => ({ ...note, ...this.saves.draft(`note/${note.id}`) }));
  }

  private currentItems(): Map<string, Item[]> {
    const merged = new Map(this.items);
    for (const { noteId, item } of this.newItems.values()) {
      const items = merged.get(noteId) ?? [];
      const existing = items.findIndex(existing => existing.id === item.id);
      // Pending server timestamps can have coarser precision than confirmed rows.
      // Keep the new row at its local position until creation is acknowledged.
      merged.set(noteId, existing < 0 ? [...items, item] : items.map((row, index) => index === existing ? { ...row, createdAt: item.createdAt } : row));
    }
    return new Map([...merged].map(([id, items]) => [id, items.map(item => ({ ...item, ...this.saves.draft(`item/${id}/${item.id}`) }))]));
  }

  private reserveItem(noteId: string) {
    const id = this.repository!.newItemId(noteId);
    const latest = Math.max(0, ...(this.currentItems().get(noteId) ?? []).map(item => (item.sortAt ?? item.createdAt)?.toMillis() ?? 0));
    const item: Item = {
      id, text: '', checked: false, createdBy: this.user!.uid, updatedBy: this.user!.uid,
      createdAt: Timestamp.fromMillis(Math.max(Date.now(), latest + 1)), updatedAt: null,
    };
    this.newItems.set(id, { noteId, item, acknowledged: false });
    return id;
  }

  private saveItem(noteId: string, itemId: string, patch: ItemPatch, immediate = false) {
    const repo = this.repository!;
    const generation = this.generation;
    const key = `${noteId}/${itemId}`;
    if (patch.checked === true && !this.currentItems().get(noteId)?.find(item => item.id === itemId)?.checked) this.completionCandidates.set(key, ++this.completionVersion);
    if (patch.checked === false) this.completionCandidates.delete(key);
    const draft = this.newItems.get(itemId);
    if (draft) Object.assign(draft.item, patch);
    this.saves.schedule(`item/${noteId}/${itemId}`, patch, async fields => {
      const candidate = this.completionCandidates.get(key);
      if (draft && !draft.acknowledged) {
        await repo.addItem(noteId, itemId, fields);
        draft.acknowledged = true;
        if (this.items.get(noteId)?.some(item => item.id === itemId)) this.newItems.delete(itemId);
      } else await repo.saveItem(noteId, itemId, fields);
      if (generation === this.generation && fields.checked === true && candidate !== undefined && candidate === this.completionCandidates.get(key)) {
        this.completionCandidates.delete(key);
        if (this.openedNote === noteId) this.motion.completion();
      }
    }, immediate);
    if ('checked' in patch || 'indented' in patch) this.updateView();
  }

  private setItemLevel(noteId: string, itemId: string, level: ItemLevel) {
    if (!this.repository) return;
    const changes = levelChanges(this.currentItems().get(noteId) ?? [], itemId, level);
    if (!changes?.length) return;
    if (this.operations || changes.some(change => this.newItems.has(change.id))) {
      this.error = 'Let this item finish saving before changing its level.'; this.showSaveStatus(); return;
    }
    const repo = this.repository;
    void this.perform(() => repo.setItemLevels(noteId, changes));
  }

  private async removeItem(noteId: string, itemId: string) {
    if (!this.repository) return false;
    this.saves.flush();
    const rows = this.currentItems().get(noteId) ?? [];
    const item = rows.find(row => row.id === itemId);
    if (!item) return false;
    const promotions = deletionPromotions(rows, itemId);
    if (this.operations || [itemId, ...promotions.map(change => change.id)].some(rowId => ['text', 'checked', 'indented'].some(field => this.saves.protects(`item/${noteId}/${rowId}`, field)))) {
      this.error = 'Let this item finish saving before removing it.'; this.showSaveStatus(); return false;
    }
    const repo = this.repository;
    if (!await this.perform(() => repo.removeItem(noteId, itemId, promotions))) return false;
    this.offerUndo('Item removed', async () => {
      if (this.operations) return false;
      const current = this.currentItems().get(noteId) ?? [];
      // Undo only reverses the level changes this removal made; preserve newer edits.
      const levels = promotions.filter(change => current.some(row => row.id === change.id && row.indented === change.level) && !this.saves.protects(`item/${noteId}/${change.id}`, 'indented'))
        .map(change => ({ id: change.id, level: change.level + 1 as ItemLevel }));
      const restored = await this.perform(() => repo.restoreDeletedItem(noteId, item, levels));
      if (restored && this.openedNote === noteId && this.view instanceof EditorView) this.view.focusItem(itemId);
      return restored;
    });
    return true;
  }

  private saveChanged(change: SaveChange) {
    this.showSaveStatus();
    // Settling releases draft protection; apply any server value it was hiding.
    if (change === 'settled') this.updateView();
  }

  private updateView() {
    if (!this.access || !this.user) return;
    if (!this.view) { if (!this.loading) this.renderRoute(); return; }
    if (this.view instanceof HomeView) this.view.update(this.currentNotes(), this.members, this.currentItems(), this.loading);
    else if (this.view instanceof PeopleView) this.view.update(this.members, this.user.uid);
    else {
      const note = this.currentNotes().find(note => note.id === this.openedNote);
      if (note) this.view.update(note, this.currentItems().get(note.id) ?? []);
      else { this.renderRoute(); return; }
    }
    this.sharing?.update(this.members);
    const inBin = this.folder() !== 'active' || !!this.openedNote && this.currentNotes().some(note => note.id === this.openedNote && note.state !== 'active');
    this.companion.setBin(inBin);
    this.showSaveStatus();
    const decoration = !inBin && navigator.onLine && !this.fromCache && !this.cachedItems.size && !this.connectionFailed && !this.saves.failed && this.saves.durable && !this.error && !this.signOutBlocked && (this.view instanceof HomeView || this.view instanceof EditorView);
    if (decoration && this.motion.root.parentElement !== this.companion.root) this.motion.attach(this.companion.root);
    else if (!decoration) this.motion.attach(null);
  }

  private mount(root: HTMLElement) {
    clearTimeout(this.openingTimer);
    root.append(this.undoBar);
    root.prepend(this.saveBar);
    if (this.backend.useEmulators) root.prepend(element('p', 'dev-label', 'Local emulator · synthetic data'));
    root.tabIndex = -1;
    host.replaceChildren(root); root.focus({ preventScroll: true }); window.scrollTo(0, 0); this.showSaveStatus();
  }

  private mountMessage(text: string) {
    const main = element('main', 'shell'); const back = button('‹', 'plain back-button', () => this.navigate()); back.setAttribute('aria-label', 'Back'); main.append(back, this.companion.root, element('p', 'muted', text)); this.mount(main);
  }

  private message(text: string, signOut = false) {
    clearTimeout(this.openingTimer);
    const main = element('main', 'shell login'); main.append(heading('Eselsohr'), status(text));
    if (signOut) main.append(button('Sign out', 'secondary', () => { void this.signOut(); }));
    host.replaceChildren(main);
  }

  private opening() {
    if (!host.querySelector('.startup')) {
      const main = element('main', 'shell startup'); main.setAttribute('aria-busy', 'true');
      const loading = status('Opening notebook…'); loading.classList.add('sr-only');
      main.append(loading); host.replaceChildren(main);
    }
    clearTimeout(this.openingTimer);
    this.openingTimer = setTimeout(() => host.querySelector('.startup .status')?.classList.remove('sr-only'), 1800);
  }

  private busy() { return this.access && this.loading || this.saves.pending || this.operations > 0 || this.pendingNotes || this.pendingItems.size > 0; }

  private showSaveStatus() {
    const busy = this.busy();
    this.session?.update();
    this.signOutBlocked = this.signOutBlocked && (busy || !!this.user && DraftSaves.hasDrafts(`${this.backend.cacheKey}/drafts/${this.user.uid}`));
    const cached = this.fromCache || this.cachedItems.size > 0 || this.connectionFailed;
    const message = this.saves.failed ? 'Could not save. Your draft is still here.' : !this.saves.durable ? 'Device storage is unavailable. Keep this page open until Saved.' : this.error || (this.signOutBlocked ? 'Let changes in all Eselsohr windows finish saving before signing out.' : !navigator.onLine ? busy ? 'Offline · changes waiting to sync.' : 'Offline · showing saved notes.' : busy ? 'Saving…' : cached ? 'Connecting…' : 'Saved');
    if (this.feedback.textContent !== message) this.feedback.textContent = message;
    this.feedback.classList.toggle('error', this.saves.failed || !!this.error || this.signOutBlocked);
    this.retry.hidden = !this.saves.failed && !this.connectionFailed;
    this.updateApp.hidden = !this.updateNeeded;
    const connected = navigator.onLine && !cached && !this.connectionFailed;
    if (!connected) { this.completionCandidates.clear(); this.binCandidates.clear(); }
    const warning = this.saves.failed || !this.saves.durable || !!this.error || this.signOutBlocked;
    if (!connected || warning) this.motion.attach(null);
    this.saveBar.classList.toggle('sr-only', !warning && !this.connectionFailed);
    this.companion.update(this.feedback.textContent === 'Saved', warning, this.feedback.textContent, connected, !this.retry.hidden);
  }

  private retrySave() {
    this.error = ''; this.signOutBlocked = false; this.saves.retry(); if (this.connectionFailed) this.reconnect(); this.showSaveStatus();
  }

  private async perform(action: () => Promise<void>) {
    const generation = this.generation;
    this.operations++; this.error = ''; this.showSaveStatus();
    try { await action(); return generation === this.generation; }
    catch { if (generation === this.generation) this.error = 'Could not complete that change. Please try again.'; return false; }
    finally { if (generation === this.generation) { this.operations--; this.showSaveStatus(); } }
  }

  private createNote(kind: NoteKind) {
    if (!this.repository || this.operations) return;
    const { id, committed } = this.repository.create(kind);
    if (this.view instanceof HomeView) this.view.clearSearch();
    if (this.noteFilter !== 'all') this.noteFilter = 'private';
    this.focusCreatedNote = id;
    void this.perform(() => committed);
    // Open from the local snapshot; the write remains pending until acknowledged.
    this.notes.push({ id, kind, title: '', body: '', pinned: false, state: 'active', audience: 'private', sharedWith: [this.user!.uid], createdBy: this.user!.uid, updatedBy: this.user!.uid, createdAt: Timestamp.now(), updatedAt: null, creating: true });
    this.navigate(`notes/${id}`);
  }

  private async signOut() {
    this.saves.flush();
    try {
      const action = async () => { this.forgetOfflineAccess(); await logOut(this.backend.auth); await this.backend.clearCache(); };
      const complete = this.session ? await this.session.signOut(
        () => !!this.user && DraftSaves.hasDrafts(`${this.backend.cacheKey}/drafts/${this.user.uid}`), action) : (await action(), true);
      if (!complete) {
        this.signOutBlocked = true;
        if (!this.busy() && (!this.user || !DraftSaves.hasDrafts(`${this.backend.cacheKey}/drafts/${this.user.uid}`))) this.error = 'Could not sign out. Check other Eselsohr windows and try again.';
        this.showSaveStatus();
      }
    }
    catch { this.error = 'Could not sign out. Please try again.'; if (this.access) this.showSaveStatus(); else this.message(this.error, true); }
  }

  private async listenerFailed(error: Error) {
    const generation = this.generation;
    const code = (error as { code?: string }).code;
    if (code === 'permission-denied' || code === 'unauthenticated') {
      try {
        const active = await this.repository?.checkMembership();
        if (generation !== this.generation) return;
        if (!active) { this.accessLost(); return; }
        this.updateNeeded = true;
      } catch (failure) {
        if (generation !== this.generation) return;
        if (['permission-denied', 'unauthenticated'].includes((failure as { code: string }).code)) { this.accessLost(); return; }
      }
    }
    this.connectionFailed = true;
    this.error = this.updateNeeded ? 'This version could not open your notes. Update the app or retry.' : 'Could not load notes. Retry when connected.';
    if (this.view) this.showSaveStatus();
    else {
      this.message(this.error);
      if (this.updateNeeded) host.querySelector('main')?.append(button('Update app', 'secondary', () => this.reloadApp()));
      host.querySelector('main')?.append(button('Retry', 'plain', () => this.reconnect()));
    }
  }

  private reloadApp() {
    this.saves.flush();
    if (!this.saves.durable && this.saves.pending) { this.error = 'Keep this page open until your changes are saved.'; this.showSaveStatus(); return; }
    // Bypass even the earlier cache-first worker without clearing Auth or drafts.
    this.reloading = true;
    location.assign(`/index.html?update=${Date.now()}${location.hash}`);
  }

  private async reconnect() {
    const generation = this.generation;
    this.stopListeners(); this.saves.flush(); this.access = false;
    await this.saves.dispose();
    if (generation !== this.generation) return;
    this.connectionFailed = false; this.updateNeeded = false; this.error = ''; this.fromCache = true;
    this.watchMembership();
  }

  private forgetOfflineAccess() {
    localStorage.removeItem(`${this.backend.cacheKey}/member`);
    if (this.user) DraftSaves.clear(`${this.backend.cacheKey}/drafts/${this.user.uid}`);
    if (this.user) localStorage.removeItem(`${this.backend.cacheKey}/revoked/${this.user.uid}`);
  }

  private accessLost(message = 'Access to the notebook was lost. Try signing in again, or ask the person who set it up.') {
    this.forgetOfflineAccess(); this.clearGroup();
    void this.backend.clearCache().catch(() => { /* Closed handles cannot serve cached group data. */ });
    this.message(message, true);
  }

  private stopListeners() {
    this.membership?.(); this.membership = null;
    for (const unsubscribe of this.subscriptions) unsubscribe(); this.subscriptions = [];
    for (const unsubscribe of this.checklistSubscriptions.values()) unsubscribe(); this.checklistSubscriptions.clear();
  }

  private clearGroup() {
    clearTimeout(this.openingTimer);
    this.generation++; this.access = false;
    this.session?.dispose(); this.session = undefined; host.inert = false;
    this.companion.close(); this.motionSettings?.close(); this.sharing?.dispose(); this.sharing = undefined;
    this.stopListeners();
    if (this.view instanceof EditorView || this.view instanceof HomeView) this.view.dispose();
    this.clearUndo(); this.motion.attach(null); this.completionCandidates.clear(); this.binCandidates.clear();
    this.saves.dispose(); this.saves = new DraftSaves(change => this.saveChanged(change));
    this.repository = null; this.notes = []; this.members = []; this.items.clear(); this.newItems.clear();
    this.revokedNotes.clear(); this.sharingNoteId = undefined;
    this.updateNeeded = false;
    this.view = null; this.openedNote = null; this.focusCreatedNote = null; this.loading = true; this.fromCache = true; this.operations = 0; this.error = ''; this.connectionFailed = false; this.signOutBlocked = false;
    this.noteFilter = 'all';
    this.homeContexts.clear(); this.renderedRoute = null;
    this.pendingNotes = false; this.pendingItems.clear(); this.cachedItems.clear();
  }
}

let backend: ReturnType<typeof initializeBackend>;
try { backend = initializeBackend(); }
catch { backend = null; }
if (!backend) {
  const main = element('main', 'shell login');
  main.append(heading('Eselsohr'), element('p', 'muted', 'This notebook is not connected yet. Please try again once setup is finished.'));
  host.replaceChildren(main);
} else {
  const app = new App(backend);
  void app.start();
}


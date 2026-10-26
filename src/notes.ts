import { collection, collectionGroup, doc, getDocFromCache, onSnapshot, onSnapshotsInSync, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import type { Firestore, Timestamp, Unsubscribe } from 'firebase/firestore';
import { doc as serverDoc, getDoc, type Firestore as MembershipStore } from 'firebase/firestore/lite';

export type NoteState = 'active' | 'archived' | 'trash';
export type NoteKind = 'text' | 'checklist';
export type NoteScope = 'shared' | 'private';
export type NoteFilter = 'all' | NoteScope;
export type Sharing = { audience: 'private' | 'everyone' | 'selected'; sharedWith?: string[] };
export type ItemLevel = 0 | 1 | 2;
export type LevelChange = { id: string; level: ItemLevel };
export interface Member { id: string; displayName: string; active: boolean }
export interface Note {
  creating?: boolean;
  id: string; kind: NoteKind; title: string; body: string; pinned: boolean; state: NoteState;
  createdBy: string; createdAt: Timestamp | null; updatedBy: string; updatedAt: Timestamp | null;
  audience?: Sharing['audience']; sharedWith?: string[];
}
export interface Item {
  id: string; text: string; checked: boolean; indented?: boolean | ItemLevel;
  sortAt?: Timestamp;
  createdBy: string; createdAt: Timestamp | null; updatedBy: string; updatedAt: Timestamp | null;
}
export type NotePatch = Partial<Pick<Note, 'title' | 'body' | 'pinned' | 'state'>>;
export type ItemPatch = Partial<Pick<Item, 'text' | 'checked' | 'indented'>>;
export type SnapshotList<T> = { records: T[]; fromCache: boolean; pending: boolean };
const notesPath = 'notebooks/home/notes';
const privatePrefix = 'private:';

// Keep existing shared links/draft keys stable and distinguish identical document IDs.
export function noteScope(note: Pick<Note, 'id' | 'audience'>): NoteScope {
  return note.audience ? note.audience === 'private' ? 'private' : 'shared' : note.id.startsWith(privatePrefix) ? 'private' : 'shared';
}
export function sharingLabel(note: Note) { return noteScope(note) === 'private' ? 'Private' : note.audience === 'selected' ? 'Selected people' : 'Everyone'; }
export function noteSharing(note: Note): Sharing {
  return { audience: note.audience ?? (noteScope(note) === 'private' ? 'private' : 'everyone'), sharedWith: note.sharedWith ?? [] };
}
export function sameSharing(a: Sharing, b: Sharing) {
  return a.audience === b.audience && [...a.sharedWith ?? []].sort().join('\n') === [...b.sharedWith ?? []].sort().join('\n');
}

export class NotesRepository {
  constructor(private db: Firestore, private uid: string, private membershipDb: MembershipStore) {}

  ownMembership(receive: (member: Member | null, fromCache: boolean) => void, fail: (error: Error) => void): Unsubscribe {
    return onSnapshot(doc(this.db, 'members', this.uid), { includeMetadataChanges: true }, snapshot => {
      receive(snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } as Member : null, snapshot.metadata.fromCache);
    }, fail);
  }

  // Lite reads directly from the server, outside the persistent listener/cache
  // state that produced the suspect snapshot. Offline failure preserves drafts.
  async checkMembership() { return (await getDoc(serverDoc(this.membershipDb, 'members', this.uid))).data()?.active === true; }

  members(receive: (members: Member[]) => void, fail: (error: Error) => void): Unsubscribe {
    return onSnapshot(collection(this.db, 'members'), snapshot => receive(snapshot.docs.map(record => ({ ...record.data(), id: record.id }) as Member)), fail);
  }

  notes(receive: (snapshot: SnapshotList<Note>) => void, fail: (error: Error) => void): Unsubscribe {
    const snapshots = new Map<string, SnapshotList<Note>>();
    let changed = false;
    const sources = [
      ['everyone', query(collectionGroup(this.db, 'notes'), where('audience', '==', 'everyone'))],
      ['participant', query(collectionGroup(this.db, 'notes'), where('sharedWith', 'array-contains', this.uid))],
      ['legacy', collection(this.db, 'members', this.uid, 'notes')],
    ] as const;
    const subscriptions = sources.map(([source, ref]) => onSnapshot(ref, { includeMetadataChanges: true }, snapshot => {
      snapshots.set(source, {
        records: snapshot.docs.map(record => ({ ...record.data({ serverTimestamps: 'estimate' }),
          id: record.ref.parent.parent?.path === 'notebooks/home' ? record.id : record.ref.parent.parent?.id === this.uid ? `${privatePrefix}${record.id}` : `member:${encodeURIComponent(record.ref.parent.parent!.id)}:${record.id}`,
          creating: record.get('createdAt') === null }) as Note),
        fromCache: snapshot.metadata.fromCache, pending: snapshot.metadata.hasPendingWrites,
      });
      changed = true;
    }, fail));
    // A sharing change can move a note between queries. Publish their union only
    // after every affected listener has fired, avoiding stale access or gaps.
    const synchronized = onSnapshotsInSync(this.db, () => {
      if (!changed || snapshots.size !== sources.length) return;
      changed = false;
      const values = sources.map(([source]) => snapshots.get(source)!);
      receive({ records: [...new Map(values.flatMap(value => value.records).map(note => [note.id, note])).values()], fromCache: values.some(value => value.fromCache), pending: values.some(value => value.pending) });
    });
    return () => { synchronized(); subscriptions.forEach(unsubscribe => unsubscribe()); };
  }

  items(noteId: string, receive: (snapshot: SnapshotList<Item>) => void, fail: (error: Error) => void): Unsubscribe {
    return onSnapshot(collection(this.noteRef(noteId), 'items'), { includeMetadataChanges: true }, snapshot => {
      receive({ records: snapshot.docs.map(record => ({ ...record.data({ serverTimestamps: 'estimate' }), id: record.id }) as Item), fromCache: snapshot.metadata.fromCache, pending: snapshot.metadata.hasPendingWrites });
    }, fail);
  }

  create(kind: NoteKind) {
    const ref = doc(collection(this.db, notesPath));
    const committed = setDoc(ref, { kind, title: '', body: '', pinned: false, state: 'active',
      audience: 'private', sharedWith: [this.uid], ...this.creationMetadata() });
    return { id: ref.id, committed };
  }

  save(noteId: string, patch: NotePatch) {
    return updateDoc(this.noteRef(noteId), { ...patch, ...this.updateMetadata() });
  }

  setSharing(noteId: string, sharing: Sharing, previous: Sharing) {
    return runTransaction(this.db, async transaction => {
      const ref = this.noteRef(noteId), snapshot = await transaction.get(ref);
      const current = snapshot.data();
      if (!current || current.createdBy !== this.uid) throw new Error('Only the creator can change sharing.');
      if (!sameSharing(noteSharing({ ...current, id: noteId } as Note), previous)) {
        throw new Error('Sharing changed in another window. Close and reopen Sharing to see the latest people.');
      }
      // Replace only access fields; simultaneous text/list edits remain intact.
      transaction.update(ref, { audience: sharing.audience, sharedWith: sharing.sharedWith ?? [], ...this.updateMetadata() });
    });
  }

  newItemId(noteId: string) {
    return doc(collection(this.noteRef(noteId), 'items')).id;
  }

  addItem(noteId: string, itemId: string, patch: ItemPatch) {
    return setDoc(doc(this.noteRef(noteId), 'items', itemId), { text: '', checked: false, ...patch, ...this.creationMetadata() });
  }

  saveItem(noteId: string, itemId: string, patch: ItemPatch) {
    return updateDoc(doc(this.noteRef(noteId), 'items', itemId), { ...patch, ...this.updateMetadata() });
  }

  async restoreItem(noteId: string, itemId: string, patch: ItemPatch) {
    const existing = await getDocFromCache(doc(this.noteRef(noteId), 'items', itemId)).catch(() => null);
    if (existing?.exists()) await this.saveItem(noteId, itemId, patch);
    else await this.addItem(noteId, itemId, patch);
  }

  setItemLevels(noteId: string, changes: LevelChange[]) {
    const batch = writeBatch(this.db);
    for (const change of changes) batch.update(doc(this.noteRef(noteId), 'items', change.id), { indented: change.level, ...this.updateMetadata() });
    return batch.commit();
  }

  removeItem(noteId: string, itemId: string, promotions: LevelChange[]) {
    const batch = writeBatch(this.db);
    batch.delete(doc(this.noteRef(noteId), 'items', itemId));
    for (const change of promotions) batch.update(doc(this.noteRef(noteId), 'items', change.id), { indented: change.level, ...this.updateMetadata() });
    return batch.commit();
  }

  restoreDeletedItem(noteId: string, item: Item, levels: LevelChange[]) {
    const batch = writeBatch(this.db);
    batch.set(doc(this.noteRef(noteId), 'items', item.id), {
      text: item.text, checked: item.checked, indented: item.indented ?? 0,
      sortAt: item.sortAt ?? item.createdAt ?? serverTimestamp(), ...this.creationMetadata(),
    });
    for (const change of levels) batch.update(doc(this.noteRef(noteId), 'items', change.id), { indented: change.level, ...this.updateMetadata() });
    return batch.commit();
  }

  private noteRef(id: string) {
    if (id.startsWith(privatePrefix)) return doc(this.db, 'members', this.uid, 'notes', id.slice(privatePrefix.length));
    if (id.startsWith('member:')) { const [, owner, ...parts] = id.split(':'); return doc(this.db, 'members', decodeURIComponent(owner), 'notes', parts.join(':')); }
    return doc(this.db, notesPath, id);
  }
  private updateMetadata() { return { updatedBy: this.uid, updatedAt: serverTimestamp() }; }
  private creationMetadata() { return { createdBy: this.uid, createdAt: serverTimestamp(), ...this.updateMetadata() }; }
}


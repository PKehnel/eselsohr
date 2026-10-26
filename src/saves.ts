// One serialized queue per document. New patches contain only changed fields.
// The journal also protects edits still in the debounce window or behind a write.
type Patch = Record<string, unknown>;
export type SaveChange = 'scheduled' | 'submitted' | 'settled';
type Entry = { write: (patch: Patch) => Promise<void>; pending: Patch; failed: Patch; active: Patch; timer?: ReturnType<typeof setTimeout>; running: boolean; error: boolean };
export class DraftSaves {
  private disposed = false;
  private entries = new Map<string, Entry>();
  private storageOkay = true;
  private recoveryOkay = true;
  private journalKey?: string;
  private release?: () => void;
  private ownership?: Promise<unknown>;
  private ready: Promise<void>;
  constructor(private changed: (change: SaveChange) => void, private storageKey?: string) {
    this.ready = Promise.resolve();
    if (storageKey) {
      this.journalKey = `${storageKey}/writers/${crypto.randomUUID()}`;
      // A live writer owns its journal until teardown or browser termination.
      // Other tabs can recover it only after this lock is released.
      const held = new Promise<void>(resolve => { this.release = resolve; });
      this.ready = new Promise<void>(resolve => {
        this.ownership = navigator.locks.request(this.journalKey!, async () => { resolve(); await held; });
      });
    }
  }

  async restore(writer: (key: string) => Entry['write']) {
    if (!this.storageKey) return;
    await this.ready;
    try {
      await navigator.locks.request(`${this.storageKey}/recovery`, async () => {
        const keys = DraftSaves.journals(this.storageKey!);
        // Replay abandoned writers in edit order. Live writers are never copied.
        keys.sort((a, b) => this.journal(a).updatedAt - this.journal(b).updatedAt);
        for (const key of keys) {
          if (this.disposed || key === this.journalKey) continue;
          await navigator.locks.request(key, { ifAvailable: true }, async lock => {
            if (!lock || this.disposed) return;
            const { patches } = this.journal(key);
            for (const [path, patch] of Object.entries(patches)) this.schedule(path, patch, writer(path));
            // Copy durably before removing the abandoned record (including v1).
            if (this.storageOkay) localStorage.removeItem(key);
          });
        }
      });
    } catch { this.recoveryOkay = false; }
  }

  private journal(key: string): { updatedAt: number; patches: Record<string, Patch> } {
    const stored = localStorage.getItem(key);
    if (stored === null) return { updatedAt: 0, patches: {} };
    const value = JSON.parse(stored);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid draft journal');
    if (key !== this.storageKey && (typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt))) throw new Error('Invalid draft journal');
    const patches = key === this.storageKey ? value : value.patches;
    if (!patches || typeof patches !== 'object' || Array.isArray(patches) ||
        Object.values(patches).some(patch => !patch || typeof patch !== 'object' || Array.isArray(patch))) throw new Error('Invalid draft journal');
    return { updatedAt: value.updatedAt ?? 0, patches };
  }

  private static journals(storageKey: string) {
    return Object.keys(localStorage).filter(key => key === storageKey || key.startsWith(`${storageKey}/writers/`));
  }

  static hasDrafts(storageKey: string) { return this.journals(storageKey).length > 0; }

  static clear(storageKey: string) {
    for (const key of this.journals(storageKey)) localStorage.removeItem(key);
  }

  private persist() {
    if (!this.journalKey) return;
    try {
      const patches = Object.fromEntries([...this.entries].map(([key]) => [key, this.draft(key)]).filter(([, patch]) => Object.keys(patch).length));
      if (Object.keys(patches).length) localStorage.setItem(this.journalKey, JSON.stringify({ updatedAt: Date.now(), patches }));
      else localStorage.removeItem(this.journalKey);
      this.storageOkay = true;
    } catch { this.storageOkay = false; }
  }

  get durable() { return this.storageOkay && this.recoveryOkay; }

  schedule(key: string, patch: Patch, write: Entry['write'], immediate = false) {
    if (this.disposed) return;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { write, pending: {}, failed: {}, active: {}, running: false, error: false };
      this.entries.set(key, entry);
    }
    Object.assign(entry.pending, patch);
    this.persist();
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = undefined;
    this.changed('scheduled');
    if (immediate) void this.pump(entry);
    else entry.timer = setTimeout(() => { entry!.timer = undefined; void this.pump(entry!); }, 650);
  }

  flush() {
    for (const entry of this.entries.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = undefined;
      void this.pump(entry);
    }
  }

  retry() {
    for (const entry of this.entries.values()) entry.error = false;
    this.flush();
  }

  dispose() {
    this.disposed = true;
    for (const entry of this.entries.values()) if (entry.timer) clearTimeout(entry.timer);
    this.entries.clear();
    this.release?.();
    return this.ownership;
  }

  discard(prefix: string) {
    for (const [key, entry] of this.entries) if (key === prefix || key.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.pending = {}; entry.failed = {};
      this.entries.delete(key);
    }
    this.persist();
  }

  retainNotes(allowed: Set<string>) {
    for (const key of this.entries.keys()) if (!allowed.has(key.split('/')[1])) this.discard(key);
  }

  get pending() { return [...this.entries.values()].some(entry => entry.running || Object.keys(entry.pending).length > 0 || Object.keys(entry.failed).length > 0); }
  get failed() { return [...this.entries.values()].some(entry => entry.error); }
  draft(key: string): Patch {
    const entry = this.entries.get(key);
    return entry ? { ...entry.failed, ...entry.active, ...entry.pending } : {};
  }

  protects(key: string, field: string) {
    const entry = this.entries.get(key);
    return !!entry && [entry.pending, entry.failed, entry.active].some(patch => field in patch);
  }

  private async pump(entry: Entry) {
    if (this.disposed || entry.running || entry.error || (!Object.keys(entry.pending).length && !Object.keys(entry.failed).length)) return;
    entry.active = { ...entry.failed, ...entry.pending };
    entry.failed = {}; entry.pending = {}; entry.running = true;
    this.changed('submitted');
    try { await entry.write(entry.active); }
    catch { entry.failed = entry.active; entry.error = true; }
    finally { entry.active = {}; entry.running = false; if (!this.disposed) { this.persist(); this.changed('settled'); } }
    if (!entry.error) void this.pump(entry);
  }
}

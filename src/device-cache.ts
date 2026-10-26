// One cache generation includes IndexedDB and Firestore's cross-tab metadata.
// Readers hold a shared lock; cleanup closes them before taking it exclusively.
export class DeviceCache {
  private generation?: string;
  private release?: () => void;
  private closing?: Promise<void>;
  private gate: string;
  private generationKey: string;
  onClose = () => {};

  constructor(private key: string, private stop: () => Promise<void>, private erase: () => Promise<void>, private prepare: () => Promise<void> = async () => {}) {
    this.gate = `${key}/readers`;
    this.generationKey = `${key}/generation`;
    window.addEventListener('storage', event => {
      if (event.key === key && event.newValue && this.release) void this.clear().catch(() => {});
    });
  }

  get closed() { return !!this.closing; }

  private currentGeneration() { return localStorage.getItem(this.generationKey) ?? 'initial'; }

  async open() {
    await navigator.locks.request(this.key, async () => {
      await this.finishCleanup();
      if (!localStorage.getItem(this.generationKey)) await navigator.locks.request(this.gate, async () => {
        await this.prepare();
        localStorage.setItem(this.generationKey, 'initial');
      });
      this.generation = this.currentGeneration();
      // Keep the shared lock after startup, until SDK termination completes.
      await new Promise<void>((resolve, reject) => {
        void navigator.locks.request(this.gate, { mode: 'shared' }, async () => {
          const held = new Promise<void>(release => { this.release = release; });
          resolve();
          await held;
        }).catch(reject);
      });
    });
  }

  clear() {
    if (!this.closing) {
      // Publish the promise before notifying the app, which may re-enter here.
      this.closing = Promise.resolve().then(async () => {
        // Survives interruption during SDK shutdown, before the mutex is free.
        if (this.generation !== undefined && this.generation === this.currentGeneration()) localStorage.setItem(this.key, this.generation);
        this.onClose();
        await this.stop();
        this.release?.(); this.release = undefined;
        await navigator.locks.request(this.key, async () => {
          // A delayed old tab must never delete the next account's database.
          if (this.generation !== this.currentGeneration()) return;
          localStorage.setItem(this.key, this.generation);
          await this.finishCleanup();
        });
      });
    }
    return this.closing;
  }

  private async finishCleanup() {
    const pending = localStorage.getItem(this.key);
    if (!pending) return;
    // '1' is the interrupted-cleanup marker from the previous app version.
    if (pending !== '1' && pending !== this.currentGeneration()) {
      localStorage.removeItem(this.key); return;
    }
    await navigator.locks.request(this.gate, async () => {
      await this.erase();
      localStorage.setItem(this.generationKey, crypto.randomUUID());
      localStorage.removeItem(this.key);
    });
  }
}

// The former app may already have deleted IndexedDB without leaving a cleanup
// marker. Remove its orphaned coordination only when no database remains. Never
// clear a populated cache (which can contain acknowledged data and pending writes).
export async function clearOrphanedFirestoreCoordination(appName: string, projectId: string) {
  const name = `firestore/${appName}/${projectId}/main`;
  if (!(await indexedDB.databases()).some(database => database.name === name)) clearFirestoreCoordination(appName, projectId);
}

// SDK-owned formats, checked against the pinned Firestore version in browser
// regressions. Run only after all cache readers stop and IndexedDB is deleted.
export function clearFirestoreCoordination(appName: string, projectId: string) {
  const namespace = `firestore/${appName}/${projectId}/`;
  const prefixes = ['clients', 'mutations', 'targets'].map(kind => `firestore_${kind}_${namespace}_`);
  const exact = ['online_state', 'sequence_number', 'bundle_loaded_v2'].map(kind => `firestore_${kind}_${namespace}`);
  for (const key of Object.keys(localStorage)) {
    if (exact.includes(key) || prefixes.some(prefix => key.startsWith(prefix))) localStorage.removeItem(key);
  }
}

// All tabs hold a shared account lock while they can accept edits. Sign-out
// freezes them first, then takes the exclusive lock only after every tab drains.
export class AccountSession {
  private intent: string;
  private gate: string;
  private mutex: string;
  private disposed = false;
  private paused = false;
  private frozen?: boolean;
  private holding?: Promise<unknown>;
  private release?: () => void;
  private watchdog?: ReturnType<typeof setTimeout>;
  private opened!: () => void;
  readonly ready = new Promise<void>(resolve => { this.opened = resolve; });
  private storageChanged = (event: StorageEvent) => { if (event.key === this.intent) this.update(); };

  constructor(key: string, private busy: () => boolean, private flush: () => void, private freeze: (paused: boolean) => void) {
    this.intent = `${key}/sign-out`;
    this.gate = `${key}/editors`;
    this.mutex = `${key}/sign-out-lock`;
    window.addEventListener('storage', this.storageChanged);
    this.update();
  }

  update() {
    if (this.disposed) return;
    const paused = localStorage.getItem(this.intent) !== null;
    if (paused !== this.paused) {
      this.paused = paused;
      this.setFrozen(paused || !this.release);
      if (paused) this.flush();
    }
    this.setFrozen(paused || !this.release);
    if (paused) {
      if (!this.busy()) this.release?.();
      // A crashed requester releases its browser lock but may leave the marker.
      if (!this.watchdog) this.watchdog = setTimeout(() => {
        this.watchdog = undefined;
        void navigator.locks.request(this.mutex, { ifAvailable: true }, lock => {
          if (lock && !this.disposed) localStorage.removeItem(this.intent);
        }).then(() => this.update());
      }, 3000);
    } else if (!this.holding) {
      this.holding = navigator.locks.request(this.gate, { mode: 'shared' }, async () => {
        if (this.disposed || this.paused) return;
        const held = new Promise<void>(resolve => { this.release = () => { this.release = undefined; resolve(); }; });
        this.setFrozen(false);
        this.opened();
        await held;
        this.release = undefined;
      }).finally(() => { this.holding = undefined; this.update(); });
    }
  }

  private setFrozen(frozen: boolean) {
    if (this.frozen !== frozen) { this.frozen = frozen; this.freeze(frozen); }
  }

  async signOut(hasDrafts: () => boolean, action: () => Promise<void>) {
    return navigator.locks.request(this.mutex, { ifAvailable: true }, async lock => {
      if (!lock || this.disposed) return false;
      const token = crypto.randomUUID();
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 4000);
      try {
        localStorage.setItem(this.intent, token);
        this.update();
        return await navigator.locks.request(this.gate, { signal: abort.signal }, async () => {
          if (this.disposed || this.busy() || hasDrafts()) return false;
          clearTimeout(timer);
          await action();
          return true;
        });
      } catch (error) {
        if (abort.signal.aborted) return false;
        throw error;
      } finally {
        clearTimeout(timer);
        if (localStorage.getItem(this.intent) === token) localStorage.removeItem(this.intent);
        this.update();
      }
    });
  }

  dispose() {
    this.disposed = true;
    window.removeEventListener('storage', this.storageChanged);
    clearTimeout(this.watchdog);
    this.release?.();
  }
}


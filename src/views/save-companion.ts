import { button, element } from './dom';
import { art } from './icons';

export class SaveCompanion {
  readonly root = element('div', 'save-companion');
  private online = art('online-sage', '●');
  private offline = art('offline', '●');
  private bin = art('bin', '▣');
  private inBin = false;
  private trigger: HTMLButtonElement;
  private menu = element('dialog', 'notebook-menu');
  private sync = element('p', 'sync-entry');
  private message = element('span');
  private retry: HTMLButtonElement;

  constructor(navigate: (route: string) => void, signOut: () => void, animations: () => void, retry: () => void) {
    this.trigger = button('', 'companion-trigger', () => {
      this.menu.showModal(); this.trigger.setAttribute('aria-expanded', 'true');
      const box = this.root.getBoundingClientRect();
      this.menu.style.left = `${Math.max(12, Math.min(box.left, innerWidth - this.menu.offsetWidth - 12))}px`;
      this.menu.style.top = `${Math.max(12, Math.min(box.bottom + 6, innerHeight - this.menu.offsetHeight - 12))}px`;
    });
    this.trigger.setAttribute('aria-label', 'Notebook menu');
    this.trigger.setAttribute('aria-haspopup', 'dialog');
    this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.setAttribute('aria-describedby', 'notebook-sync');
    this.menu.setAttribute('aria-label', 'Notebook menu');
    this.sync.id = 'notebook-sync';
    this.sync.setAttribute('role', 'status');
    const dot = element('span', 'sync-dot'); dot.setAttribute('aria-hidden', 'true');
    this.sync.append(dot, this.message);
    this.retry = button('Retry sync', 'plain menu-choice', () => { this.close(); retry(); });
    this.menu.append(this.sync, this.retry);
    for (const [label, action] of [
      ['Notes', () => navigate('')], ['Bin', () => navigate('bin')],
      ['Donkey animations', animations], ['Sign out', signOut],
    ] as const) this.menu.append(button(label, 'plain menu-choice', () => { this.close(); action(); }));
    this.menu.addEventListener('click', event => { if (event.target === this.menu) this.close(); });
    this.menu.addEventListener('close', () => this.trigger.setAttribute('aria-expanded', 'false'));
    this.bin.hidden = true;
    this.root.append(this.online, this.offline, this.bin, this.trigger, this.menu);
  }

  setBin(inBin: boolean) { this.inBin = inBin; }

  close() { this.menu.close(); }

  update(saved: boolean, warning: boolean, message: string, connected: boolean, canRetry: boolean) {
    this.root.dataset.state = saved ? 'saved' : warning ? 'problem' : 'pending';
    this.root.dataset.connection = connected ? 'online' : 'offline';
    // Routine writes leave the drawing steady; only connection problems/errors change it.
    const healthy = connected && !warning;
    this.online.hidden = this.inBin || !healthy; this.offline.hidden = healthy;
    this.bin.hidden = !this.inBin || !healthy;
    this.sync.dataset.state = warning ? 'problem' : !navigator.onLine ? 'offline' : 'pending';
    this.sync.hidden = healthy;
    if (healthy) this.trigger.removeAttribute('aria-describedby');
    else this.trigger.setAttribute('aria-describedby', this.sync.id);
    const detail = warning ? message : !navigator.onLine ? 'Offline · changes will sync when connected.' : !connected ? 'Connecting to the notebook…' : '';
    if (this.message.textContent !== detail) this.message.textContent = detail;
    this.retry.hidden = !canRetry;
    this.trigger.title = healthy ? 'Notebook menu' : `Notebook menu · ${this.message.textContent}`;
  }
}

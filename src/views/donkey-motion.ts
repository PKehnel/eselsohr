import { element } from './dom';
import { runningDonkeys, chaseHeight, type RunArea } from './donkey-run';

const timings = {
  idle: [320, 120, 180, 140, 140, 120, 180, 320],
  completion: [180, 140, 140, 140, 140, 140, 220, 180],
};
const sheets = { idle: '/themes/donkey-v1/idle-blink.webp', completion: '/themes/donkey-v1/completion-pounce.webp' };
const preferenceKey = 'eselsohr-donkey-motion';
export type MotionKind = keyof typeof timings | 'toss' | 'family';

// Temporarily replace the corner donkey with one motion; status stays independent.
export class DonkeyMotion {
  readonly root = element('div', 'donkey-motion');
  private sprite = element('div', 'donkey-sprite');
  private reduced = matchMedia('(prefers-reduced-motion: reduce)');
  private active = false;
  private enabled = true;
  private lastInput = Date.now();
  private lastMotion = -Infinity;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private frameTimer?: ReturnType<typeof setTimeout>;
  private familyTimer?: ReturnType<typeof setTimeout>;
  private foregroundSince = Date.now();
  private familyShown = false;
  private family?: HTMLElement;
  private stopFamily?: () => void;
  private spaceObserver = new ResizeObserver(() => {
    if (this.root.dataset.playing === 'family' && !this.familySpace()) this.stopFrame();
  });
  private ready = new Set<string>();
  private animations: Animation[] = [];
  private paper?: HTMLElement;
  private cleanup: (() => void)[] = [];

  constructor() {
    try { this.enabled = localStorage.getItem(preferenceKey) !== 'off'; } catch { /* Still works without storage. */ }
    this.root.setAttribute('aria-hidden', 'true'); this.root.append(this.sprite);
    for (const [kind, src] of Object.entries(sheets)) {
      const image = new Image();
      image.onload = () => { this.ready.add(kind); };
      image.src = src;
    }
    const activity = () => { this.lastInput = Date.now(); this.stopFrame(); };
    for (const name of ['pointerdown', 'keydown', 'input', 'scroll']) {
      document.addEventListener(name, activity, { capture: true, passive: true });
      this.cleanup.push(() => document.removeEventListener(name, activity, true));
    }
    const reset = () => this.reset();
    const visibility = () => { if (document.visibilityState === 'visible') this.foregroundSince = Date.now(); this.reset(); };
    document.addEventListener('visibilitychange', visibility);
    this.reduced.addEventListener('change', reset);
    window.addEventListener('resize', activity);
    window.visualViewport?.addEventListener('resize', activity);
    this.cleanup.push(() => document.removeEventListener('visibilitychange', visibility), () => this.reduced.removeEventListener('change', reset),
      () => window.removeEventListener('resize', activity), () => window.visualViewport?.removeEventListener('resize', activity));
  }

  get allowed() { return this.enabled; }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    try { localStorage.setItem(preferenceKey, enabled ? 'on' : 'off'); } catch { /* Session preference remains usable. */ }
    this.reset();
  }

  attach(parent: HTMLElement | null) {
    this.spaceObserver.disconnect();
    this.active = !!parent;
    if (parent) parent.append(this.root); else this.root.remove();
    const list = parent?.closest('.notebook')?.querySelector('.note-list');
    if (list) this.spaceObserver.observe(list);
    this.reset();
  }

  completion() {
    if (Math.random() < .2) this.play('completion');
  }

  bin(target: HTMLElement) {
    if (Math.random() < .33) this.toss(target, false);
  }

  preview(kind: MotionKind, target: HTMLElement) {
    this.stopFrame();
    if (kind === 'toss') this.toss(target, true);
    else if (kind === 'family') this.runFamily(target);
    else this.play(kind, true);
  }

  destroy() {
    this.attach(null);
    for (const cleanup of this.cleanup) cleanup();
    this.cleanup = [];
  }

  private quiet(idle: boolean, preview = false) {
    const box = this.root.getBoundingClientRect();
    return this.active && this.root.isConnected && document.visibilityState === 'visible' && this.enabled && !this.reduced.matches &&
      (preview || !document.querySelector('dialog[open]') && !document.activeElement?.matches(`input:not([type=checkbox])${idle ? '' : ':not([type=search])'}, textarea, [contenteditable=true]`) &&
      (!idle || Date.now() - this.lastInput >= 10000) && Date.now() - this.lastMotion >= 60000) && box.height > 0 && box.bottom > 0 && box.top < innerHeight;
  }

  private reset() {
    clearTimeout(this.idleTimer); this.idleTimer = undefined;
    clearTimeout(this.familyTimer); this.familyTimer = undefined;
    this.stopFrame();
    if (this.active && this.enabled && !this.reduced.matches && document.visibilityState === 'visible') {
      this.scheduleIdle(); this.scheduleFamily();
    }
  }

  private scheduleFamily() {
    if (this.familyShown) return;
    this.familyTimer = setTimeout(() => {
      this.runFamily(); this.scheduleFamily();
    }, Math.max(10000, 30001 - (Date.now() - this.foregroundSince)));
  }

  private familySpace(preview?: HTMLElement): RunArea | null {
    const notebook = this.root.closest('.notebook');
    const surface = preview ?? notebook;
    const dock = surface?.querySelector(preview ? '.preview-bin' : '.notebook-dock')?.getBoundingClientRect();
    const bin = surface?.querySelector(preview ? '.preview-bin' : '.bin-link')?.getBoundingClientRect();
    const list = notebook?.querySelector('.note-list')?.getBoundingClientRect();
    if (!surface || !dock || !bin || !preview && !list) return null;
    const shell = surface.getBoundingClientRect();
    const left = Math.max(8, shell.left + 8), right = Math.min(innerWidth - 8, shell.right - 8);
    const bottom = Math.min(innerHeight, dock.top, bin.top) - 18, top = bottom - chaseHeight;
    if (right - left < 220 || (preview ? shell.top + 4 : (list?.bottom ?? Infinity) + 16) > top) return null;
    for (const control of surface.querySelectorAll('.undo-bar:not([hidden]), .save-bar:not(.sr-only)')) {
      const box = control.getBoundingClientRect();
      if (box.height && box.bottom > top && box.top < bottom) return null;
    }
    return { left, top, width: right - left, height: chaseHeight };
  }

  private runFamily(preview?: HTMLElement) {
    if (!this.quiet(true, !!preview) || this.root.dataset.playing) return;
    const area = this.familySpace(preview);
    if (!area) return;
    if (!preview) this.familyShown = true;
    this.lastMotion = Date.now(); this.root.dataset.playing = 'family';
    const run = runningDonkeys(area);
    this.family = run.root; (preview ?? this.root.closest('.notebook'))?.append(run.root);
    this.stopFamily = run.cancel;
    void run.finished.then(() => { if (this.family === run.root) this.stopFrame(); }).catch(() => { /* Decoration was cancelled. */ });
  }

  private scheduleIdle() {
    this.idleTimer = setTimeout(() => {
      this.play('idle'); this.scheduleIdle();
    }, 60000 + Math.random() * 90000);
  }

  private play(kind: keyof typeof timings, preview = false) {
    if (!this.quiet(kind === 'idle', preview) || this.root.dataset.playing || !this.ready.has(kind)) return;
    this.lastMotion = Date.now();
    this.root.dataset.playing = kind;
    this.sprite.style.backgroundImage = `url(${sheets[kind]})`;
    const frame = (index: number) => {
      this.sprite.style.backgroundPosition = `${index % 4 * 100 / 3}% ${index < 4 ? 0 : 100}%`;
      this.frameTimer = setTimeout(() => { if (index === 7) this.stopFrame(); else frame(index + 1); }, timings[kind][index]);
    };
    frame(0);
  }

  private toss(target: HTMLElement, preview: boolean) {
    if (!this.quiet(false, preview) || this.root.dataset.playing || !target.isConnected) return;
    const from = this.root.getBoundingClientRect(), to = target.getBoundingClientRect();
    if (!to.width || to.bottom < 0 || to.top >= innerHeight) return;
    this.lastMotion = Date.now(); this.root.dataset.playing = 'toss';
    const paper = element('span', 'flying-note'); paper.setAttribute('aria-hidden', 'true');
    const x = from.left + from.width * .65, y = from.top + from.height * .52;
    const dx = to.left + to.width * .5 - x, dy = to.top + to.height * .24 - y;
    paper.style.left = `${x}px`; paper.style.top = `${y}px`;
    this.paper = paper; this.root.append(paper);
    const loopX = dx * .5, loopY = dy * .35 - 46;
    const flight = paper.animate([
      { transform: 'translate(-50%, -50%) scale(.4) rotate(-20deg)', opacity: 0, offset: 0 },
      { transform: `translate(calc(-50% + ${dx * .18}px), calc(-50% + ${dy * .12 - 28}px)) rotate(12deg)`, opacity: 1, offset: .18 },
      ...Array.from({ length: 13 }, (_, index) => {
        const angle = -Math.PI / 2 + index * Math.PI / 6;
        return { transform: `translate(calc(-50% + ${loopX + Math.cos(angle) * 24}px), calc(-50% + ${loopY + Math.sin(angle) * 20}px)) rotate(${40 + index * 30}deg)`, opacity: 1, offset: .32 + index * .035 };
      }),
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.65) rotate(500deg)`, opacity: 1, offset: .9 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy + 22}px)) scale(.15) rotate(520deg)`, opacity: 0, offset: 1 },
    ], { duration: 1800, easing: 'linear', fill: 'both' });
    const source = this.root.parentElement?.querySelector<HTMLElement>(':scope > .action-art:not([hidden])');
    const receiver = target.querySelector<HTMLElement>('.action-art') ?? target;
    this.animations = [flight, receiver.animate([
      { transform: 'rotate(0) translateY(0)' }, { transform: 'rotate(-8deg) translateY(-5px)', offset: .35 },
      { transform: 'rotate(6deg) translateY(4px)', offset: .65 }, { transform: 'rotate(0) translateY(0)' },
    ], { delay: 1540, duration: 480 })];
    if (source) this.animations.push(source.animate([
      { transform: 'rotate(0)' }, { transform: 'rotate(-9deg)', offset: .35 }, { transform: 'rotate(6deg)', offset: .65 }, { transform: 'rotate(0)' },
    ], { duration: 380 }));
    const animations = this.animations;
    void Promise.all(animations.map(animation => animation.finished)).then(() => {
      if (this.animations === animations) this.stopFrame();
    }).catch(() => { /* Input/hiding/teardown cancels decorative playback. */ });
  }

  private stopFrame() {
    clearTimeout(this.frameTimer); this.frameTimer = undefined;
    for (const animation of this.animations) animation.cancel();
    this.animations = []; this.paper?.remove(); this.paper = undefined;
    this.stopFamily?.(); this.stopFamily = undefined;
    this.family?.remove(); this.family = undefined;
    delete this.root.dataset.playing;
    this.sprite.style.backgroundImage = '';
    this.sprite.style.backgroundPosition = '';
  }
}

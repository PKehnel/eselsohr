import { record, measure } from '../tools/test-profile.mjs';

// Applied by the test-only Vite server; production source/builds are untouched.
export function startupProfile() {
  return {
    name: 'test-startup-profile', enforce: 'pre',
    transform(source, id) {
      const mark = (stage, data = '{}') => `globalThis.__eselsohrStartupMark?.(${JSON.stringify(stage)}, ${data});`;
      const edits = id.endsWith('/src/main.ts') ? [
        ['    this.opening();\n    try { await this.backend.ready; }', `    ${mark('backend.wait')}\n    this.opening();\n    try { await this.backend.ready; ${mark('backend.ready')} }`],
        ['    const previousUser = this.user;', `    ${mark('auth.changed', '{signedIn: !!user}')}\n    const previousUser = this.user;`],
        ['void this.session.ready.then(() => { if', `void this.session.ready.then(() => { ${mark('session.ready')} if`],
        ['    this.membership = this.repository.ownMembership((member, cached) => {', `    ${mark('membership.subscribe')}\n    this.membership = this.repository.ownMembership((member, cached) => {\n      ${mark('membership.snapshot', '{active: !!member?.active, cached}')} `],
        ['    this.access = true; const generation = this.generation;', `    ${mark('group.open')}\n    this.access = true; const generation = this.generation;`],
        ['    await this.saves.restore(key => {', `    ${mark('drafts.restore.start')}\n    await this.saves.restore(key => {`],
        ['    this.subscriptions.push(this.repository.members(members => {', `    ${mark('drafts.restore.end')}\n    this.subscriptions.push(this.repository.members(members => {`],
        ['    this.subscriptions.push(this.repository.notes(snapshot => {', `    ${mark('notes.subscribe')}\n    this.subscriptions.push(this.repository.notes(snapshot => {\n      ${mark('notes.published', '{cached: snapshot.fromCache, pending: snapshot.pending, count: snapshot.records.length}')} `],
      ] : id.endsWith('/src/notes.ts') ? [
        ['      snapshots.set(source, {', `      ${mark('notes.source', '{source, cached: snapshot.metadata.fromCache, pending: snapshot.metadata.hasPendingWrites, count: snapshot.size}')}\n      snapshots.set(source, {`],
        ['      if (!changed || snapshots.size !== sources.length) return;', `      ${mark('notes.sync', '{changed, sources: snapshots.size}')}\n      if (!changed || snapshots.size !== sources.length) return;`],
      ] : [];
      if (!edits.length) return;
      for (const [before, after] of edits) {
        if (!source.includes(before)) throw new Error(`Startup profiling anchor missing in ${id}: ${before}`);
        source = source.replace(before, after);
      }
      return { code: source, map: null };
    },
  };
}

export async function profileBrowser(browser, use) {
  const createContext = browser.newContext;
  const contexts = new Set();
  let nextPage = 0;
  const drain = async page => {
    if (page.isClosed()) return;
    try {
      const events = await page.evaluate(() => globalThis.__eselsohrStartupEvents?.splice(0) ?? []);
      if (events.length) record('startup', { page: page.__profilePage, events });
    } catch (error) { record('startup.unavailable', { page: page.__profilePage, reason: error.name }); }
  };
  browser.newContext = async options => {
    const context = await createContext.call(browser, options);
    contexts.add(context);
    await context.addInitScript(() => {
      const events = globalThis.__eselsohrStartupEvents = [];
      const now = performance.now.bind(performance), origin = performance.timeOrigin;
      globalThis.__eselsohrStartupMark = (stage, data = {}) => events.push({ stage, at: origin + now(), ...data });
      let previous;
      new MutationObserver(() => {
        const root = document.querySelector('#app > main');
        const state = root?.classList.contains('notebook') ? 'notebook' : root?.classList.contains('editor') ? 'editor' : document.querySelector('input[type="email"]') ? 'login' : 'opening';
        const save = document.querySelector('.save-companion')?.dataset.state;
        const key = `${state}/${save}`;
        if (key !== previous) { previous = key; globalThis.__eselsohrStartupMark('ui.state', { state, save }); }
      }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state'] });
    });
    context.on('page', page => {
      page.__profilePage = ++nextPage;
      for (const method of ['goto', 'reload', 'close']) {
        const original = page[method].bind(page);
        page[method] = async (...args) => { await measure('profile.capture', () => drain(page)); return original(...args); };
      }
    });
    const close = context.close.bind(context);
    context.close = async (...args) => {
      await measure('profile.capture', () => Promise.all(context.pages().map(drain)));
      try { return await measure('browser.context.close', () => close(...args)); }
      finally { contexts.delete(context); }
    };
    return context;
  };
  try { await use(); }
  finally {
    await measure('profile.capture', () => Promise.all([...contexts].flatMap(context => context.pages()).map(drain)));
    browser.newContext = createContext;
  }
}

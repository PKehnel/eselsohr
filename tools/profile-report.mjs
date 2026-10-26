import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) throw new Error('Use: node tools/profile-report.mjs <profile.ndjson>');
const events = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
const first = name => events.find(event => event.event === name);
const last = name => events.findLast(event => event.event === name);
const between = (from, to) => first(from) && last(to) ? last(to).at - first(from).at : null;
const sum = values => values.reduce((a, b) => a + b, 0);
const round = value => Math.round(value * 100) / 100;
function union(spans) {
  const intervals = spans.map(span => [span.start, span.start + span.ms]).sort((a, b) => a[0] - b[0]);
  let total = 0, end = -Infinity;
  for (const [start, next] of intervals) { total += Math.max(0, next - Math.max(start, end)); end = Math.max(end, next); }
  return round(total);
}
function phases(spans) {
  const names = [...new Set(spans.map(span => span.phase))];
  return Object.fromEntries(names.map(name => {
    const matches = spans.filter(span => span.phase === name);
    return [name, { calls: matches.length, work_ms: round(sum(matches.map(span => span.ms))), wall_union_ms: union(matches) }];
  }));
}

// Make one non-overlapping timeline from otherwise nested/parallel operations.
// Saved includes deliberate functional acknowledgement checks, not just setup.
function classifiedTime(testIntervals) {
  const spans = events.filter(event => event.event === 'span');
  const api = events.filter(event => event.event === 'step' && event.category === 'pw:api');
  const groups = [
    ['profiling_capture', spans.filter(event => event.phase === 'profile.capture')],
    ['fixture_data_setup', spans.filter(event => ['fixture.config', 'fixture.users', 'fixture.seed'].includes(event.phase))],
    ['fixture_data_cleanup', spans.filter(event => event.phase === 'fixture.cleanup')],
    ['browser_launch_and_creation', api.filter(event => ['Launch browser', 'Create context', 'Create page'].includes(event.title))],
    ['browser_context_close', spans.filter(event => event.phase === 'browser.context.close')],
    ['navigation_and_reload', api.filter(event => ['Navigate', 'Reload'].includes(event.title))],
    ['sign_in_form', spans.filter(event => event.phase === 'browser.sign-in')],
    ['saved_checks', spans.filter(event => event.phase === 'browser.saved')],
  ].map(([name, values]) => [name, values.map(value => [value.start, value.start + value.ms])]);
  const boundaries = [...new Set([...testIntervals.flat(), ...groups.flatMap(([, values]) => values.flat())])].sort((a, b) => a - b);
  const totals = {};
  for (let i = 1; i < boundaries.length; i++) {
    const start = boundaries[i - 1], end = boundaries[i];
    if (!testIntervals.some(([from, to]) => start >= from && end <= to)) continue;
    const name = groups.find(([, values]) => values.some(([from, to]) => start >= from && end <= to))?.[0] ?? 'other_actions_assertions_and_scheduling';
    totals[name] = (totals[name] ?? 0) + end - start;
  }
  return Object.fromEntries(Object.entries(totals).map(([name, ms]) => [name, round(ms)]));
}

const tests = events.filter(event => event.event === 'test.end').map(result => {
  const begin = events.findLast(event => event.event === 'test.begin' && event.test === result.test && event.at <= result.at);
  const matching = events.filter(event => event.test === result.test && event.at >= begin.at && event.at <= result.at);
  const before = matching.find(event => event.event === 'step' && event.title === 'Before Hooks');
  const after = matching.find(event => event.event === 'step' && event.title === 'After Hooks');
  return { test: result.test, status: result.status, wall_ms: result.at - begin.at, reported_ms: result.ms,
    before_hooks_ms: before?.ms ?? 0, body_including_manual_setup_ms: before && after ? after.start - before.start - before.ms : null,
    after_hooks_ms: after?.ms ?? 0, phases: phases(matching.filter(event => event.event === 'span')),
    browser_operations: phases(matching.filter(event => event.event === 'step' && event.category === 'pw:api' && event.children === 0)
      .map(event => ({ ...event, phase: event.title }))) };
});

const startups = [];
for (const batch of events.filter(event => event.event === 'startup')) {
  const markers = batch.events;
  for (let i = 0; i < markers.length; i++) {
    const auth = markers[i];
    if (auth.stage !== 'auth.changed' || !auth.signedIn) continue;
    const next = markers.findIndex((event, index) => index > i && event.stage === 'auth.changed');
    const segment = markers.slice(i, next < 0 ? undefined : next);
    const marker = name => segment.find(event => event.stage === name);
    const membership = marker('membership.snapshot');
    const notebook = segment.find(event => event.stage === 'ui.state' && event.state === 'notebook');
    const saved = segment.find(event => event.stage === 'ui.state' && event.save === 'saved');
    const delta = (end, start = auth) => end && start ? round(end.at - start.at) : null;
    startups.push({ test: batch.test, page: batch.page, active: membership?.active, cached: membership?.cached,
      auth_to_session_ms: delta(marker('session.ready')), session_to_membership_ms: delta(membership, marker('session.ready')),
      membership_to_restored_ms: delta(marker('drafts.restore.end'), membership),
      notes_sources_ms: Object.fromEntries(['everyone', 'participant', 'legacy'].map(source => [source,
        delta(segment.find(event => event.stage === 'notes.source' && event.source === source), marker('notes.subscribe'))])),
      auth_to_notebook_ms: delta(notebook), auth_to_saved_ms: delta(saved),
      last_stage: segment.at(-1)?.stage });
  }
}

const run = last('runner.end'), command = events.find(event => event.event === 'command.start' && event.command === 'firebase');
const testIntervals = events.filter(event => event.event === 'test.end').map(result => [
  events.findLast(event => event.event === 'test.begin' && event.test === result.test && event.at <= result.at).at, result.at,
]);
const output = {
  source: file, complete: !!run, outcome: last('playwright.end')?.status, test_count: tests.length,
  ms: {
    total_runner: run?.ms ?? null, process_imports: first('runner.begin')?.processStartupMs ?? null,
    vite_start: first('span')?.phase === 'services.vite.start' ? first('span').ms : null,
    firebase_start: command && first('services.ready') ? first('services.ready').at - command.at : null,
    firestore_to_script: between('services.firestore.ready', 'services.ready'),
    collection: between('services.ready', 'playwright.begin'),
    playwright_wall: between('playwright.begin', 'playwright.end'),
    before_hooks: sum(tests.map(test => test.before_hooks_ms)), body_including_manual_setup: sum(tests.map(test => test.body_including_manual_setup_ms ?? 0)),
    after_hooks: sum(tests.map(test => test.after_hooks_ms)),
    worker_and_dispatch: between('playwright.begin', 'playwright.end') === null ? null : between('playwright.begin', 'playwright.end') - sum(tests.map(test => test.wall_ms)),
    service_shutdown: between('playwright.end', 'command.end'),
  },
  classified_test_ms: classifiedTime(testIntervals),
  phase_totals: phases(events.filter(event => event.event === 'span')), tests, startups,
};
console.log(JSON.stringify(output, null, 2));

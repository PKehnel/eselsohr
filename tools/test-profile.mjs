import { appendFileSync } from 'node:fs';
import { basename } from 'node:path';

let currentTest;
export const profiling = () => !!process.env.ESELSOHR_PROFILE;
export function profileTest(title) { currentTest = title; }
export function record(event, data = {}) {
  const file = process.env.ESELSOHR_PROFILE;
  if (file) appendFileSync(file, `${JSON.stringify({ event, at: Date.now(), pid: process.pid, test: currentTest, ...data })}\n`);
}
export async function measure(phase, action) {
  if (!profiling()) return action();
  const start = performance.now(), at = Date.now();
  let okay = false;
  try { const result = await action(); okay = true; return result; }
  finally { record('span', { phase, start: at, ms: performance.now() - start, okay }); }
}

export default class ProfileReporter {
  onBegin(_config, suite) { record('playwright.begin', { tests: suite.allTests().length }); }
  onTestBegin(test) { record('test.begin', { test: test.title, file: basename(test.location.file) }); }
  onStepEnd(test, _result, step) {
    // API titles can contain typed passwords/content. Keep operation names only.
    const operation = step.title.match(/^(Create context|Create page|Close context|Close page|Launch browser|Navigate|Reload|Fill|Click|Check|Press|Evaluate|Expect|Wait)/)?.[0];
    record('step', { test: test.title, category: step.category,
      title: step.category === 'pw:api' || step.category === 'expect' ? operation ?? step.category : step.title,
      start: step.startTime.getTime(), ms: step.duration, children: step.steps.length,
      parent: step.parent?.category, file: step.location && basename(step.location.file), line: step.location?.line });
  }
  onTestEnd(test, result) { record('test.end', { test: test.title, start: result.startTime.getTime(), ms: result.duration, status: result.status }); }
  onEnd(result) { record('playwright.end', { status: result.status, ms: result.duration }); }
}

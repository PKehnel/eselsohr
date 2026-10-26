import assert from 'node:assert/strict';
import { test as base } from 'playwright/test';
import { emulatorFixtures } from './emulator.mjs';
import { requireEmulatorApp, signIn, saved } from './browser.mjs';
import { measure, record, profileTest, profiling } from '../tools/test-profile.mjs';
import { profileBrowser } from './profile-startup.mjs';

record('test-module.loaded', { processStartupMs: performance.now() });

function memberPage(index) {
  return async ({ browser, fixture, errors }, use) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await signIn(page, fixture.users[index], fixture.password);
      await saved(page);
      await use(page);
    } finally { await context.close(); }
  };
}

export const test = base.extend({
  ...(profiling() ? {
    browser: [async ({ browser }, use) => profileBrowser(browser, () => use(browser)), { scope: 'worker' }],
    _profile: [async ({}, use, testInfo) => {
      profileTest(testInfo.title);
      try { await use(); } finally { profileTest(undefined); }
    }, { auto: true }],
  } : {}),
  fixture: async ({}, use) => {
    await measure('fixture.config', requireEmulatorApp);
    const fixture = emulatorFixtures();
    try {
      await measure('fixture.users', () => fixture.createUsers());
      await measure('fixture.seed', () => fixture.seedNotebook());
      await use(fixture);
    } finally { await measure('fixture.cleanup', () => fixture.cleanup()); }
  },
  errors: async ({}, use) => {
    const errors = [];
    await use(errors);
    assert.deepEqual(errors, [], 'No uncaught browser errors');
  },
  p: memberPage(0),
  q: memberPage(1),
  r: memberPage(2),
  clockedPage: async ({ browser, fixture, errors }, use) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.clock.install();
      await signIn(page, fixture.users[0], fixture.password);
      await saved(page);
      await use(page);
    } finally { await context.close(); }
  },
});

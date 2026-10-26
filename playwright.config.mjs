import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: ['acceptance.mjs', 'sharing.mjs', 'typing.mjs', 'guidelines.mjs', 'tabs.mjs', 'presentation.mjs', 'note-cards.mjs', 'artwork.mjs'],
  workers: 1,
  retries: 0,
  timeout: 120000,
  use: { channel: 'chrome', headless: true, viewport: { width: 390, height: 844 } },
  reporter: process.env.ESELSOHR_PROFILE ? [['list'], ['./tools/test-profile.mjs']] : 'list',
  outputDir: 'test-artifacts/playwright',
  preserveOutput: 'failures-only',
});

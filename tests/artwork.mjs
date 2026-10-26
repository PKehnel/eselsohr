import assert from 'node:assert/strict';
import { expect } from 'playwright/test';
import { test } from './fixtures.mjs';
import { origin, screenshot, pauseClock } from './browser.mjs';
import { mountFamilyScene } from './motion-scene.mjs';
import { verifyChaseStride } from './chase.mjs';

test('running artwork has moving joints, planted feet and distinct interactions', async ({ page, errors }) => {
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install();
  await page.goto(origin);
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  await pauseClock(page);
  await mountFamilyScene(page);
  await page.clock.runFor(30001);
  await expect(page.locator('.donkey-family')).toBeVisible();
  await verifyChaseStride(page);
  await screenshot(page, 'donkey-stride.png');
  await page.evaluate(() => { window.motionCheck.destroy(); window.familyHome.dispose(); });
});

test('bin-toss artwork makes its slower loop and returns to the path', async ({ page, errors }) => {
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  const loop = await page.evaluate(async () => {
    const { DonkeyMotion } = await import('/src/views/donkey-motion.ts');
    const stage = document.createElement('div'); stage.className = 'motion-stage';
    const source = document.createElement('div'); source.className = 'save-companion preview-companion';
    const bin = document.createElement('div'); bin.className = 'preview-bin';
    stage.append(source, bin); document.body.replaceChildren(stage);
    const motion = window.artworkMotion = new DonkeyMotion();
    motion.attach(source); motion.preview('toss', bin);
    const paper = stage.querySelector('.flying-note');
    // Freeze the real Web Animation in the same rendering turn as creation.
    const animation = paper.getAnimations()[0]; animation.pause();
    const duration = animation.effect.getTiming().duration;
    const points = [.32, .425, .53, .635, .74].map(offset => {
      animation.currentTime = duration * offset;
      const box = paper.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    });
    return { duration, points };
  });
  assert.ok(loop.duration >= 1600);
  const [start, right, bottom, left, end] = loop.points;
  assert.ok(right.x > start.x + 15 && left.x < start.x - 15 && bottom.y > start.y + 25);
  assert.ok(Math.abs(end.x - start.x) < 1 && Math.abs(end.y - start.y) < 1, 'paper returns to the start of its small loop');
  await screenshot(page, 'bin-toss-loop.png');
  await page.evaluate(() => window.artworkMotion.destroy());
  await expect(page.locator('.flying-note')).toHaveCount(0);
});

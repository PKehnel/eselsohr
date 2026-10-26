import assert from 'node:assert/strict';
import { expect } from 'playwright/test';

async function sample(page) {
  return page.locator('.running-donkey').evaluateAll(actors => actors.map(actor => ({
    character: actor.dataset.character, x: actor.getBoundingClientRect().x,
    legs: [...actor.querySelectorAll('.running-hoof')].map(hoof => {
      const point = new DOMPoint(hoof.cx.baseVal.value, hoof.cy.baseVal.value).matrixTransform(hoof.getScreenCTM());
      return { leg: hoof.parentElement.dataset.leg, step: hoof.dataset.step, contact: hoof.dataset.contact === 'true', x: point.x, y: point.y,
        localX: hoof.cx.baseVal.value, shape: hoof.parentElement.querySelector('path').getAttribute('d') };
    }),
  })));
}

// These inspect rendered feet, not just the presence of an animation object.
// The old single frozen frame cannot pass the changing joints/grounding checks.
export async function verifyChaseStride(page) {
  await page.clock.runFor(2700);
  const initial = await sample(page);
  assert.deepEqual(initial.map(actor => actor.character), ['cat', 'turtle', 'monkey']);
  let previous = initial, planted = 0;
  const movingLegs = new Set();
  for (let step = 0; step < 8; step++) {
    await page.clock.runFor(50);
    const current = await sample(page);
    for (const [index, actor] of current.entries()) {
      assert.ok(actor.x >= previous[index].x - .01, 'each running body advances');
      for (const [legIndex, hoof] of actor.legs.entries()) {
        const old = previous[index].legs[legIndex];
        if (old.shape !== hoof.shape) movingLegs.add(actor.character);
        if (hoof.contact && old.contact && hoof.step === old.step) {
          assert.ok(Math.abs(hoof.x - old.x) < .15, `${actor.character} supporting hoof slides horizontally`);
          assert.ok(Math.abs(hoof.y - old.y) < .15, `${actor.character} supporting hoof lifts off the ground`);
          planted++;
        }
      }
    }
    previous = current;
  }
  assert.equal(movingLegs.size, 3, 'all three sets of joints actually move');
  assert.ok(planted >= 12, 'several actual footfalls stay planted while the bodies move');
  await page.clock.runFor(700); // 3.8s: leader has stopped and turned its head.
  await expect(page.locator('.donkey-cat [data-looking-back=true]')).toHaveCount(1);
  const waiting = (await sample(page))[0].x;
  await page.clock.runFor(500);
  assert.ok(Math.abs((await sample(page))[0].x - waiting) < .01, 'leader waits for the youngsters');
  const ear = page.locator('.donkey-turtle [data-length]').first();
  const before = await ear.getAttribute('transform');
  await page.clock.runFor(100);
  assert.notEqual(await ear.getAttribute('transform'), before, 'turtle-like youngster answers the nudge with an ear flap');
  await page.clock.runFor(700); // 5.1s: monkey-like youngster is bounding ahead.
  const airborne = (await sample(page))[2];
  assert.ok(airborne.legs.every(hoof => !hoof.contact), 'playful youngster leaves the ground during its hop');
  const grounded = (await sample(page))[1].legs.filter(hoof => hoof.contact);
  assert.ok(grounded.length >= 1);
  assert.ok(Math.max(...airborne.legs.map(hoof => hoof.y)) < grounded[0].y - 15, 'hop has visible height above its slower companion');
}

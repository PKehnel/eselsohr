// The actual HomeView and motion engine, with in-memory cards and no notebook writes.
export async function mountFamilyScene(page) {
  await page.evaluate(async () => {
    const { DonkeyMotion } = await import('/src/views/donkey-motion.ts');
    const { HomeView } = await import('/src/views/home.ts');
    window.mountFamilyCheck = (count = 1) => {
      window.motionCheck?.destroy(); window.familyHome?.dispose();
      const companion = document.createElement('div'); companion.className = 'save-companion';
      const noop = () => {};
      const home = new HomeView('active', 'all', { companion, open: noop, create: noop, filter: noop, navigate: noop, changeState: noop, pin: noop, sharing: noop });
      window.familyHome = home;
      document.body.replaceChildren(home.root);
      const motion = new DonkeyMotion(); motion.attach(companion);
      window.motionCheck = motion;
      window.fillFamilyNotes = amount => home.update(Array.from({ length: amount }, (_, index) => ({ id: `family-${index}`, title: 'A small daydream', kind: 'text', body: 'A little space to think.', pinned: false, state: 'active', createdAt: null })), [], new Map(), false);
      window.fillFamilyNotes(count);
    };
    window.mountFamilyCheck();
    const image = new Image(); image.src = '/themes/donkey-v1/idle-blink.webp'; await image.decode();
  });
}

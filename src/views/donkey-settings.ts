import { button, element } from './dom';
import { art, iconButtonLabel } from './icons';
import { DonkeyMotion } from './donkey-motion';

// A disposable, local-only stage lets each proposal be reviewed without changing notes.
export function donkeySettings(motion: DonkeyMotion) {
  const dialog = element('dialog', 'donkey-settings'); dialog.setAttribute('aria-label', 'Donkey animations');
  const preview = new DonkeyMotion();
  const top = element('div', 'settings-heading');
  const close = button('×', 'plain back-button', () => dialog.close()); iconButtonLabel(close, 'Close');
  top.append(element('h2', '', 'Donkey animations'), close);
  const stage = element('div', 'motion-stage'); stage.setAttribute('aria-hidden', 'true');
  const donkey = element('div', 'save-companion preview-companion'); donkey.append(art('online-sage', '●'));
  const bin = element('div', 'preview-bin'); bin.append(art('bin', '▣'));
  stage.append(donkey, bin);
  const toggle = button('Donkey animations', 'plain motion-toggle', () => {
    motion.setEnabled(!motion.allowed); preview.setEnabled(motion.allowed); update();
  });
  toggle.setAttribute('aria-label', 'Donkey animations');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const explanation = element('p', 'muted');
  const choices = element('div', 'motion-choices');
  let previewFrame: number | undefined;
  for (const [kind, label] of [['idle', 'Preview blink'], ['completion', 'Preview pounce'], ['toss', 'Preview bin toss'], ['family', 'Preview donkey chase']] as const) {
    choices.append(button(label, 'plain', () => {
      if (previewFrame !== undefined) cancelAnimationFrame(previewFrame);
      const box = stage.getBoundingClientRect(), frame = dialog.getBoundingClientRect();
      if (box.top < frame.top + 16 || box.bottom > frame.bottom - 16) dialog.scrollTop += box.top - frame.top - 16;
      // The control may have scrolled a large-text dialog. Let that scroll finish
      // before starting, so its activity event cannot cancel the new preview.
      previewFrame = requestAnimationFrame(() => {
        previewFrame = undefined;
        if (dialog.open) preview.preview(kind, kind === 'family' ? stage : bin);
      });
    }));
  }
  function update() {
    toggle.setAttribute('aria-pressed', String(motion.allowed));
    explanation.textContent = reduced.matches ? 'Your device has reduced motion on.' : '';
    explanation.hidden = !reduced.matches;
    for (const choice of choices.querySelectorAll('button')) choice.disabled = !motion.allowed || reduced.matches;
  }
  reduced.addEventListener('change', update);
  dialog.append(top, stage, toggle, explanation, choices);
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { if (previewFrame !== undefined) cancelAnimationFrame(previewFrame); preview.destroy(); reduced.removeEventListener('change', update); dialog.remove(); }, { once: true });
  update(); document.body.append(dialog); dialog.showModal(); preview.attach(donkey);
  return dialog;
}

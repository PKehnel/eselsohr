// Leave vertical gestures to the browser; only capture a deliberate horizontal drag.
export function swipe(target: HTMLElement, move: (distance: number) => void, finish: (distance: number) => void) {
  let start: { x: number; y: number; id: number } | null = null;
  let dragging = false;
  let distance = 0;
  let suppressClick = false;
  target.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    start = { x: event.clientX, y: event.clientY, id: event.pointerId };
    dragging = false; distance = 0; suppressClick = false;
  });
  target.addEventListener('pointermove', event => {
    if (!start || event.pointerId !== start.id) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (!dragging) {
      if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) { suppressClick = true; start = null; return; }
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
      dragging = true; suppressClick = true;
      target.setPointerCapture(event.pointerId);
    }
    event.preventDefault(); distance = dx; move(dx);
  });
  const end = (event: PointerEvent) => {
    if (!start || event.pointerId !== start.id) return;
    const captured = start.id; start = null;
    if (dragging) finish(event.type === 'pointerup' ? distance : 0);
    dragging = false;
    if (target.hasPointerCapture(captured)) target.releasePointerCapture(captured);
  };
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
  // Touch starts with implicit capture on the tapped child. Transferring that
  // capture to the row must not look like cancellation of the row's gesture.
  target.addEventListener('lostpointercapture', event => { if (event.target === target) end(event); });
  target.addEventListener('click', event => {
    if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false; }
  }, true);
}

// Notes and checklist items share the same reveal, release and cancel behavior.
export function swipeAction(wrapper: HTMLElement, content: HTMLElement, action: HTMLButtonElement, commit: () => void, options: { dragging?: (active: boolean) => void; indent?: (right: boolean) => void } = {}) {
  const threshold = () => Math.min(180, Math.max(120, wrapper.clientWidth * .55));
  const revealAt = options.indent ? 96 : 36;
  const reveal = (distance: number) => {
    action.hidden = distance <= 0;
    wrapper.classList.toggle('swipe-ready', distance >= threshold());
    content.style.transform = `translateX(${Math.max(0, Math.min(distance, wrapper.clientWidth * .8))}px)`;
  };
  const reset = () => { content.style.transform = ''; action.hidden = true; wrapper.classList.remove('swipe-ready', 'indent-ready'); };
  action.hidden = true;
  action.addEventListener('click', () => { reset(); commit(); });
  swipe(content, distance => {
    if (action.disabled) return;
    options.dragging?.(true);
    if (options.indent && distance < revealAt) {
      reset(); wrapper.classList.toggle('indent-ready', Math.abs(distance) >= 56);
    } else { wrapper.classList.remove('indent-ready'); reveal(distance); }
  }, distance => {
    options.dragging?.(false);
    if (action.disabled) { reset(); return; }
    if (distance >= threshold()) { reset(); commit(); }
    else {
      reset();
      if (options.indent) {
        // The bin is a drag preview here: releasing short of deletion finishes
        // indentation and returns the row, including after entering the bin zone.
        if (Math.abs(distance) >= 56) options.indent(distance > 0);
      } else if (distance >= revealAt) reveal(80);
    }
  });
}

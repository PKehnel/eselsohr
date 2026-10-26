import { element } from './dom';
import { DonkeyCharacter, type Personality } from './donkey-character';

export type RunArea = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;
export const chaseHeight = 144;
type Stop = { time: number; x: number; speed: number };
const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
const beat = (time: number, from: number, to: number, edge = 160) => smooth((time - from) / edge) * smooth((to - time) / edge);

// Cubic paths slow to a real stop. Stride phase follows distance, so a supporting
// hoof stays in one world position while the body passes over it.
function journey(stops: Stop[], time: number) {
  if (time <= stops[0].time) return { x: stops[0].x, speed: 0 };
  const next = stops.findIndex(stop => stop.time > time);
  if (next < 0) return { x: stops.at(-1)!.x, speed: 0 };
  const a = stops[next - 1], b = stops[next], duration = (b.time - a.time) / 1000;
  const slope = (b.x - a.x) / duration;
  const va = Math.min(a.speed, 2 * slope), vb = Math.min(b.speed, 2 * slope);
  const p = (time - a.time) / (b.time - a.time), p2 = p * p, p3 = p2 * p;
  const x = (2 * p3 - 3 * p2 + 1) * a.x + (p3 - 2 * p2 + p) * duration * va + (-2 * p3 + 3 * p2) * b.x + (p3 - p2) * duration * vb;
  const speed = ((6 * p2 - 6 * p) * a.x + (3 * p2 - 4 * p + 1) * duration * va + (-6 * p2 + 6 * p) * b.x + (3 * p2 - 2 * p) * duration * vb) / duration;
  return { x, speed: Math.max(0, speed) };
}

export function runningDonkeys(area: RunArea) {
  const root = element('div', 'donkey-family'); root.setAttribute('aria-hidden', 'true');
  Object.assign(root.style, { left: `${area.left}px`, top: `${area.top}px`, width: `${area.width}px`, height: `${area.height}px` });
  const width = area.width, pace = Math.max(1, Math.min(1.5, width / 380)), fit = Math.min(1, width / 330);
  const cast: { personality: Personality; size: number; stops: Stop[] }[] = [
    { personality: 'cat', size: 142, stops: [
      { time: 0, x: -90, speed: 90 }, { time: 1900, x: width * .18, speed: 75 },
      { time: 3300, x: width * .64, speed: 0 }, { time: 4700, x: width * .64, speed: 0 },
      { time: 6000, x: width * .9, speed: 90 }, { time: 7800, x: width + 90, speed: 80 },
    ] },
    { personality: 'turtle', size: 104, stops: [
      { time: 1000, x: -65, speed: 38 }, { time: 2600, x: width * .06, speed: 50 },
      { time: 4200, x: width * .32, speed: 0 }, { time: 4700, x: width * .32, speed: 0 },
      { time: 5900, x: width * .46, speed: 65 }, { time: 10000, x: width + 65, speed: 55 },
    ] },
    { personality: 'monkey', size: 96, stops: [
      { time: 1750, x: -65, speed: 90 }, { time: 3100, x: width * .18 - 35, speed: 75 },
      { time: 3850, x: width * .32 - 54 * fit, speed: 0 }, { time: 4750, x: width * .32 - 54 * fit, speed: 0 },
      { time: 5450, x: width * .48, speed: 115 }, { time: 9100, x: width + 65, speed: 75 },
    ] },
  ];
  const actors = cast.map(role => {
    const drawing = new DonkeyCharacter(role.personality, role.size * fit); root.append(drawing.root);
    return { ...role, drawing };
  });
  let frame: number | undefined, stopped = false;
  let complete!: () => void;
  const finished = new Promise<void>(resolve => { complete = resolve; });
  const start = performance.now();
  const render = (now: number) => {
    if (stopped) return;
    const time = (now - start) / pace;
    root.dataset.beat = time < 3300 ? 'running' : time < 4750 ? 'checking-back' : time < 5500 ? 'leapfrog' : 'running-home';
    for (const actor of actors) {
      const state = journey(actor.stops, time), type = actor.personality;
      const look = type === 'cat' ? beat(time, 3510, 4590, 180) : 0;
      const nudge = type === 'monkey' ? beat(time, 4010, 4490, 180) : 0;
      const hop = type === 'monkey' && time > 4750 && time < 5450 ? Math.sin((time - 4750) / 700 * Math.PI) * 29 * fit : 0;
      const reaction = type === 'turtle' ? beat(time, 4210, 4630, 110) : type === 'cat' ? beat(time, 3600, 3960, 100) : 0;
      actor.drawing.root.style.transform = `translate(${state.x - 80 * actor.drawing.scale}px, ${area.height - 144 * actor.drawing.scale - 7}px)`;
      actor.drawing.root.hidden = time < actor.stops[0].time || time >= actor.stops.at(-1)!.time;
      actor.drawing.draw({ distance: state.x - actor.stops[0].x, speed: state.speed / pace, time, look, nudge, hop, reaction });
    }
    if (time >= 10100) { stopped = true; complete(); }
    else frame = requestAnimationFrame(render);
  };
  render(start);
  return { root, finished, cancel() { stopped = true; if (frame !== undefined) cancelAnimationFrame(frame); complete(); } };
}

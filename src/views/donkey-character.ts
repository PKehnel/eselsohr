// Soft, squat ink donkeys, articulated without stretching the familiar silhouette.
const ns = 'http://www.w3.org/2000/svg', ink = '#1d1b18';
export type Personality = 'cat' | 'turtle' | 'monkey';
type Point = { x: number; y: number };
type Leg = { outline: SVGPathElement; hoof: SVGEllipseElement; x: number; far: boolean; front: boolean };
export interface CharacterPose {
  distance: number; speed: number; time: number; look: number; nudge: number; hop: number; reaction: number;
}
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: SVGElement) {
  const node = document.createElementNS(ns, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  parent?.append(node); return node;
}
const smooth = (x: number) => { const n = Math.max(0, Math.min(1, x)); return n * n * (3 - 2 * n); };
const round = (n: number) => Number(n.toFixed(3));

export class DonkeyCharacter {
  readonly root = document.createElement('div');
  readonly scale: number;
  private drawing: SVGSVGElement;
  private torso: SVGGElement;
  private head: SVGGElement;
  private ears: SVGGElement[] = [];
  private tail: SVGPathElement;
  private eye: SVGPathElement;
  private shadow: SVGEllipseElement;
  private legs: Leg[] = [];
  private fill: string;
  private stride: number;
  private stance: number;

  constructor(readonly personality: Personality, readonly size: number) {
    this.root.className = `running-donkey donkey-${personality}`; this.root.dataset.character = personality;
    this.scale = size / 164;
    this.root.style.width = `${size}px`; this.root.style.height = `${152 * this.scale}px`;
    this.fill = personality === 'turtle' ? '#e3e8d8' : personality === 'monkey' ? '#f8ecd5' : '#fff8eb';
    this.stride = personality === 'cat' ? 57 : personality === 'turtle' ? 43 : 49;
    this.stance = personality === 'turtle' ? .71 : personality === 'monkey' ? .42 : .49;
    this.drawing = svg('svg', { viewBox: '0 0 164 152', 'aria-hidden': 'true', focusable: 'false', fill: this.fill, stroke: ink, 'stroke-width': 4.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
    this.root.append(this.drawing);
    this.shadow = svg('ellipse', { cx: 73, cy: 147, rx: 33, ry: 3, fill: '#82917c', stroke: 'none', opacity: .18 }, this.drawing);
    const far = svg('g', {}, this.drawing);
    const tailGroup = svg('g', {}, this.drawing);
    this.tail = svg('path', { fill: 'none', 'stroke-width': personality === 'monkey' ? 4 : 3.4 }, tailGroup);
    this.makeLeg(far, 49, true, false); this.makeLeg(far, 87, true, true);
    this.torso = svg('g', {}, this.drawing);
    svg('path', { d: personality === 'turtle'
      ? 'M25 108 C23 89 36 83 53 87 C65 85 81 89 93 97 C108 99 114 112 108 122 C102 133 83 133 68 130 C47 134 24 131 25 108Z'
      : personality === 'monkey'
        ? 'M27 103 C25 85 38 80 53 85 C68 90 79 84 93 94 C107 98 114 110 107 122 C100 132 82 128 69 127 C49 133 25 128 27 103Z'
        : 'M25 104 C22 85 38 79 55 85 C70 90 82 86 96 95 C109 100 115 112 108 123 C101 133 82 132 67 128 C47 133 23 128 25 104Z' }, this.torso);
    svg('path', { d: personality === 'turtle'
      ? 'M78 110 C79 96 80 82 92 74 Q111 69 122 88 L114 115Z'
      : 'M78 108 C78 92 79 75 93 65 Q112 61 125 82 L115 113Z', stroke: 'none' }, this.torso);
    svg('path', { d: personality === 'turtle' ? 'M81 99 Q79 83 92 74' : 'M80 97 Q77 77 93 65', fill: 'none' }, this.torso);
    svg('path', { d: 'M82 85 Q77 88 79 93 L76 97 Q79 101 84 99 L82 104 Q86 108 92 105 Q85 99 86 89Z', fill: ink, stroke: 'none', transform: personality === 'turtle' ? 'translate(0 8)' : '' }, this.torso);
    const near = svg('g', {}, this.drawing);
    this.makeLeg(near, 42, false, false); this.makeLeg(near, 96, false, true);
    this.head = svg('g', {}, this.drawing);
    this.makeEar(-13, -25, -19, personality === 'turtle' ? 35 : personality === 'monkey' ? 38 : 42);
    this.makeEar(9, -25, personality === 'monkey' ? 27 : 15, personality === 'turtle' ? 41 : personality === 'monkey' ? 40 : 46);
    svg('path', { d: 'M-25 -9 C-25 -22 -16 -32 -3 -31 C11 -34 20 -22 22 -12 C33 -7 36 4 30 16 C23 28 6 28 -7 19 C-23 18 -29 7 -25 -9Z' }, this.head);
    svg('path', { d: personality === 'monkey'
      ? 'M-23 -22 Q-30 -31 -17 -28 L-9 -40 Q-5 -44 -3 -31 Q7 -38 12 -34 L8 -27 Q22 -28 19 -20 Q9 -16 2 -24 Q-3 -12 -8 -20 Q-19 -13 -16 -23Z'
      : personality === 'turtle'
        ? 'M-23 -24 Q-22 -31 -15 -28 Q-10 -35 -5 -29 Q2 -34 7 -28 Q18 -29 16 -22 Q5 -17 0 -24 Q-8 -17 -10 -23 Q-20 -17 -18 -24Z'
        : 'M-24 -25 Q-28 -32 -16 -29 Q-11 -40 -6 -30 Q3 -39 6 -29 Q17 -34 17 -26 Q24 -21 16 -20 Q7 -16 2 -24 Q-3 -15 -8 -21 Q-21 -13 -18 -24Z', fill: ink, stroke: ink, 'stroke-width': 1.5 }, this.head);
    this.eye = svg('path', { d: '', fill: ink, 'stroke-width': 1.4 }, this.head);
    svg('path', { d: 'M-15 -18 Q-11 -23 -6 -20 M9 -23 Q14 -25 18 -20', fill: 'none', 'stroke-width': 2.8 }, this.head);
    svg('path', { d: 'M-16 9 Q-8 24 7 17', fill: 'none', 'stroke-width': 3.3 }, this.head);
    svg('ellipse', { cx: 22, cy: 12, rx: 20, ry: 15, fill: '#fff8eb', 'stroke-width': 3.9 }, this.head);
    svg('ellipse', { cx: 17, cy: 9, rx: 2.1, ry: 2.8, fill: ink, stroke: 'none' }, this.head);
    svg('ellipse', { cx: 31, cy: 11, rx: 2, ry: 2.6, fill: ink, stroke: 'none' }, this.head);
    this.draw({ distance: 0, speed: 0, time: 0, look: 0, nudge: 0, hop: 0, reaction: 0 });
  }

  private makeLeg(parent: SVGGElement, x: number, far: boolean, front: boolean) {
    const group = svg('g', { 'data-leg': `${far ? 'far' : 'near'}-${front ? 'front' : 'back'}` }, parent);
    const outline = svg('path', { fill: far ? '#daddce' : this.fill, stroke: ink, 'stroke-width': 3.8 }, group);
    const hoof = svg('ellipse', { cx: x, cy: 142, rx: 7.3, ry: 4.8, fill: ink, stroke: 'none', class: 'running-hoof' }, group);
    this.legs.push({ outline, hoof, x, far, front });
  }
  private makeEar(x: number, y: number, lean: number, length: number) {
    const group = svg('g', {}, this.head);
    group.dataset.x = String(x); group.dataset.y = String(y); group.dataset.lean = String(lean); group.dataset.length = String(length);
    svg('path', { d: `M-7 2 C-12 ${-length * .35} -14 ${-length * .85} -5 ${-length} Q0 ${-length - 6} 6 ${-length + 1} C15 ${-length * .7} 13 ${-length * .2} 7 2Z` }, group);
    svg('path', { d: `M0 -7 Q-4 ${-length * .55} 0 ${-length + 8}`, stroke: ink, 'stroke-width': 4.3, fill: 'none' }, group);
    this.ears.push(group);
  }

  draw(pose: CharacterPose) {
    const { distance, time, look, nudge, hop, reaction } = pose;
    const cycles = distance / (this.stride * this.scale);
    const phase = cycles - Math.floor(cycles), wave = Math.sin(phase * Math.PI * 2);
    const running = smooth(pose.speed / 24);
    const turtle = this.personality === 'turtle', monkey = this.personality === 'monkey';
    const bob = -running * (turtle ? 1 : monkey ? 2.7 : 3) * (1 - Math.cos(phase * Math.PI * (this.personality === 'cat' ? 2 : 4))) - hop / this.scale;
    const pitch = running * wave * (turtle ? .7 : monkey ? 2.7 : 1.5) + nudge * -6;
    this.torso.setAttribute('transform', `translate(0 ${round(bob)}) rotate(${round(pitch)} 69 97)`);
    const offsets = turtle ? [0, .5, .5, 0] : monkey ? [.08, .58, .5, 0] : [0, .54, .1, .64];
    for (const [index, leg] of this.legs.entries()) {
      const p = (cycles + offsets[index]) % 1;
      const contact = (p < this.stance || running < .05) && hop < .5;
      const reach = this.stride * this.stance / 2, swing = (p - this.stance) / (1 - this.stance);
      let footX = leg.x + running * (p < this.stance ? reach - this.stride * p : -reach + 2 * reach * smooth(swing));
      let footY = 144 - (p < this.stance ? 0 : running * (turtle ? 9 : monkey ? 22 : 17) * Math.sin(Math.PI * swing));
      if (hop > 0) { footY -= hop / this.scale + 14 * Math.min(1, hop / 10); footX += leg.front ? -7 : 5; }
      if (look > .2 && leg.front && leg.far) { footY -= 12 * look; footX += 6 * look; }
      const hip: Point = { x: leg.x, y: (turtle ? 118 : leg.front ? 112 : 113) + bob };
      const angle = pitch * Math.PI / 180;
      const rotated = { x: 69 + (hip.x - 69) * Math.cos(angle) - (hip.y - bob - 97) * Math.sin(angle), y: 97 + bob + (hip.x - 69) * Math.sin(angle) + (hip.y - bob - 97) * Math.cos(angle) };
      const knee = this.knee(rotated, { x: footX, y: footY - 4 }, turtle ? 18 : 21, leg.front ? -1 : 1);
      // An open, filled contour gives a broad haunch and a short tapered leg.
      // Its upper edge blends into the body rather than drawing a joint seam.
      const thigh = leg.front ? 7 : 10;
      const d = `M${round(rotated.x - thigh)} ${round(rotated.y - 3)} Q${round(knee.x - 7)} ${round(knee.y)} ${round(footX - 5.5)} ${round(footY - 5)} Q${round(footX - 7)} ${round(footY + 1)} ${round(footX)} ${round(footY + 1)} Q${round(footX + 7)} ${round(footY + 1)} ${round(footX + 5.5)} ${round(footY - 5)} Q${round(knee.x + 7)} ${round(knee.y)} ${round(rotated.x + thigh)} ${round(rotated.y - 3)}`;
      leg.outline.setAttribute('d', d);
      leg.hoof.setAttribute('cx', String(round(footX))); leg.hoof.setAttribute('cy', String(round(footY - 3)));
      const toe = p < this.stance ? 0 : Math.sin(swing * Math.PI * 2) * 18;
      leg.hoof.setAttribute('transform', `rotate(${round(toe)} ${round(footX)} ${round(footY - 3)})`);
      leg.hoof.dataset.contact = String(contact && !(look > .2 && leg.front && leg.far));
      leg.hoof.dataset.step = String(Math.floor(cycles + offsets[index]));
    }
    const hx = turtle ? 107 : 108, hy = (turtle ? 91 : 82) + bob;
    this.head.setAttribute('transform', `translate(${hx + nudge * 5} ${round(hy - reaction * 2)}) rotate(${round(pitch + (turtle ? 3 : monkey ? -4 : 0) - look * 10 + nudge * 5)}) scale(${round(1 - look * 1.82)} 1)`);
    this.head.dataset.lookingBack = String(look > .8);
    for (const [index, ear] of this.ears.entries()) {
      const flap = running * Math.sin(phase * Math.PI * 2 - .8 - index * .65) * (turtle ? 3 : monkey ? 13 : 7);
      const flick = reaction * Math.sin(time / 46 + index) * (turtle ? 23 : 12);
      const lean = Number(ear.dataset.lean) + flap + flick + (monkey && index === 1 ? nudge * 24 : 0);
      ear.setAttribute('transform', `translate(${ear.dataset.x} ${ear.dataset.y}) rotate(${round(lean)})`);
      if (monkey && index === 1) {
        const length = Number(ear.dataset.length), curl = Math.max(0, wave) * 13 * running + nudge * 7;
        ear.children[0].setAttribute('d', `M-7 2 C-12 ${-length * .35} ${-14 + curl * .5} ${-length * .85} ${-5 + curl} ${-length + curl * .4} Q${curl} ${-length - 6 + curl * .4} ${6 + curl} ${-length + 1 + curl * .4} Q${15 + curl * .5} ${-length * .6} 7 2Z`);
        ear.children[1].setAttribute('d', `M0 -7 Q-4 ${-length * .55} ${curl * .8} ${-length + 8 + curl * .4}`);
      }
    }
    this.eye.setAttribute('d', monkey || reaction > .4 && turtle
      ? 'M-12 -9 Q-7 -15 -3 -9 Q-5 -2 -9 -4Z M10 -13 Q14 -18 18 -12 Q15 -6 12 -8Z'
      : 'M-14 -10 Q-8 -7 -2 -10 Q-3 -3 -8 -4 Q-12 -4 -14 -10Z M9 -14 Q14 -11 19 -14 Q18 -7 14 -8 Q11 -8 9 -14Z');
    this.tail.setAttribute('d', monkey
      ? `M34 ${round(96 + bob)} C9 ${round(88 + bob)} 7 ${round(60 + tailSway(running, wave))} 22 56 C37 51 37 72 25 71 Q16 70 21 63`
      : turtle
        ? `M29 ${round(104 + bob)} Q13 ${round(108 + tailSway(running, wave))} 14 ${round(92 - reaction * 7)} M10 ${round(94 - reaction * 7)} L14 ${round(87 - reaction * 7)} L18 ${round(94 - reaction * 7)}`
        : `M30 ${round(97 + bob)} C11 ${round(103 + tailSway(running, wave))} 5 ${round(86 - look * 8)} 15 ${round(80 - look * 8)} Q23 ${round(76 - look * 8)} 23 ${round(84 - look * 8)}`);
    this.shadow.setAttribute('rx', String(33 - Math.min(15, hop * .45)));
    this.shadow.setAttribute('opacity', String(.18 - Math.min(.1, hop * .003)));
  }
  private knee(hip: Point, foot: Point, length: number, bend: number): Point {
    const dx = foot.x - hip.x, dy = foot.y - hip.y, distance = Math.max(.01, Math.hypot(dx, dy));
    const height = Math.sqrt(Math.max(0, length * length - Math.min(distance / 2, length) ** 2));
    return { x: hip.x + dx * .5 - bend * dy / distance * height, y: hip.y + dy * .5 + bend * dx / distance * height };
  }
}
function tailSway(running: number, wave: number) { return running * wave * 5; }

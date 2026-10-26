import { element } from './dom';

export function art(name: 'online-sage' | 'offline' | 'bin' | 'people', fallback: string) {
  const wrapper = element('span', 'action-art');
  wrapper.setAttribute('aria-hidden', 'true');
  const backup = element('span', 'art-fallback', fallback); backup.hidden = true;
  const image = element('img'); image.src = `/themes/donkey-ui/${name}.webp`;
  image.alt = ''; image.width = image.height = 80;
  image.addEventListener('error', () => { image.hidden = true; backup.hidden = false; });
  wrapper.append(image, backup); return wrapper;
}

export function restoreIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'restore-icon');
  svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', 'M12 15V3m-4 4 4-4 4 4M4 14v6h16v-6');
  svg.append(path); return svg;
}

export function iconButtonLabel(button: HTMLButtonElement, label: string) {
  button.setAttribute('aria-label', label); button.title = label;
}

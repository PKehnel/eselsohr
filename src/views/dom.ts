export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
export function button(text: string, className: string, action: () => void) {
  const node = element('button', className, text);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}
export function donkey() {
  const image = element('img', 'donkey');
  image.src = '/themes/donkey-v1/corner-loaf.webp';
  image.alt = ''; image.width = image.height = 80;
  image.setAttribute('aria-hidden', 'true');
  return image;
}
export function heading(title: string, subtitle?: string, companion: HTMLElement = donkey()) {
  const wrapper = element('header', 'home-head');
  const titles = element('div');
  titles.append(element('h1', '', title));
  if (subtitle) titles.append(element('p', 'muted', subtitle));
  wrapper.append(titles, companion); return wrapper;
}
export function status(text = '') {
  const node = element('p', 'status', text); node.setAttribute('role', 'status'); return node;
}
export function labeledInput(label: string, id: string, type = 'text') {
  const wrapper = element('div', 'field');
  const name = element('label', '', label); name.htmlFor = id;
  const input = element('input', 'input'); input.id = id; input.name = id; input.type = type;
  wrapper.append(name, input); return { wrapper, input };
}

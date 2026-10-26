import type { Member } from '../notes';
import { button, element, heading } from './dom';
export class PeopleView {
  readonly root = element('main', 'shell');
  private list = element('div', 'members');
  constructor(back: () => void, signOut: () => void, companion: HTMLElement) {
    this.root.append(button('‹', 'plain back-button', back), heading('People', undefined, companion), this.list, button('Sign out', 'secondary', signOut));
    this.root.querySelector('button')!.setAttribute('aria-label', 'Back');
  }
  update(members: Member[], uid: string) {
    this.list.replaceChildren();
    for (const member of members.filter(member => member.active).sort((a, b) => a.displayName.localeCompare(b.displayName))) {
      const row = element('div', 'member');
      const avatar = element('span', 'avatar', member.displayName.slice(0, 1).toUpperCase()); avatar.setAttribute('aria-hidden', 'true');
      const names = element('div'); names.append(element('p', 'member-name', member.displayName), element('p', 'muted', member.id === uid ? 'You' : 'Member'));
      row.append(avatar, names); this.list.append(row);
    }
  }
}

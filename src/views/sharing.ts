import type { Member, Sharing } from '../notes';
import { button, element, status } from './dom';
import { iconButtonLabel } from './icons';

interface SharingOptions {
  uid: string;
  creator: string;
  sharing: Sharing;
  members: Member[];
  save?: (sharing: Sharing) => Promise<boolean>;
  closed: () => void;
}

// Every note starts private. One sheet manages its audience afterward.
export class SharingDialog {
  readonly root = element('dialog', 'sharing-dialog');
  private people = element('div', 'sharing-people');
  private explanation = element('p', 'help');
  private feedback = status();
  private choices = element('fieldset', 'sharing-options');
  private selected = new Set<string>();
  private audience: Sharing['audience'];
  private pending = false;

  constructor(private options: SharingOptions) {
    this.audience = options.sharing.audience;
    this.selected = new Set(options.sharing.sharedWith ?? [options.creator]);
    this.selected.add(options.creator);
    this.root.setAttribute('aria-label', 'Sharing');
    const header = element('header', 'settings-heading');
    const close = button('×', 'plain', () => this.root.close()); iconButtonLabel(close, 'Close sharing');
    header.append(element('h2', '', 'Sharing'), close);
    this.choices.append(element('legend', 'sr-only', 'Who can access'));
    for (const [value, label] of [['private', 'Private'], ['selected', 'Selected people'], ['everyone', 'Everyone']] as const) {
      const row = element('label', 'sharing-person');
      const input = element('input'); input.type = 'radio'; input.name = 'audience'; input.value = value;
      input.checked = this.audience === value; input.disabled = !this.editable;
      input.addEventListener('change', () => { this.audience = value; this.renderPeople(); });
      row.append(input, element('span', '', label)); this.choices.append(row);
    }
    this.root.append(header, this.choices, this.explanation, this.people, this.feedback);
    const actions = element('div', 'sharing-actions');
    if (options.save) {
      const save = button('Save', 'secondary', async () => {
        this.pending = true; this.feedback.textContent = 'Saving sharing…';
        this.lock(true);
        const result = await options.save!(this.value());
        this.pending = false;
        if (!this.root.isConnected) return;
        if (result) this.root.close(); else this.lock(false);
      });
      actions.append(save);
    }
    this.root.append(actions);
    this.root.addEventListener('click', event => { if (event.target === this.root && !this.pending) this.root.close(); });
    this.root.addEventListener('cancel', event => { if (this.pending) event.preventDefault(); });
    this.root.addEventListener('close', options.closed);
    this.renderPeople();
  }

  private get editable() { return !!this.options.save; }
  private value(): Sharing {
    return { audience: this.audience, sharedWith: this.audience === 'private' ? [this.options.creator] : this.audience === 'selected' ? [...this.selected] : [] };
  }

  update(members: Member[]) {
    if (this.pending || members === this.options.members) return;
    this.options.members = members;
    this.renderPeople();
  }

  showError(message: string) { this.feedback.textContent = message; this.feedback.classList.add('error'); }

  private lock(locked: boolean) {
    for (const control of this.root.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button,input')) control.disabled = locked || control.dataset.readonly === 'true';
    this.choices.disabled = locked || !this.editable;
  }

  private renderPeople() {
    const { creator, uid, members } = this.options;
    this.people.replaceChildren();
    this.explanation.textContent = this.audience === 'private' ? 'Only you can read and edit this note.' : this.audience === 'everyone' ? 'All active notebook members can edit, including people who join later.' : 'Only the creator and selected people can edit.';
    this.people.hidden = this.audience === 'private';
    const known = new Map(members.map(member => [member.id, member]));
    const ids = new Set([creator, ...this.selected, ...members.filter(member => member.active && (this.editable || this.audience === 'everyone')).map(member => member.id)]);
    const ordered = [...ids].sort((a, b) => a === creator ? -1 : b === creator ? 1 : (known.get(a)?.displayName ?? '').localeCompare(known.get(b)?.displayName ?? ''));
    for (const id of ordered) {
      const member = known.get(id), owner = id === creator;
      const name = member?.displayName || 'Former member';
      const row = element('label', 'sharing-person');
      const names = element('span', 'sharing-name', name);
      if (owner || !member?.active || id === uid) names.append(element('small', 'muted', [owner ? 'Creator' : '', id === uid ? 'You' : '', !member?.active ? 'Inactive' : ''].filter(Boolean).join(' · ')));
      if (this.audience === 'selected') {
        const input = element('input'); input.type = 'checkbox'; input.checked = this.selected.has(id);
        input.setAttribute('aria-label', name);
        input.disabled = !this.editable || owner || !member?.active && !this.selected.has(id);
        input.dataset.readonly = String(input.disabled);
        input.addEventListener('change', () => { if (input.checked) this.selected.add(id); else this.selected.delete(id); });
        row.append(input);
      }
      row.append(names); this.people.append(row);
    }
    if (!this.editable) this.people.append(element('p', 'help', 'Only the creator can change sharing.'));
    this.lock(false);
  }

  dispose() { this.root.close(); this.root.remove(); }
}

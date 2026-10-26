import { adminContext } from './context.mjs';
import { hiddenPassword } from './password.mjs';
import { Timestamp } from 'firebase-admin/firestore';

try {
  const password = await hiddenPassword('Password for synthetic local accounts (12+ characters): ');
  if (password.length < 12) throw new Error('Use at least 12 characters.');
  const { auth, db } = adminContext('demo-eselsohr', true);
  const users = [];
  for (const [name, displayName, active] of [['alex', 'Alex', true], ['sam', 'Sam', true], ['jo', 'Jo', true], ['visitor', 'Visitor', false]]) {
    const email = `${name}@example.test`;
    let user;
    try { user = await auth.getUserByEmail(email); }
    catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
    if (user) await auth.updateUser(user.uid, { password, displayName });
    else user = await auth.createUser({ email, password, displayName });
    if (active) await db.doc(`members/${user.uid}`).set({ displayName, active });
    else await db.doc(`members/${user.uid}`).delete();
    users.push(user);
  }
  // Fixed IDs only in this emulator-only fixture. Re-running preserves edited notes.
  const metadata = { createdBy: users[0].uid, updatedBy: users[0].uid, createdAt: Timestamp.now(), updatedAt: Timestamp.now() };
  const fixtures = [
    ['shopping', { kind: 'checklist', title: 'Weekend shopping', body: '', pinned: true }],
    ['weekend', { kind: 'text', title: 'A little weekend plan', body: 'Coffee, a walk, and something good to cook.\nKeep Saturday afternoon free.', pinned: false }],
    ['remember', { kind: 'text', title: 'Things to remember', body: 'Bring the spare key.\nWater the plants before we leave.', pinned: false }],
  ];
  for (const [id, content] of fixtures) {
    const ref = db.doc(`notebooks/home/notes/${id}`);
    if (!(await ref.get()).exists) {
      await ref.create({ ...content, state: 'active', audience: 'everyone', ...metadata });
      if (content.kind === 'checklist') for (const [index, text] of ['Bread', 'Oat milk', 'Apples'].entries()) await ref.collection('items').doc(`item-${index}`).create({ text, checked: index === 0, ...metadata, createdAt: Timestamp.fromMillis(Date.now() + index) });
    }
  }
  await db.terminate();
  process.stdout.write('Local synthetic accounts: alex@example.test, sam@example.test, jo@example.test. visitor@example.test has no membership. Sample notes ready.\n');
} catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }

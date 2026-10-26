import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { adminContext } from './context.mjs';
import { hiddenPassword } from './password.mjs';

const { values, positionals } = parseArgs({ options: { project: { type: 'string' }, emulator: { type: 'boolean', default: false } }, allowPositionals: true });
const action = positionals[0];
const actions = ['create-user', 'reset-password', 'activate', 'deactivate'];
if (!actions.includes(action) || positionals.length !== 1) {
  process.stderr.write(`Usage: npm run admin -- <${actions.join('|')}> --project PROJECT_ID [--emulator]\n`);
  process.exitCode = 1;
} else {
  let terminal;
  let database;
  try {
    if (!process.stdin.isTTY) throw new Error('Use an interactive terminal for account administration.');
    terminal = createInterface({ input: process.stdin, output: process.stdout });
    if (!values.emulator) {
      const confirmation = await terminal.question(`This changes Firebase project ${values.project}. Type its exact ID: `);
      if (confirmation !== values.project) throw new Error('Project confirmation did not match.');
    }
    const { auth, db } = adminContext(values.project, values.emulator); database = db;
    const email = (await terminal.question('Email address: ')).trim();
    if (!email) throw new Error('Enter the account email address.');
    let displayName;
    if (action === 'create-user' || action === 'activate') {
      displayName = (await terminal.question('Display name: ')).trim();
      if (!displayName || displayName.length > 60) throw new Error('Display name must have 1–60 characters.');
    }
    terminal.close(); terminal = undefined;
    if (['create-user', 'reset-password'].includes(action)) {
      const password = await hiddenPassword();
      const repeat = await hiddenPassword('Repeat password: ');
      if (password !== repeat || password.length < 12) throw new Error('Use matching passwords of at least 12 characters.');
      if (action === 'create-user') {
        const user = await auth.createUser({ email, password, displayName });
        try { await db.doc(`members/${user.uid}`).create({ displayName, active: true }); }
        catch { throw new Error('The account was created, but membership was not granted. Use activate to finish setup; access remains denied.'); }
      } else {
        const user = await auth.getUserByEmail(email);
        await auth.updateUser(user.uid, { password });
        await auth.revokeRefreshTokens(user.uid);
      }
    } else {
      const user = await auth.getUserByEmail(email);
      if (action === 'activate') await db.doc(`members/${user.uid}`).set({ displayName, active: true });
      else {
        await db.doc(`members/${user.uid}`).update({ active: false });
        await auth.revokeRefreshTokens(user.uid);
      }
    }
    process.stdout.write('Account operation completed.\n');
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Administration failed.'}\n`); process.exitCode = 1;
  } finally { terminal?.close(); await database?.terminate(); }
}

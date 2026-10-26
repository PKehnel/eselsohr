// Add queryable access metadata to existing shared notes, without reading content.
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout } from 'node:timers/promises';
import { productionTarget, productionEnv, confirmProject } from './target.mjs';

export async function migrateSharing(db, checkOnly = false) {
  const notes = db.collection('notebooks/home/notes');
  const snapshot = await notes.select('audience').get();
  const missing = snapshot.docs.filter(note => note.get('audience') === undefined);
  if (snapshot.docs.some(note => note.get('audience') !== undefined && !['private', 'everyone', 'selected'].includes(note.get('audience')))) {
    throw new Error('Unexpected sharing metadata. Migration stopped without changing content.');
  }
  if (!checkOnly) {
    for (let start = 0; start < missing.length; start += 400) {
      const batch = db.batch();
      for (const note of missing.slice(start, start + 400)) batch.update(note.ref, { audience: 'everyone' }, { lastUpdateTime: note.updateTime });
      await batch.commit();
    }
    const verified = await notes.select('audience').get();
    if (verified.docs.some(note => !['private', 'everyone', 'selected'].includes(note.get('audience')))) throw new Error('Sharing migration is incomplete; rerun before publishing Hosting.');
  }
  return { scanned: snapshot.size, [checkOnly ? 'missing' : 'updated']: missing.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let db;
  let stage = 'target validation';
  try {
    const { values } = parseArgs({ options: { project: { type: 'string' }, check: { type: 'boolean' }, query: { type: 'boolean' } } });
    if (values.query && !values.check) throw new Error('Query readiness is a read-only --check operation.');
    productionTarget(values.project, productionEnv());
    if (!values.check) await confirmProject(values.project, 'Migrate legacy sharing metadata in');
    // Reuse the existing directory-selected CLI login in memory. No new keys/logins.
    stage = 'loading administrator tools';
    const { selectAccount, getAccessToken } = await import('firebase-tools/lib/auth.js');
    const { requireAuth } = await import('firebase-tools/lib/requireAuth.js');
    const { Firestore, Filter } = await import('firebase-admin/firestore');
    const { OAuth2Client } = await import('google-auth-library');
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    stage = 'selecting the project CLI login';
    const account = selectAccount(undefined, projectRoot.replace(/\/$/, ''));
    if (!account) throw new Error('The project-directory CLI account is unavailable.');
    const options = { project: values.project, projectRoot, ...account };
    stage = 'authorizing the CLI login';
    await requireAuth(options);
    const authClient = new OAuth2Client();
    authClient.refreshHandler = async () => {
      const token = await getAccessToken(options.tokens.refresh_token, options.authScopes);
      if (!Number.isFinite(token.expires_at)) throw new Error('A valid expiring access token is required.');
      return { access_token: token.access_token, expiry_date: token.expires_at };
    };
    stage = 'reading sharing metadata';
    db = new Firestore({ projectId: values.project, authClient });
    const result = await migrateSharing(db, values.check);
    console.log(`Sharing metadata ${values.check ? 'preflight' : 'migration'}: ${JSON.stringify(result)}. Note contents and rows preserved.`);
    if (values.query) {
      stage = 'checking sharing query indexes';
      for (let attempt = 0; ; attempt++) {
        try {
          const snapshot = await db.collectionGroup('notes').where(Filter.or(Filter.where('audience', '==', 'everyone'), Filter.where('sharedWith', 'array-contains', '__release_query_probe__'))).select('audience').get();
          console.log(`Sharing collection-group query/indexes ready: ${snapshot.size} metadata records matched.`); break;
        } catch (error) {
          if (error.code !== 9 || attempt >= 29) throw error;
          console.log('Waiting for sharing collection-group indexes to finish building…');
          await setTimeout(10000);
        }
      }
    }
    await db.terminate(); db = undefined;
  } catch (error) {
    // SDK/CLI errors can contain private document or account identifiers.
    const code = /^[a-zA-Z0-9_/-]+$/.test(String(error.code ?? error.name)) ? error.code ?? error.name : 'unknown';
    process.stderr.write(`Sharing migration failed while ${stage} (${code}). Check project access/connection and retry; do not publish Hosting until it succeeds.\n`);
    process.exitCode = 1;
  } finally { await db?.terminate(); }
}

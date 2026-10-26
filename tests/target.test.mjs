import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { productionTarget } from '../tools/target.mjs';

const config = { VITE_FIREBASE_PROJECT_ID: 'example-notebook', VITE_FIREBASE_API_KEY: 'synthetic-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'example-notebook.firebaseapp.com', VITE_FIREBASE_APP_ID: '1:123456789:web:synthetic' };

test('live targets must be explicit, match config and reject demo/emulator combinations', () => {
  assert.equal(productionTarget('example-notebook', config), 'example-notebook');
  for (const target of [undefined, '', 'demo-eselsohr', 'other-notebook', 'bad/id', 'trailing-']) {
    assert.throws(() => productionTarget(target, config));
  }
  for (const override of [{ VITE_USE_EMULATORS: 'true' }, { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' },
    { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' }, { VITE_FIREBASE_API_KEY: '' }]) {
    assert.throws(() => productionTarget('example-notebook', { ...config, ...override }));
  }
  assert.equal(productionTarget('example-notebook', { ...config, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }, { live: false }), 'example-notebook');
});

test('release and migration refuse noninteractive writes before credential lookup', () => {
  const env = { ...process.env, ...config, VITE_USE_EMULATORS: 'false', FIRESTORE_EMULATOR_HOST: '', FIREBASE_AUTH_EMULATOR_HOST: '' };
  delete env.NODE_TEST_CONTEXT; // Spawn a CLI, not a child of Node's test protocol.
  for (const file of ['release.mjs', 'migrate-sharing.mjs']) {
    const result = spawnSync(process.execPath, [`tools/${file}`, '--project', 'example-notebook'], {
      cwd: new URL('..', import.meta.url), env, encoding: 'utf8', timeout: 10000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stderr, /loading administrator tools|CLI login|authorizing/);
    if (file === 'release.mjs') assert.match(result.stderr, /interactive terminal/);
    else assert.match(result.stderr, /target validation/);
  }
});

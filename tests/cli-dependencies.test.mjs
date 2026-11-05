import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('Firebase CLI glob consumers preserve discovery, exclusions, controller loading and cleanup', async t => {
  const require = createRequire(import.meta.url);
  const cli = createRequire(require.resolve('firebase-tools/package.json'));
  const { listFiles } = cli('./lib/listFiles.js');
  const { file } = cli('archiver-utils');
  const { loadControllersSync } = cli('exegesis/lib/controllers/loadControllers.js');
  const { rimraf, rimrafSync } = cli('rimraf');
  const directory = await mkdtemp(join(tmpdir(), 'eselsohr-cli-glob-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'nested'));
  await mkdir(join(directory, '.firebase'));
  for (const name of ['keep.txt', '.hidden.txt', 'nested/keep.txt', 'nested/skip.txt',
    'firebase-debug.log', 'nested/firebase-debug.test.log', '.firebase/cache']) {
    await writeFile(join(directory, name), 'synthetic');
  }

  assert.deepEqual(listFiles(directory, ['**/skip.txt']).sort(),
    ['.hidden.txt', 'keep.txt', 'nested/keep.txt']);
  assert.deepEqual(file.expand({ cwd: directory, dot: true, filter: 'isFile' },
    ['**/*.txt', '!**/skip.txt']).sort(), ['.hidden.txt', 'keep.txt', 'nested/keep.txt']);

  const controllers = join(directory, 'controllers');
  await mkdir(join(controllers, 'nested'), { recursive: true });
  await writeFile(join(controllers, 'one.cjs'), 'module.exports = { name: "one" };');
  await writeFile(join(controllers, 'nested/index.cjs'), 'module.exports = { name: "nested" };');
  const loaded = loadControllersSync(controllers, '**/*.cjs');
  assert.equal(loaded.one.name, 'one');
  assert.equal(loaded['nested/index'].name, 'nested');
  assert.equal(loaded.nested, loaded['nested/index.cjs']);

  await writeFile(join(directory, 'nested/remove.tmp'), 'synthetic');
  await writeFile(join(directory, 'remove.tmp'), 'synthetic');
  await rimraf('nested/*.tmp', { glob: { cwd: directory, absolute: true } });
  await assert.rejects(readFile(join(directory, 'nested/remove.tmp')), { code: 'ENOENT' });
  assert.equal(await readFile(join(directory, 'remove.tmp'), 'utf8'), 'synthetic');
  rimrafSync(join(directory, '*.tmp'), { glob: true });
  await assert.rejects(readFile(join(directory, 'remove.tmp')), { code: 'ENOENT' });
  assert.equal(await readFile(join(directory, 'nested/keep.txt'), 'utf8'), 'synthetic');
});

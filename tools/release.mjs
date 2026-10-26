// Explicit target and fresh production build are required for every release.
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { productionTarget, productionEnv, confirmProject } from './target.mjs';

try {
  const { values } = parseArgs({ options: { project: { type: 'string' } } });
  const project = productionTarget(values.project, productionEnv());
  await confirmProject(project, 'Deploy rules, indexes and app to');
  function run(command, args) {
    const result = spawnSync(command, args, { stdio: 'inherit', cwd: new URL('..', import.meta.url), env: { ...process.env, FIREBASE_CLI_DISABLE_USAGE_REPORTING: 'true' } });
    if (result.error || result.status !== 0) throw new Error(`${command} did not complete successfully.`);
  }
  run('npm', ['run', 'build']);
  run('node', ['tools/migrate-sharing.mjs', '--project', project, '--check']);
  run('node', ['node_modules/firebase-tools/lib/bin/firebase.js', 'deploy', '--project', project, '--only', 'firestore:rules,firestore:indexes']);
  run('node', ['tools/migrate-sharing.mjs', '--project', project]);
  run('node', ['tools/migrate-sharing.mjs', '--project', project, '--check', '--query']);
  run('node', ['node_modules/firebase-tools/lib/bin/firebase.js', 'deploy', '--project', project, '--only', 'hosting']);
} catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }

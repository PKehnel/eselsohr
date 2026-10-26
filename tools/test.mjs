// Share local services across selected suites, and stop only our own processes.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { delimiter } from 'node:path';
import { parseArgs } from 'node:util';
import { createServer } from 'vite';
import { record, measure } from './test-profile.mjs';
import { startupProfile } from '../tests/profile-startup.mjs';
import { productionTarget, productionEnv } from './target.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { live: { type: 'boolean' }, project: { type: 'string' }, mode: { type: 'string' }, screenshots: { type: 'boolean' }, grep: { type: 'string' }, 'repeat-each': { type: 'string' }, trace: { type: 'boolean' }, profile: { type: 'boolean' } },
});
const selectedSuites = [...new Set(positionals)];
const suite = selectedSuites.join('+');
const started = performance.now();
const suites = {
  rules: ['rules.mjs'],
  acceptance: ['acceptance.mjs', 'sharing.mjs', 'typing.mjs', 'guidelines.mjs', 'tabs.mjs'],
  tabs: ['tabs.mjs'], sharing: ['sharing.mjs'], typing: ['typing.mjs'], guidelines: ['guidelines.mjs'],
  ui: ['presentation.mjs', 'note-cards.mjs'], artwork: ['artwork.mjs'], release: ['release-check.mjs'],
};
if (!selectedSuites.length || selectedSuites.some(name => !Object.hasOwn(suites, name)) || (values.live && suite !== 'release')) {
  throw new Error('Use rules, acceptance, tabs, sharing, typing, guidelines, ui, artwork or release; --live is only for release.');
}
if (selectedSuites.length > 1 && selectedSuites.some(name => name === 'rules' || name === 'release')) {
  throw new Error('Only browser suites can be combined; run rules and release separately.');
}
if ((suite === 'release') !== !!values.project) throw new Error('Release checks require --project PROJECT_ID; other suites use demo-eselsohr.');
if (values.mode && (suite !== 'release' || values.live)) throw new Error('--mode is only for local release checks.');
if (suite === 'release') productionTarget(values.project, productionEnv(values.mode), { live: !!values.live });
const browserSuite = suite !== 'rules' && suite !== 'release';
const files = [...new Set(selectedSuites.flatMap(name => suites[name]))];
if (!browserSuite && (values.grep || values['repeat-each'] || values.trace)) throw new Error('Case selection, repetition and traces require a browser suite.');
if (values['repeat-each'] && !/^[1-9]\d*$/.test(values['repeat-each'])) throw new Error('--repeat-each requires a positive integer.');
if (values.profile) {
  const directory = new URL('../test-artifacts/profiles/', import.meta.url);
  await mkdir(directory, { recursive: true });
  process.env.ESELSOHR_PROFILE = new URL(`${suite}-${new Date().toISOString().replaceAll(':', '-')}.ndjson`, directory).pathname;
  record('runner.begin', { suite, processStartupMs: started });
}
const env = { ...process.env, FIREBASE_CLI_DISABLE_USAGE_REPORTING: 'true' };
if (values.screenshots) env.ESELSOHR_SCREENSHOTS = '1';
// Local emulators need no Google Compute metadata lookup/ADC discovery.
if (!values.live) env.METADATA_SERVER_DETECTION = 'none';
if (env.JAVA_HOME) env.PATH = `${env.JAVA_HOME}/bin${delimiter}${env.PATH}`;
let child, vite, interrupted;
const handlers = ['SIGINT', 'SIGTERM'].map(signal => {
  const handler = () => {
    interrupted = signal;
    process.exitCode = signal === 'SIGINT' ? 130 : 143;
    child?.kill(signal);
  };
  process.on(signal, handler);
  return [signal, handler];
});
function run(command, args) {
  if (interrupted) throw new Error(`Interrupted by ${interrupted}.`);
  return new Promise((resolve, reject) => {
    record('command.start', { command: args.some(arg => arg.includes('firebase.js')) ? 'firebase' : 'node' });
    child = spawn(command, args, { cwd: new URL('..', import.meta.url), env, stdio: values.profile ? ['inherit', 'pipe', 'pipe'] : 'inherit' });
    if (values.profile) for (const [stream, output] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      let pending = '';
      stream.on('data', chunk => {
        output.write(chunk);
        pending += chunk.toString();
        const lines = pending.split('\n'); pending = lines.pop();
        for (const line of lines) {
          if (line.includes('Running script:')) record('services.ready');
          if (line.includes('Firestore Emulator was started')) record('services.firestore.ready');
          if (line.includes('Starting emulators:')) record('services.starting');
          if (line.includes('Shutting down emulators.')) record('services.cleanup.start');
        }
      });
    }
    child.once('error', reject);
    child.once(values.profile ? 'close' : 'exit', (code, signal) => {
      child = undefined;
      record('command.end', { code, signal });
      if (interrupted) reject(new Error(`Interrupted by ${interrupted}.`));
      else if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${signal ?? code}.`));
    });
  });
}
try {
  const args = browserSuite ? ['node_modules/playwright/cli.js', 'test', ...files.map(file => `tests/${file}`),
    ...(values.grep ? ['--grep', values.grep] : []),
    ...(values['repeat-each'] ? ['--repeat-each', values['repeat-each']] : []),
    ...(values.trace ? ['--trace', 'retain-on-failure'] : [])] :
    [`tests/${files[0]}`, ...(values.project ? ['--project', values.project] : []), ...(values.mode ? ['--mode', values.mode] : []), ...(values.screenshots ? ['--screenshots'] : [])];
  if (values.live) {
    await run(process.execPath, [...args, '--live']); // Verify existing dist; never rebuild a deployed artifact here.
  } else {
    if (suite === 'release') await run('npm', ['run', 'build', ...(values.mode ? ['--', '--mode', values.mode] : [])]);
    if (browserSuite) {
      await measure('services.vite.start', async () => {
        vite = await createServer({
          mode: 'emulator',
          cacheDir: 'test-artifacts/vite',
          plugins: values.profile ? [startupProfile()] : [],
          server: { host: '127.0.0.1', port: 5173, strictPort: true, forwardConsole: false, watch: { ignored: ['**/test-artifacts/**'] } },
        });
        await vite.listen();
      });
    }
    if (suite === 'artwork') await run(process.execPath, args);
    else {
      // Firebase executes this through a shell; quote every argument, including filters.
      const command = [process.execPath, ...args].map(value => `'${value.replaceAll("'", "'\\''")}'`).join(' ');
      await run(process.execPath, ['node_modules/firebase-tools/lib/bin/firebase.js', 'emulators:exec', '--project', 'demo-eselsohr', '--only', suite === 'release' ? 'hosting' : 'auth,firestore', command]);
    }
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  if (!interrupted) process.exitCode = 1;
} finally {
  await measure('services.vite.close', async () => vite?.close());
  for (const [signal, handler] of handlers) process.off(signal, handler);
  console.log(`${suite} ${interrupted ? 'interrupted' : process.exitCode ? 'failed' : 'completed'} in ${((performance.now() - started) / 1000).toFixed(1)}s`);
  record('runner.end', { ms: performance.now() - started, code: process.exitCode ?? 0 });
  if (values.profile) console.log(`Stage profile: ${process.env.ESELSOHR_PROFILE}`);
}

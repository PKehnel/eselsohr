// Shared release/migration guard. Validate before loading credentials or connecting.
import { loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

export function productionTarget(project, env, { live = true } = {}) {
  if (!project || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project) || project.startsWith('demo-')) {
    throw new Error('Pass a real project with --project PROJECT_ID.');
  }
  if (env.VITE_FIREBASE_PROJECT_ID !== project) throw new Error('The resolved production config must name this exact target project.');
  if (env.VITE_USE_EMULATORS === 'true' || (live && (env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST))) {
    throw new Error('Emulator configuration cannot target a live project.');
  }
  if (['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_APP_ID'].some(key => !env[key])) {
    throw new Error('Complete the Firebase web configuration before release.');
  }
  return project;
}

export function productionEnv(mode = 'production') {
  return { ...loadEnv(mode, fileURLToPath(new URL('..', import.meta.url)), 'VITE_'), ...process.env };
}

export async function confirmProject(project, action) {
  if (!process.stdin.isTTY) throw new Error('This operation requires an interactive terminal and project confirmation.');
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (await terminal.question(`${action} ${project}? Type its exact ID: `) !== project) throw new Error('Project confirmation did not match.');
  } finally { terminal.close(); }
}

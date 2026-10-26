import { defineConfig, loadEnv } from 'vite';
import { offlineBuild } from './tools/offline-build.mjs';
export default defineConfig(({ command, mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
  if (command === 'build' && (mode === 'emulator' || env.VITE_USE_EMULATORS === 'true' || env.VITE_FIREBASE_PROJECT_ID?.startsWith('demo-'))) {
    throw new Error('Emulator/demo configuration cannot be included in a production build.');
  }
  return { build: { target: 'es2022' }, plugins: [offlineBuild()] };
});

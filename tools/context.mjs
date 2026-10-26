import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

export function adminContext(project, emulator = false) {
  if (!project || !/^[a-z][a-z0-9-]{4,29}$/.test(project)) throw new Error('Pass the exact project ID with --project.');
  if (emulator) {
    if (project !== 'demo-eselsohr') throw new Error('Emulator tools only accept demo-eselsohr.');
    process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  } else {
    if (project.startsWith('demo-') || process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error('Live administration cannot use a demo project or emulator environment.');
    }
  }
  const app = initializeApp({ projectId: project, ...(emulator ? {} : { credential: applicationDefault() }) });
  const db = getFirestore(app);
  return { auth: getAuth(app), db };
}

import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import type { Auth, User } from 'firebase/auth';

export async function signIn(auth: Auth, email: string, password: string) {
  return signInWithEmailAndPassword(auth, email.trim(), password);
}

export const logOut = (auth: Auth) => signOut(auth);
export const observeAuth = (auth: Auth, receive: (user: User | null) => void) => onAuthStateChanged(auth, receive);

export function loginError(error: unknown) {
  const code = (error as { code?: string }).code;
  if (code === 'auth/network-request-failed') return 'Could not connect. Check your connection and try again.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Wait a little and try again.';
  if (error instanceof Error && !code) return error.message;
  return 'Could not sign in. Check your email and password.';
}

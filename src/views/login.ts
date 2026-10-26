import { button, element, heading, labeledInput, status } from './dom';

export function loginView(submit: (email: string, password: string) => Promise<string | null>) {
  const shell = element('main', 'shell login');
  shell.append(heading('Eselsohr', 'Your shared notes.'));
  const form = element('form', 'login-form');
  const email = labeledInput('Email', 'email', 'email');
  email.input.required = true;
  email.input.autocomplete = 'username'; email.input.autocapitalize = 'none'; email.input.spellcheck = false;
  const password = labeledInput('Password', 'password', 'password');
  password.input.required = true; password.input.autocomplete = 'current-password';
  const feedback = status(); feedback.id = 'login-feedback'; form.setAttribute('aria-describedby', feedback.id);
  const signIn = button('Sign in', 'primary', () => {}); signIn.type = 'submit';
  form.append(email.wrapper, password.wrapper, signIn, feedback, element('p', 'help', 'For account help or a password reset, ask the person who set up Eselsohr.'));
  form.addEventListener('submit', async event => {
    event.preventDefault(); signIn.disabled = true; feedback.textContent = 'Signing in…';
    const secret = password.input.value;
    try { feedback.textContent = await submit(email.input.value, secret) ?? ''; }
    finally { password.input.value = ''; signIn.disabled = false; }
  });
  shell.append(form); return shell;
}

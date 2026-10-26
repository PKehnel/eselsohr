// No echo, command-line password arguments, environment passwords or password files.
export async function hiddenPassword(prompt = 'Password: ') {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Password entry requires an interactive terminal.');
  process.stdout.write(prompt);
  const input = process.stdin;
  const previousRaw = input.isRaw;
  input.setRawMode(true); input.resume();
  return new Promise((resolve, reject) => {
    let password = '';
    const finish = (error) => {
      input.off('data', receive); input.setRawMode(previousRaw); input.pause(); process.stdout.write('\n');
      if (error) reject(error); else resolve(password);
    };
    const receive = chunk => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003' || character === '\u0004') { finish(new Error('Cancelled.')); return; }
        if (character === '\r' || character === '\n') { finish(); return; }
        if (character === '\u007f' || character === '\b') password = [...password].slice(0, -1).join('');
        else if (character >= ' ' && character !== '\u001b') password += character;
      }
    };
    input.on('data', receive);
  });
}

// Pinned upstream scanner, verified before extraction/execution. No account needed.
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('This installer supports Linux x64. Elsewhere install Gitleaks 8.30.1 and run gitleaks dir --redact .');
const temporary = await mkdtemp(join(tmpdir(), 'eselsohr-gitleaks-'));
try {
  const response = await fetch('https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz', { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Scanner download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb') throw new Error('Scanner checksum mismatch.');
  const archive = join(temporary, 'gitleaks.tar.gz');
  await writeFile(archive, bytes);
  const unpack = spawnSync('tar', ['-xzf', archive, '-C', temporary, 'gitleaks'], { stdio: 'inherit' });
  if (unpack.error || unpack.status !== 0) throw new Error('Scanner extraction failed.');
  await mkdir('test-artifacts/security', { recursive: true });
  const scan = spawnSync(join(temporary, 'gitleaks'), ['dir', '--redact', '--report-format', 'json', '--report-path', 'test-artifacts/security/gitleaks.json', '.'], { stdio: 'inherit' });
  if (scan.error || scan.status !== 0) throw new Error('Secret scan found a possible secret or failed. Review the redacted report.');
} finally { await rm(temporary, { recursive: true, force: true }); }

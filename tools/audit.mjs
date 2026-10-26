// Scan the full locked graph. A failed scan must never look like zero findings.
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export function auditStatus(report, status) {
  const counts = report?.metadata?.vulnerabilities;
  if (![0, 1].includes(status) || report?.error || report?.auditReportVersion !== 2 || !report?.vulnerabilities || typeof report.vulnerabilities !== 'object' || Array.isArray(report.vulnerabilities) ||
      !counts || ['info', 'low', 'moderate', 'high', 'critical', 'total'].some(key => !Number.isInteger(counts[key]) || counts[key] < 0)) {
    throw new Error('Dependency scan failed or returned an incomplete report.');
  }
  if (['info', 'low', 'moderate', 'high', 'critical'].reduce((total, key) => total + counts[key], 0) !== counts.total) throw new Error('Dependency scan returned inconsistent counts.');
  if (status === 1 && counts.total === 0) throw new Error('Dependency scan failed without findings.');
  return { counts, blocked: counts.high > 0 || counts.critical > 0 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const directory = new URL('../test-artifacts/security/', import.meta.url);
  await mkdir(directory, { recursive: true });
  const result = spawnSync('npm', ['audit', '--json', '--include=dev'], { cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  await writeFile(new URL('npm-audit.json', directory), result.stdout || JSON.stringify({ error: 'No audit output', status: result.status }));
  try {
    if (result.error) throw result.error;
    const { counts, blocked } = auditStatus(JSON.parse(result.stdout), result.status);
    if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, `counts=${JSON.stringify(counts)}\n`, { flag: 'a' });
    console.log(`Dependency audit: ${JSON.stringify(counts)}. Report: test-artifacts/security/npm-audit.json`);
    if (counts.info + counts.low + counts.moderate > 0) console.log('Lower severity findings require a recorded maintainer decision; see SECURITY.md.');
    if (blocked) process.exitCode = 1;
  } catch {
    console.error('Dependency scan failed. Inspect test-artifacts/security/npm-audit.json and retry; do not treat this as a clean audit.');
    process.exitCode = 1;
  }
}

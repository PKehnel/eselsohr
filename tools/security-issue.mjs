// Maintain one bot-owned issue per check; never include secret-scan contents.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { auditStatus } from './audit.mjs';

const titles = {
  dependencies: 'Dependency security check needs attention',
  secrets: 'Secret scan needs attention',
  verification: 'Security issue automation test (synthetic)',
};

export async function syncSecurityIssue(api, check, state, message, runId) {
  if (!Object.hasOwn(titles, check) || !['open', 'closed'].includes(state) || !/^\d+$/.test(runId)) throw new Error('Invalid security issue update.');
  const start = `<!-- eselsohr-security:${check}:start -->`;
  const end = `<!-- eselsohr-security:${check}:end -->`;
  const block = `${start}\n<!-- run:${runId} -->\n${message}\n${end}`;
  const issue = (await api.list()).find(item => !item.pull_request && item.user?.login === 'github-actions[bot]' && item.body?.includes(start));
  if (!issue) {
    if (state === 'closed') return { action: 'none' };
    const created = await api.create({ title: titles[check], body: block });
    return { number: created.number, action: 'created' };
  }
  const from = issue.body.indexOf(start), to = issue.body.indexOf(end, from);
  if (to < 0) throw new Error('Managed issue section is incomplete; preserve it for manual review.');
  const previousRun = issue.body.slice(from, to).match(/<!-- run:(\d+) -->/);
  if (previousRun && BigInt(previousRun[1]) > BigInt(runId)) return { number: issue.number, action: 'stale' };
  const body = issue.body.slice(0, from) + block + issue.body.slice(to + end.length);
  if (body === issue.body && state === issue.state) return { number: issue.number, action: 'unchanged' };
  await api.update(issue.number, { body, state });
  return { number: issue.number, action: state === issue.state ? 'updated' : state === 'open' ? 'reopened' : 'closed' };
}

export function dependencyMessage(result, rawCounts) {
  if (result !== 'success') return { state: 'open', text: `Dependency audit did not complete successfully (${result}). Inspect the run and retained report; this is not a clean security result.` };
  try {
    const { counts } = auditStatus({ auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: JSON.parse(rawCounts) } }, 0);
    return { state: counts.total ? 'open' : 'closed', text: counts.total ?
      `Dependency findings need review: ${counts.critical} critical, ${counts.high} high, ${counts.moderate} moderate, ${counts.low} low, ${counts.info} informational. Counts are flagged package entries, including inherited findings. Review the retained npm audit report; high/critical findings block the audit.` :
      'The latest dependency audit completed with zero reported vulnerabilities.' };
  } catch {
    return { state: 'open', text: 'The audit supplied no valid vulnerability counts. Inspect the run; a missing or incomplete report is not a clean result.' };
  }
}

async function main() {
  const { GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: runId, GH_TOKEN: token, SECURITY_CHECK: check, SECURITY_RESULT: result, SECURITY_COUNTS: counts } = process.env;
  if (!repository || !/^\d+$/.test(runId ?? '') || !token || !['dependencies', 'secrets'].includes(check)) throw new Error('Missing GitHub security-check context.');
  const runUrl = `https://github.com/${repository}/actions/runs/${runId}`;
  const request = async (method, path, body) => {
    const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`GitHub issue request failed: ${method} ${path} (HTTP ${response.status}).`);
    return response.json();
  };
  const api = {
    list: async () => {
      const items = [];
      for (let page = 1; ; page++) {
        const batch = await request('GET', `issues?state=all&per_page=100&page=${page}`);
        items.push(...batch);
        if (batch.length < 100) return items;
      }
    },
    create: body => request('POST', 'issues', body),
    update: (number, body) => request('PATCH', `issues/${number}`, body),
  };
  const receipts = [];
  if (process.env.SECURITY_ISSUE_EXERCISE === 'true') {
    for (const [state, stage] of [['open', 'create/reopen'], ['open', 'update'], ['closed', 'close'], ['open', 'reopen'], ['closed', 'finish']]) {
      receipts.push(await syncSecurityIssue(api, 'verification', state, `Synthetic notification test: ${stage}. No vulnerability or secret was detected by this test.\n\n[Verification run](${runUrl}).`, runId));
    }
    if (!receipts.every(receipt => receipt.number === receipts[0].number)) throw new Error('Notification test created inconsistent issue numbers.');
  }
  const report = check === 'dependencies' ? dependencyMessage(result, counts) : {
    state: result === 'success' ? 'closed' : 'open',
    text: result === 'success' ? 'The latest Gitleaks source scan passed.' : 'The secret scan failed or could not complete. Review its run privately. Do not paste detected tokens or secret values into this issue.',
  };
  receipts.push(await syncSecurityIssue(api, check, report.state, `${report.text}\n\n[Latest check and retained reports](${runUrl}). This issue updates in place and closes after a clean check.`, runId));
  await mkdir('test-artifacts/security', { recursive: true });
  await writeFile('test-artifacts/security/issue-notification.json', JSON.stringify({ check, runId, receipts }, null, 2) + '\n');
  console.log(JSON.stringify(receipts));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

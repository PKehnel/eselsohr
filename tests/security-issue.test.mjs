import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dependencyMessage, syncSecurityIssue } from '../tools/security-issue.mjs';

function fixture() {
  const issues = [], writes = [];
  return {
    issues, writes,
    api: {
      list: async () => structuredClone(issues),
      create: async body => {
        const issue = { ...body, number: issues.length + 1, state: 'open', user: { login: 'github-actions[bot]' } };
        issues.push(issue); writes.push('create'); return structuredClone(issue);
      },
      update: async (number, body) => { Object.assign(issues.find(issue => issue.number === number), body); writes.push('update'); },
    },
  };
}

test('security issues create once, update, close and reopen while preserving maintainer text', async () => {
  const { api, issues, writes } = fixture();
  assert.deepEqual(await syncSecurityIssue(api, 'dependencies', 'closed', 'Clean', '1'), { action: 'none' });
  const created = await syncSecurityIssue(api, 'dependencies', 'open', 'High findings', '2');
  issues[0].body = `Maintainer introduction\n${issues[0].body}\nFollow-up notes stay here`;
  assert.equal((await syncSecurityIssue(api, 'dependencies', 'open', 'Updated findings', '3')).number, created.number);
  assert.equal((await syncSecurityIssue(api, 'dependencies', 'closed', 'Clean again', '4')).action, 'closed');
  assert.equal((await syncSecurityIssue(api, 'dependencies', 'open', 'New finding', '5')).action, 'reopened');
  assert.equal((await syncSecurityIssue(api, 'dependencies', 'open', 'New finding', '5')).action, 'unchanged');
  assert.equal(issues.length, 1);
  assert.ok(issues[0].body.startsWith('Maintainer introduction\n'));
  assert.ok(issues[0].body.endsWith('\nFollow-up notes stay here'));
  assert.equal(writes.filter(action => action === 'create').length, 1);
});

test('late successful runs cannot close a newer finding and damaged sections are preserved', async () => {
  const { api, issues, writes } = fixture();
  await syncSecurityIssue(api, 'secrets', 'open', 'Review privately', '20');
  assert.equal((await syncSecurityIssue(api, 'secrets', 'closed', 'Older clean check', '19')).action, 'stale');
  assert.equal(issues[0].state, 'open');
  issues[0].body = issues[0].body.replace('<!-- eselsohr-security:secrets:end -->', 'Maintainer edited this section');
  const before = issues[0].body, count = writes.length;
  await assert.rejects(syncSecurityIssue(api, 'secrets', 'closed', 'Clean', '21'), /incomplete/);
  assert.equal(issues[0].body, before); assert.equal(writes.length, count);
});

test('notification test and real checks have independent bot-owned issues', async () => {
  const { api, issues } = fixture();
  issues.push({ number: 1, body: '<!-- eselsohr-security:dependencies:start -->', user: { login: 'maintainer' } });
  for (const check of ['dependencies', 'secrets', 'verification']) await syncSecurityIssue(api, check, 'open', 'Test', '1');
  assert.equal(issues.length, 4);
  assert.equal(issues[0].body, '<!-- eselsohr-security:dependencies:start -->');
});

test('all dependency findings and failed or incomplete audits require an issue', () => {
  const clean = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  assert.equal(dependencyMessage('success', JSON.stringify(clean)).state, 'closed');
  for (const severity of ['info', 'low', 'moderate', 'high', 'critical']) {
    assert.equal(dependencyMessage('success', JSON.stringify({ ...clean, [severity]: 1, total: 1 })).state, 'open');
  }
  assert.equal(dependencyMessage('failure', '').state, 'open');
  for (const value of ['', '{}', JSON.stringify({ ...clean, total: 1 })]) assert.equal(dependencyMessage('success', value).state, 'open');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditStatus } from '../tools/audit.mjs';

const report = (counts = {}) => ({ auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: {
  info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0, ...counts,
} } });

test('dependency audit blocks high/critical findings and exposes lower severities for triage', () => {
  assert.equal(auditStatus(report(), 0).blocked, false);
  assert.equal(auditStatus(report({ moderate: 1, total: 1 }), 1).blocked, false);
  for (const severity of ['high', 'critical']) assert.equal(auditStatus(report({ [severity]: 1, total: 1 }), 1).blocked, true);
});

test('dependency audit fails closed on scan errors, empty and incomplete reports', () => {
  for (const value of [{}, null, { error: { code: 'EAI_AGAIN' } }, { vulnerabilities: {} }]) assert.throws(() => auditStatus(value, 1));
  assert.throws(() => auditStatus(report(), 1));
  assert.throws(() => auditStatus(report(), null));
  assert.throws(() => auditStatus(report(), 2));
  assert.throws(() => auditStatus(report({ high: '0' }), 0));
  assert.throws(() => auditStatus(report({ total: 1 }), 0));
});

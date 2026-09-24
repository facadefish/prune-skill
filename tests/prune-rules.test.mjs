import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepare, Workbench, fingerprintFile } from '../skills/prune/scripts/engine.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prune-rules-'));
  t.after(async () => {
    assert.equal(path.dirname(root), os.tmpdir());
    assert(path.basename(root).startsWith('prune-rules-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const source = path.join(root, 'project', 'AGENTS.md'), draft = path.join(root, 'drafts', 'AGENTS.md'), run = path.join(root, 'run');
  await fs.mkdir(path.dirname(source)); await fs.mkdir(path.dirname(draft));
  await fs.mkdir(path.join(root, 'skills'));
  await fs.writeFile(source, '\uFEFF# 项目规则\r\n\r\n保留原有范围。\r\n');
  await fs.writeFile(draft, '# 项目规则\n\n按本次变更执行必要验证。\n');
  const input = { schemaVersion: 1, intent: 'revise', profile: { model: 'fixture', tasks: ['rules'] }, discoveryRoots: [path.join(root, 'skills')], items: [{ id: 'rule', name: 'AGENTS.md', kind: 'instruction', scope: 'project', action: 'modify', rationale: '明确验证范围', sources: [source], revisionDraft: { source, path: draft, writable: true } }] };
  return { root, source, draft, run, input, async open() { await prepare(input, run); return new Workbench(run, { lockRoot: path.join(root, 'lock') }).open(); } };
}
async function apply(wb, id = 'apply') {
  await wb.select(wb.plan.fingerprint, { rule: 'approved' });
  const job = await wb.start('apply', { planFingerprint: wb.plan.fingerprint, requestId: id, itemIds: ['rule'] });
  await wb.pending; return job;
}
async function restore(wb, job, id = 'restore') {
  const result = await wb.start('restore', { planFingerprint: wb.plan.fingerprint, requestId: id, operationId: job.id, itemIds: ['rule'] });
  await wb.pending; return result;
}

test('Standalone rule Apply and Restore preserve original bytes and persist history across restart', async t => {
  const f = await fixture(t), before = await fs.readFile(f.source), original = await fingerprintFile(f.source), wb = await f.open();
  assert.equal(wb.view().items[0].executable, true);
  assert.equal((await wb.details('rule')).files[0].previewOnly, false);
  await assert.rejects(wb.start('apply', { planFingerprint: wb.plan.fingerprint, requestId: 'unapproved', itemIds: ['rule'] }), /未经批准/);
  const job = await apply(wb);
  assert.equal(job.status, 'completed');
  assert.deepEqual(await fs.readFile(f.source), await fs.readFile(f.draft));
  await wb.refreshObservations(true);
  assert.equal(wb.view().items[0].effectiveState.status, 'verified');
  assert.equal(wb.view().items[0].effectiveState.loaded, 'unknown');
  const reopened = await new Workbench(f.run, { lockRoot: path.join(f.root, 'lock') }).open();
  assert.equal((await restore(reopened, job)).status, 'completed');
  assert.deepEqual(await fs.readFile(f.source), before);
  assert.deepEqual(await fingerprintFile(f.source), original);
  assert.equal(reopened.state.selection.rule, 'none');
  const again = await apply(reopened, 'again');
  assert.equal(again.status, 'completed');
  assert.equal((await restore(reopened, again, 'again-restore')).status, 'completed');
});

test('Rule source, candidate and restored-file drift stop writes and remain truthful in UI state', async t => {
  const f = await fixture(t), wb = await f.open();
  const before = await fs.readFile(f.source);
  await fs.appendFile(f.source, '用户修改');
  assert.equal((await apply(wb)).status, 'failed');
  assert.match(await fs.readFile(f.source, 'utf8'), /用户修改/);
  await fs.writeFile(f.source, before);
  const frozen = path.join(f.run, wb.plan.items[0].changes[0].candidate), candidate = await fs.readFile(frozen);
  await fs.appendFile(frozen, '候选漂移');
  assert.equal((await apply(wb, 'candidate-drift')).status, 'failed');
  assert.deepEqual(await fs.readFile(f.source), before);
  await fs.writeFile(frozen, candidate);
  const job = await apply(wb, 'valid');
  assert.equal(job.status, 'completed');
  await fs.appendFile(f.source, '执行后用户修改');
  await wb.refreshObservations(true);
  assert.equal(wb.view().items[0].effectiveState.status, 'drifted');
  assert.equal((await restore(wb, job)).status, 'failed');
  assert.match(await fs.readFile(f.source, 'utf8'), /执行后用户修改/);
  assert.equal(wb.view().items[0].executionState, 'problem');
});

test('Preview-only historical rule selections never gain write authority after upgrade', async t => {
  const f = await fixture(t);
  delete f.input.items[0].revisionDraft.writable;
  const wb = await f.open();
  assert.equal(wb.plan.completion.status, 'partial', 'a preview is not a completed implementation plan');
  await wb.select(wb.plan.fingerprint, { rule: 'approved' });
  const reopened = await new Workbench(f.run).open();
  assert.equal(reopened.view().items[0].executable, false);
  assert.equal(reopened.state.selection.rule, 'approved');
  assert.equal((await reopened.details('rule')).files[0].previewOnly, true);
  await assert.rejects(reopened.start('apply', { planFingerprint: reopened.plan.fingerprint, requestId: 'old', itemIds: ['rule'] }), /不可执行/);
});

test('Rule plans reject hardlinks and physically overlapping writes', async t => {
  const f = await fixture(t);
  await fs.link(f.source, path.join(f.root, 'linked.md'));
  await assert.rejects(f.open(), /不能是链接/);
  const second = await fixture(t);
  second.input.items.push({ ...second.input.items[0], id: 'duplicate' });
  await assert.rejects(second.open(), /重叠/);
});

test('Interrupted rule replacement is recoverable from the same journal', async t => {
  const f = await fixture(t), before = await fs.readFile(f.source), wb = await f.open();
  const job = await apply(wb);
  job.status = 'running'; job.items[0].status = 'running'; await wb.save();
  const reopened = await new Workbench(f.run, { lockRoot: path.join(f.root, 'lock') }).open();
  assert.equal(reopened.view().items[0].executionState, 'problem');
  assert.equal((await restore(reopened, job)).status, 'completed');
  assert.deepEqual(await fs.readFile(f.source), before);
});

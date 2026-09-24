import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepare, Workbench, fingerprint, exists, readJSON, writeJSON, validatePackage } from '../skills/prune/scripts/engine.mjs';
import { serve } from '../skills/prune/scripts/prune.mjs';

const entry = name => `---\nname: ${name}\ndescription: A task-specific fixture.\n---\n\n# ${name}\n`;
async function fixture(t, count = 3) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prune-test-'));
  t.after(async () => { // Only this test's verified generated directory is removed.
    assert(path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('prune-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const skills = path.join(root, 'skills'), drafts = path.join(root, 'drafts'), run = path.join(root, 'run');
  await fs.mkdir(skills); await fs.mkdir(drafts);
  const items = [];
  for (let n = 0; n < count; n++) {
    const id = `s${n}`, source = path.join(skills, id), candidate = path.join(drafts, id);
    await fs.mkdir(source); await fs.mkdir(candidate);
    await fs.writeFile(path.join(source, 'SKILL.md'), entry(id) + 'Original rules.\n');
    await fs.writeFile(path.join(candidate, 'SKILL.md'), entry(id) + 'Reviewed rules.\n');
    await fs.writeFile(path.join(source, 'asset.bin'), Buffer.from([0, 128, 255, n]));
    await fs.copyFile(path.join(source, 'asset.bin'), path.join(candidate, 'asset.bin'));
    items.push({ id, name: id, group: 'Test', action: 'modify', scope: 'user', rationale: 'Preserve the useful contract, remove repeated instructions.', changes: [{ path: source, candidate }] });
  }
  const input = { schemaVersion: 1, profile: { model: 'fixture-only', tasks: ['test'] }, discoveryRoots: [skills], items };
  return { root, skills, drafts, run, input, async open() { const plan = await prepare(input, run); const wb = await new Workbench(run, { lockRoot: path.join(root, 'locks') }).open(); return { plan, wb }; } };
}
async function apply(wb, ids, requestId = 'apply') {
  await wb.select(wb.plan.fingerprint, Object.fromEntries(ids.map(id => [id, 'approved'])));
  const job = await wb.start('apply', { planFingerprint: wb.plan.fingerprint, requestId, itemIds: ids });
  await wb.pending; return job;
}
async function restore(wb, operationId, ids, requestId = 'restore') {
  const job = await wb.start('restore', { planFingerprint: wb.plan.fingerprint, requestId, operationId, itemIds: ids });
  await wb.pending; return job;
}

test('Prune requires explicit approval; partial apply and restore preserve originals and binary resources', async t => {
  const f = await fixture(t), original = await fingerprint(path.join(f.skills, 's0'));
  const { wb } = await f.open();
  await assert.rejects(wb.start('apply', { planFingerprint: wb.plan.fingerprint, requestId: 'unapproved', itemIds: ['s0'] }), /未经批准/);
  const job = await apply(wb, ['s0']); assert.equal(job.status, 'completed');
  assert.match(await fs.readFile(path.join(f.skills, 's0/SKILL.md'), 'utf8'), /Reviewed/);
  assert.match(await fs.readFile(path.join(f.skills, 's1/SKILL.md'), 'utf8'), /Original/);
  assert.deepEqual(await fs.readFile(path.join(f.skills, 's0/asset.bin')), Buffer.from([0, 128, 255, 0]));
  const restored = await restore(wb, job.id, ['s0']); assert.equal(restored.status, 'completed');
  assert.equal(wb.view().items[0].state, 'ready');
  assert.equal(wb.view().items[0].lastOutcome.status, 'restored');
  assert.equal(wb.view().items[0].lastOutcome.kind, 'restore');
  assert.equal(wb.view().items[1].lastOutcome, null);
  assert.deepEqual(await fingerprint(path.join(f.skills, 's0')), original);
  assert.equal(wb.view().items[0].executionState, 'ready');
  assert.equal(wb.state.selection.s0, 'none');
  const again = await apply(wb, ['s0'], 'apply-again');
  assert.notEqual(again.id, job.id);
  assert.equal(again.status, 'completed');
  assert.equal(wb.view().items[0].executionState, 'applied');
  await restore(wb, again.id, ['s0'], 'restore-again');
  assert.deepEqual(await fingerprint(path.join(f.skills, 's0')), original);
});

test('Prune separates semantic acceptance from local execution for keep and whole plugins', async t => {
  const f = await fixture(t, 4);
  f.input.items[0].action = 'keep'; f.input.items[0].changes = [];
  f.input.items[1] = { ...f.input.items[1], kind: 'plugin', scope: 'plugin', action: 'disable', plugin: { id: 'remote@market', components: ['skill + app + hooks'] }, changes: [] };
  f.input.items[2].action = 'undetermined'; f.input.items[2].changes = [];
  const { wb } = await f.open();
  await wb.select(wb.plan.fingerprint, { s0: 'approved', s1: 'approved', s2: 'deferred' });
  const view = wb.view();
  assert.equal(view.items[0].executionMode, 'none');
  assert.equal(view.items[1].executionMode, 'host');
  assert.equal(view.items[1].executionState, null);
  assert.equal(view.items[2].recommendation, 'undetermined');
  assert.equal(view.items[2].decisionAllowed, false);
  assert.equal(view.items[3].executionMode, 'workbench');
  for (const id of ['s0', 's1', 's2']) await assert.rejects(wb.start('apply', { planFingerprint: wb.plan.fingerprint, requestId: 'try-'+id, itemIds: [id] }));
  await assert.rejects(wb.select(wb.plan.fingerprint, { s2: 'approved' }));
  const reopened = await new Workbench(f.run, { lockRoot: path.join(f.root, 'locks') }).open();
  assert.equal(reopened.state.selection.s0, 'approved');
  assert.equal(reopened.state.selection.s1, 'approved');
  assert.equal(reopened.state.jobs.length, 0);
});

test('Prune freezes advice-only local changes without granting execution', async t => {
  const f = await fixture(t, 9);
  const originals = await Promise.all(f.input.items.map(item => fingerprint(item.changes[0].path)));
  for (let n = 0; n < 8; n++) {
    const item = f.input.items[n];
    item.action = ['modify', 'disable', 'merge', 'split'][n % 4];
    item.scope = n < 4 ? 'user' : 'project';
    if (n < 4) delete item.changes; else item.changes = [];
  }
  const { wb } = await f.open();
  const ids = f.input.items.map(item => item.id);
  await wb.select(wb.plan.fingerprint, Object.fromEntries(ids.map(id => [id, 'approved'])));
  for (const item of wb.view().items.slice(0, 8)) {
    assert.equal(item.decisionAllowed, true);
    assert.equal(item.executionMode, 'unavailable');
    assert.equal(item.executionState, null);
    assert.equal(wb.state.selection[item.id], 'approved');
    await assert.rejects(wb.start('apply', { planFingerprint: wb.plan.fingerprint, requestId: `reject-${item.id}`, itemIds: [item.id] }), /不可执行/);
  }
  await assert.rejects(wb.start('apply', { planFingerprint: wb.plan.fingerprint, requestId: 'reject-mixed', itemIds: ids }), /不可执行/);
  assert.equal(wb.state.jobs.length, 0);
  const executable = wb.view().items.filter(item => item.executionMode === 'workbench').map(item => item.id);
  assert.deepEqual(executable, ['s8']);
  const job = await apply(wb, executable);
  assert.equal(job.status, 'completed');
  assert.deepEqual(job.items.map(item => item.id), ['s8']);
  for (let n = 0; n < 8; n++) assert.deepEqual(await fingerprint(path.join(f.skills, `s${n}`)), originals[n]);
  assert.equal((await restore(wb, job.id, executable)).status, 'completed');
  for (let n = 0; n < 9; n++) assert.deepEqual(await fingerprint(path.join(f.skills, `s${n}`)), originals[n]);
  const reopened = await new Workbench(f.run, { lockRoot: path.join(f.root, 'locks') }).open();
  for (const id of ids.slice(0, 8)) assert.equal(reopened.state.selection[id], 'approved');
});

test('Prune instruction decisions persist without permitting package writes', async t => {
  const f = await fixture(t, 1), changes = f.input.items[0].changes;
  const source = path.join(f.root, 'AGENTS.md');
  await fs.writeFile(source, 'Preserve project boundaries.\n');
  Object.assign(f.input.items[0], { kind: 'instruction', scope: 'project', name: 'AGENTS.md', sources: [source], changes: [] });
  const { wb } = await f.open();
  assert.equal(wb.view().items[0].decisionAllowed, true);
  assert.equal(wb.view().items[0].executionMode, 'unavailable');
  await wb.select(wb.plan.fingerprint, { s0: 'approved' });
  await assert.rejects(wb.start('apply', { planFingerprint: wb.plan.fingerprint, requestId: 'rule-apply', itemIds: ['s0'] }), /不可执行/);
  const reopened = await new Workbench(f.run, { lockRoot: path.join(f.root, 'locks') }).open();
  assert.equal(reopened.state.selection.s0, 'approved');
  assert.equal(await fs.readFile(source, 'utf8'), 'Preserve project boundaries.\n');
  f.input.items[0].changes = changes;
  await assert.rejects(prepare(f.input, path.join(f.root, 'invalid-rule-write')), /不能作为技能包/);
});

test('Prune advice-only support retains executable input validation', async t => {
  const f = await fixture(t, 1), item = f.input.items[0], changes = item.changes;
  for (const [n, malformed] of [null, {}, 'invalid'].entries()) {
    item.changes = malformed;
    await assert.rejects(prepare(f.input, path.join(f.root, `invalid-${n}`)));
  }
  item.changes = changes; item.rationale = '';
  await assert.rejects(prepare(f.input, path.join(f.root, 'no-rationale')), /具体理由/);
  item.rationale = 'Reviewed correction'; item.changes = [{ path: changes[0].path, candidate: null }];
  await assert.rejects(prepare(f.input, path.join(f.root, 'no-candidate')), /修改必须/);
  item.changes = changes;
  await fs.writeFile(path.join(changes[0].candidate, 'SKILL.md'), '# Missing metadata');
  await assert.rejects(prepare(f.input, path.join(f.root, 'invalid-candidate')), /name 和 description/);
});

test('Prune distinguishes incomplete review and missing candidates without reusing old approval', async t => {
  const f = await fixture(t, 3);
  f.input.intent = 'revise';
  Object.assign(f.input.items[0], { action: 'unreviewed', changes: [] });
  Object.assign(f.input.items[1], { changes: [], priorDecision: 'approved' });
  f.input.items[2].priorDecision = 'approved';
  const { plan, wb } = await f.open();
  assert.deepEqual(plan.completion, { status: 'partial', pendingReview: 1, missingCandidates: 1 });
  assert.equal(wb.view().items[0].reviewStatus, 'pending');
  assert.equal(wb.view().items[1].reviewStatus, 'reviewed');
  assert.match(wb.view().items[1].executionNote, /尚未准备/);
  assert.equal(wb.view().items[1].priorDecision, 'approved');
  assert.deepEqual(wb.state.selection, {});
  await assert.rejects(wb.start('apply', { planFingerprint: plan.fingerprint, requestId: 'old-approval', itemIds: ['s2'] }), /未经批准/);
});

test('Prune keeps unresolved provenance and missing grouped rule drafts incomplete', async t => {
  const f = await fixture(t, 2);
  f.input.intent = 'revise';
  Object.assign(f.input.items[0], { scope: 'unknown', changes: [] });
  Object.assign(f.input.items[1], { kind: 'instruction', action: 'merge', changes: [] });
  const { plan } = await f.open();
  assert.deepEqual(plan.completion, { status: 'partial', pendingReview: 0, missingCandidates: 2 });
});

test('Prune freezes rule revision previews without allowing writes and detects preview drift', async t => {
  const f = await fixture(t, 1), source = path.join(f.root, 'AGENTS.md'), draft = path.join(f.drafts, 'AGENTS.md');
  await fs.writeFile(source, 'Keep project contract.\nAlways install dependencies.\n');
  await fs.writeFile(draft, 'Keep project contract.\nInstall dependencies when needed.\n');
  Object.assign(f.input.items[0], { kind: 'instruction', sources: [source], changes: [], revisionDraft: { source, path: draft } });
  f.input.intent = 'revise';
  const { plan, wb } = await f.open();
  assert.equal(plan.completion.status, 'partial', 'a preview-only draft does not complete a request to implement revisions');
  assert.equal(plan.completion.missingCandidates, 1);
  const preview = await wb.details('s0');
  assert.equal(preview.files[0].previewOnly, true);
  assert.match(preview.files[0].before, /Always install/);
  assert.match(preview.files[0].after, /when needed/);
  await fs.writeFile(draft, 'Later draft changed');
  assert.equal((await wb.details('s0')).files[0].after, preview.files[0].after);
  await wb.select(plan.fingerprint, { s0: 'approved' });
  await assert.rejects(wb.start('apply', { planFingerprint: plan.fingerprint, requestId: 'preview-write', itemIds: ['s0'] }), /不可执行/);
  assert.match(await fs.readFile(source, 'utf8'), /Always install/);
  await fs.appendFile(path.join(f.run, plan.items[0].revisionDraft.after), 'Tampered');
  await assert.rejects(wb.details('s0'), /预览已变化/);
});

test('Prune rejects duplicate plugin objects and internal skill changes masquerading as whole plugins', async t => {
  const f = await fixture(t, 2);
  for (const item of f.input.items) Object.assign(item, { kind: 'plugin', scope: 'plugin', action: 'disable', plugin: { id: 'same@market' }, changes: [] });
  await assert.rejects(prepare(f.input, f.run), /唯一/);
  f.input.items = [{ ...f.input.items[0], changes: [{ path: path.join(f.skills,'s0') }] }];
  await assert.rejects(prepare(f.input, path.join(f.root,'other-run')), /内部技能/);
});

test('Prune keeps unreviewed inventory distinct and refuses its approval or execution', async t => {
  const f = await fixture(t, 1), before = await fingerprint(path.join(f.skills, 's0'));
  f.input.items[0].action = 'unreviewed'; f.input.items[0].changes = [];
  const { wb } = await f.open();
  assert.equal(wb.view().items[0].action, 'unreviewed');
  await assert.rejects(wb.select(wb.plan.fingerprint, { s0: 'approved' }));
  await assert.rejects(wb.start('apply', { planFingerprint: wb.plan.fingerprint, requestId: 'inventory', itemIds: ['s0'] }));
  assert.deepEqual(await fingerprint(path.join(f.skills, 's0')), before);
});

test('Prune disables by archiving the entire package; browser selection survives reopening', async t => {
  const f = await fixture(t, 1); f.input.items[0].action = 'disable'; f.input.items[0].changes[0].candidate = null;
  const { wb } = await f.open(); await wb.select(wb.plan.fingerprint, { s0: 'approved' });
  const reopened = await new Workbench(f.run, { lockRoot: path.join(f.root, 'locks') }).open();
  assert.equal(reopened.state.selection.s0, 'approved');
  const job = await apply(reopened, ['s0']); assert.equal(job.status, 'completed'); assert.equal(await exists(path.join(f.skills, 's0')), false);
  assert.equal(await exists(path.join(f.run, job.items[0].steps[0].archive, 'asset.bin')), true);
  assert.equal((await restore(reopened, job.id, ['s0'])).status, 'completed');
  assert.equal(await exists(path.join(f.skills, 's0/SKILL.md')), true);
});

test('Prune rejects source drift, stops later items, and retains already successful items', async t => {
  const f = await fixture(t); const { wb } = await f.open();
  await fs.appendFile(path.join(f.skills, 's1/SKILL.md'), 'User change.');
  const job = await apply(wb, ['s0', 's1', 's2']); assert.equal(job.status, 'failed');
  assert.equal(job.items[0].status, 'applied'); assert.equal(job.items[2].status, 'pending');
  assert.match(await fs.readFile(path.join(f.skills, 's1/SKILL.md'), 'utf8'), /User change/);
  assert.equal(wb.view().items[1].lastOutcome.status, 'blocked');
  assert.match(await fs.readFile(path.join(f.skills, 's2/SKILL.md'), 'utf8'), /Original/);
  assert.equal((await restore(wb, job.id, ['s0'])).status, 'completed');
});

test('Prune blocks candidate drift and does not replace later user edits during restore', async t => {
  const f = await fixture(t, 2), { wb } = await f.open();
  await fs.appendFile(path.join(f.run, wb.item('s1').changes[0].candidate, 'SKILL.md'), 'Tampered.');
  const bad = await apply(wb, ['s1']); assert.equal(bad.status, 'failed');
  assert.match(await fs.readFile(path.join(f.skills, 's1/SKILL.md'), 'utf8'), /Original/);
  const job = await apply(wb, ['s0'], 'good');
  await fs.appendFile(path.join(f.skills, 's0/SKILL.md'), 'User after apply.');
  const recovery = await restore(wb, job.id, ['s0']); assert.equal(recovery.status, 'failed');
  assert.equal(wb.view().items[0].executionState, 'problem');
  assert.match(await fs.readFile(path.join(f.skills, 's0/SKILL.md'), 'utf8'), /User after apply/);
});

test('Prune merge and split are whole groups with new targets and exact restoration', async t => {
  const f = await fixture(t, 3); const hashes = await Promise.all([0, 1, 2].map(i => fingerprint(path.join(f.skills, `s${i}`))));
  f.input.items = [{ ...f.input.items[0], action: 'merge', changes: [
    { path: path.join(f.skills, 's0'), candidate: null }, { path: path.join(f.skills, 's1'), candidate: null },
    { path: path.join(f.skills, 'merged'), candidate: path.join(f.drafts, 's0') }
  ] }, { ...f.input.items[2], action: 'split', changes: [
    { path: path.join(f.skills, 's2'), candidate: null },
    { path: path.join(f.skills, 'part-a'), candidate: path.join(f.drafts, 's1') },
    { path: path.join(f.skills, 'part-b'), candidate: path.join(f.drafts, 's2') }
  ] }];
  const { wb } = await f.open(), job = await apply(wb, ['s0', 's2']);
  assert.equal(job.status, 'completed'); assert.equal(await exists(path.join(f.skills, 'merged/SKILL.md')), true);
  assert.equal(await exists(path.join(f.skills, 'part-b/SKILL.md')), true);
  assert.equal((await restore(wb, job.id, ['s0', 's2'])).status, 'completed');
  assert.equal(await exists(path.join(f.skills, 'merged')), false);
  assert.deepEqual(await Promise.all([0, 1, 2].map(i => fingerprint(path.join(f.skills, `s${i}`)))), hashes);
});

test('Prune materializes a junction as an independent copy without changing its target', async t => {
  const f = await fixture(t, 1), target = path.join(f.root, 'shared');
  await fs.rename(path.join(f.skills, 's0'), target); await fs.symlink(target, path.join(f.skills, 's0'), process.platform === 'win32' ? 'junction' : 'dir');
  const original = await fingerprint(target), { wb } = await f.open();
  const job = await apply(wb, ['s0']); assert.equal(job.status, 'completed');
  assert.equal((await fs.lstat(path.join(f.skills, 's0'))).isSymbolicLink(), false);
  assert.deepEqual(await fingerprint(target), original);
  assert.equal((await restore(wb, job.id, ['s0'])).status, 'completed');
  assert.equal((await fs.lstat(path.join(f.skills, 's0'))).isSymbolicLink(), true);
});

test('Prune detects plugin targets through junctions and does not approve them', async t => {
  const f = await fixture(t, 1), target = path.join(f.root, 'plugins/vendor/skill');
  await fs.mkdir(path.dirname(target), { recursive: true }); await fs.rename(path.join(f.skills, 's0'), target);
  await fs.symlink(target, path.join(f.skills, 's0'), process.platform === 'win32' ? 'junction' : 'dir');
  const { wb } = await f.open(); assert.match(wb.item('s0').blocked, /插件/);
  await assert.rejects(wb.select(wb.plan.fingerprint, { s0: 'approved' }), /不可批准/);
});

test('Prune rejects discovery-root archives, overlapping changes and invalid candidate links', async t => {
  const f = await fixture(t, 1);
  await assert.rejects(prepare(f.input, path.join(f.skills, 'archive')), /发现目录之外/);
  f.input.items.push({ ...f.input.items[0], id: 'other' });
  await assert.rejects(prepare(f.input, f.run), /相互包含/);
  f.input.items.pop(); await fs.appendFile(path.join(f.drafts, 's0/SKILL.md'), '\n[missing](references/missing.md)');
  await assert.rejects(prepare(f.input, path.join(f.root, 'new-run')), /引用缺失/);
});

test('Prune idempotency rejects different payloads and never executes the same request twice', async t => {
  const f = await fixture(t, 2), { wb } = await f.open(); const job = await apply(wb, ['s0']);
  const again = await wb.start('apply', { planFingerprint: wb.plan.fingerprint, requestId: 'apply', itemIds: ['s0'] });
  assert.equal(again.id, job.id); assert.equal(wb.state.jobs.length, 1);
  await assert.rejects(wb.start('apply', { planFingerprint: wb.plan.fingerprint, requestId: 'apply', itemIds: ['s1'] }), /不同操作/);
});

test('Prune recovers an interrupted move from its journal without replaying application', async t => {
  const f = await fixture(t, 1), { wb } = await f.open();
  const change = wb.item('s0').changes[0]; const archive = 'operations/interrupted/s0/0/original';
  const step = { index: 0, archive, staged: 'operations/interrupted/s0/0/replacement', stage: 'moving' };
  await fs.mkdir(path.dirname(path.join(f.run, archive)), { recursive: true });
  await fs.rename(change.path, path.join(f.run, archive));
  wb.state.jobs.push({ id: 'interrupted', requestId: 'interrupted', requestHash: '', kind: 'apply', status: 'running', items: [{ id: 's0', status: 'running', steps: [step] }] });
  await wb.save();
  const reopened = await new Workbench(f.run, { lockRoot: path.join(f.root, 'locks') }).open();
  assert.equal(reopened.state.jobs[0].status, 'interrupted'); assert.equal(await exists(change.path), false);
  assert.equal((await restore(reopened, 'interrupted', ['s0'])).status, 'completed');
  assert.match(await fs.readFile(path.join(change.path, 'SKILL.md'), 'utf8'), /Original/);
});

test('Prune rolls back an item after a mid-group failure without touching other files', async t => {
  const f = await fixture(t, 2); f.input.items = [{ ...f.input.items[0], action: 'merge', changes: [...f.input.items[0].changes, ...f.input.items[1].changes] }];
  const { wb } = await f.open(), originalSave = wb.save.bind(wb); let injected = false;
  wb.save = async () => {
    await originalSave();
    const entry = wb.state.jobs[0]?.items[0];
    if (!injected && entry?.steps[0]?.stage === 'installed') { injected = true; throw new Error('Injected interruption between source paths'); }
  };
  const job = await apply(wb, ['s0']); assert.equal(job.status, 'failed'); assert.equal(job.items[0].status, 'rolled-back');
  for (const name of ['s0', 's1']) assert.match(await fs.readFile(path.join(f.skills, name, 'SKILL.md'), 'utf8'), /Original/);
});

test('Prune HTTP requires same-origin token, preserves selected state, and serves an offline template', async t => {
  const f = await fixture(t, 1); await f.open();
  const service = await serve(f.run, { lockRoot: path.join(f.root, 'locks') }); t.after(service.close);
  const response = await fetch(service.base); const html = await response.text();
  assert.match(html, /id="app-nav"/); assert.match(html, /裁剪台/); assert.doesNotMatch(html, /<script[^>]+src="https?:/);
  assert.equal((await fetch(service.base + '/api/state')).status, 401);
  const headers = { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json', Origin: service.base };
  assert.equal((await fetch(service.base + '/api/selection', { method: 'POST', headers: { ...headers, Origin: 'https://attacker.invalid' }, body: '{}' })).status, 403);
  const chosen = await fetch(service.base + '/api/selection', { method: 'POST', headers, body: JSON.stringify({ planFingerprint: service.workbench.plan.fingerprint, decisions: { s0: 'approved' } }) });
  assert.equal(chosen.status, 200); assert.equal((await chosen.json()).selection.s0, 'approved');
  assert.equal((await readJSON(path.join(f.run, 'state.json'))).selection.s0, 'approved');
  await assert.rejects(serve(f.run), /已有服务/);
});

test('Prune rejects a source parent redirected by a junction after prepare', async t => {
  const f = await fixture(t, 1), { wb } = await f.open();
  const original = await fingerprint(path.join(f.skills, 's0')), moved = path.join(f.root, 'moved-skills');
  await fs.rename(f.skills, moved);
  await fs.symlink(moved, f.skills, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(apply(wb, ['s0']), /发现目录的链接目标已变化/);
  assert.equal((await fingerprint(path.join(moved, 's0'))).hash, original.hash);
  assert.equal(await exists(path.join(f.run, 'operations')), false);
});

test('Prune preserves applied modify and disable operations across restart and restores whole packages', async t => {
  const f = await fixture(t, 2);
  f.input.items[1].action = 'disable'; f.input.items[1].changes[0].candidate = null;
  const original = await fingerprint(f.skills);
  await f.open();
  const first = await serve(f.run, { lockRoot: path.join(f.root, 'locks') });
  const token = first.token;
  let job;
  try {
    job = await apply(first.workbench, ['s0', 's1']);
    assert.equal(job.status, 'completed');
    assert.match(await fs.readFile(path.join(f.skills, 's0/SKILL.md'), 'utf8'), /Reviewed/);
    assert.equal(await exists(path.join(f.skills, 's1')), false);
  } finally { await first.close(); }
  const second = await serve(f.run, { lockRoot: path.join(f.root, 'locks') });
  try {
    assert.equal(second.token, token);
    const result = await fetch(`${second.base}/api/state`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(result.status, 200);
    const view = await result.json();
    assert.deepEqual(view.items.map(item => item.executionState), ['applied', 'applied']);
    assert.deepEqual(view.selection, { s0: 'approved', s1: 'approved' });
    await assert.rejects(second.workbench.select(second.workbench.plan.fingerprint, { s0: 'none' }), /未恢复操作/);
    const restored = await restore(second.workbench, job.id, ['s0', 's1']);
    assert.equal(restored.status, 'completed');
    assert.deepEqual(await fingerprint(f.skills), original);
    assert.deepEqual(second.workbench.view().items.map(item => item.executionState), ['ready', 'ready']);
  } finally { await second.close(); }
});

test('Prune rejects an internal archive junction before touching source packages', async t => {
  const f = await fixture(t, 1), original = await fingerprint(f.skills), { wb } = await f.open();
  await fs.symlink(f.skills, path.join(f.run, 'operations'), process.platform === 'win32' ? 'junction' : 'dir');
  const job = await apply(wb, ['s0']);
  assert.equal(job.status, 'failed'); assert.match(job.error, /归档内部路径/);
  assert.equal(wb.state.selection.s0, 'none');
  assert.deepEqual(await fingerprint(f.skills), original);
});

test('Prune checks real Markdown references while excluding literal code examples', async t => {
  const f = await fixture(t, 1), candidate = path.join(f.drafts, 's0');
  await fs.appendFile(path.join(candidate, 'SKILL.md'), '\nExample: `[title](url)`\n\n```md\n[example](not-a-file)\n```\n\n[Resource](asset.bin)\n');
  await validatePackage(candidate);
  await fs.appendFile(path.join(candidate, 'SKILL.md'), '\n[Missing resource](missing.bin)\n');
  await assert.rejects(validatePackage(candidate), /引用缺失/);
});

test('Prune rejects a prepared run redirected into discovery before open or apply', async t => {
  const f = await fixture(t, 1), { wb } = await f.open();
  const original = await fingerprint(path.join(f.skills, 's0'));
  await wb.select(wb.plan.fingerprint, { s0: 'approved' });
  const moved = path.join(f.skills, 'relocated-run');
  await fs.rename(f.run, moved);
  await fs.symlink(moved, f.run, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(new Workbench(f.run, { lockRoot: path.join(f.root, 'locks') }).open(), /工作记录目录的真实路径已变化/);
  await assert.rejects(wb.start('apply', { planFingerprint: wb.plan.fingerprint, requestId: 'redirected', itemIds: ['s0'] }), /工作记录目录的真实路径已变化/);
  assert.deepEqual(await fingerprint(path.join(f.skills, 's0')), original);
  assert.equal(await exists(path.join(moved, 'operations')), false);
});

test('Prune restores the complete merge group when its second archive rename fails', async t => {
  const f = await fixture(t, 2), original = await fingerprint(f.skills);
  f.input.items = [{ ...f.input.items[0], action: 'merge', changes: [
    { path: path.join(f.skills, 's0'), candidate: null },
    { path: path.join(f.skills, 's1'), candidate: null },
    { path: path.join(f.skills, 'merged'), candidate: path.join(f.drafts, 's0') }
  ] }];
  const { wb } = await f.open(), originalRename = fs.rename; let injected = false;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (!injected && from === path.join(f.skills, 's1')) {
      injected = true;
      throw Object.assign(new Error('Injected EACCES on second archive'), { code: 'EACCES' });
    }
    return originalRename(from, to);
  });
  const job = await apply(wb, ['s0']);
  assert.equal(injected, true);
  assert.equal(job.status, 'failed');
  assert.equal(job.items[0].status, 'rolled-back');
  assert.deepEqual(await fingerprint(f.skills), original);
});

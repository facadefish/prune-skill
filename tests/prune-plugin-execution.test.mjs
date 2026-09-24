import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepare, Workbench } from '../skills/prune/scripts/engine.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prune-host-execution-'));
  t.after(async () => { assert.equal(path.dirname(root), os.tmpdir()); assert(path.basename(root).startsWith('prune-host-execution-')); await fs.rm(root, { recursive: true, force: true }); });
  await fs.mkdir(path.join(root, 'skills')); await fs.mkdir(path.join(root, '.claude-plugin'));
  await fs.writeFile(path.join(root, '.claude-plugin/plugin.json'), '{"name":"fixture"}');
  const row = { id: 'fixture@test', scope: 'user', enabled: true, version: '1', installPath: root }, calls = [];
  const pluginHost = { run: async (cmd, args) => { calls.push(args); if (args[1] !== 'list') row.enabled = args[1] === 'enable'; return { stdout: JSON.stringify([row]) }; } };
  const input = { schemaVersion: 1, profile: { model: 'fixture', tasks: ['plugin'] }, discoveryRoots: [path.join(root, 'skills')], items: [{ id: 'plugin', name: 'fixture', kind: 'plugin', scope: 'plugin', action: 'disable', rationale: '临时验证', plugin: { id: row.id, control: { host: 'claude-code', pluginId: row.id, scope: 'user', desiredEnabled: false } } }] };
  const run = path.join(root, 'run'); await prepare(input, run, { pluginHost });
  const options = { pluginHost, lockRoot: path.join(root, 'lock') }, wb = await new Workbench(run, options).open();
  return { root, row, wb, run, options, calls };
}
async function start(wb, kind, id, operationId) {
  const job = await wb.start(kind, { planFingerprint: wb.plan.fingerprint, requestId: id, itemIds: ['plugin'], operationId });
  await wb.pending; return job;
}

test('Plugin Apply is gated, idempotent, persists and restores the exact selected host target', async t => {
  const f = await fixture(t), wb = f.wb;
  assert.equal(wb.view().items[0].executable, true);
  assert.equal(wb.view().items[0].executionMode, 'host');
  await assert.rejects(start(wb, 'apply', 'unapproved'), /未经批准/);
  await wb.select(wb.plan.fingerprint, { plugin: 'approved' });
  const job = await start(wb, 'apply', 'apply');
  assert.equal(job.status, 'completed'); assert.equal(f.row.enabled, false);
  assert.equal((await start(wb, 'apply', 'apply')).id, job.id);
  assert.equal(f.calls.filter(args => args[1] === 'disable').length, 1);
  await wb.refreshObservations(true);
  assert.equal(wb.view().items[0].effectiveState.status, 'verified');
  assert.equal(wb.view().items[0].effectiveState.loaded, 'unknown');
  const reopened = await new Workbench(f.run, f.options).open();
  assert.equal((await start(reopened, 'restore', 'restore', job.id)).status, 'completed');
  assert.equal(f.row.enabled, true); assert.equal(reopened.state.selection.plugin, 'none');
  await reopened.refreshObservations(true);
  assert.equal(reopened.view().items[0].effectiveState.status, 'verified');
});

test('Plugin version drift after application is visible and does not get overwritten by Restore', async t => {
  const f = await fixture(t), wb = f.wb;
  await wb.select(wb.plan.fingerprint, { plugin: 'approved' });
  const job = await start(wb, 'apply', 'apply');
  f.row.version = '2';
  await wb.refreshObservations(true);
  assert.equal(wb.view().items[0].effectiveState.status, 'drifted');
  assert.equal((await start(wb, 'restore', 'restore', job.id)).status, 'failed');
  assert.equal(f.row.enabled, false);
  assert.equal(f.calls.filter(args => args[1] === 'enable').length, 0);
});

test('Codex restored enabled state with a new explicit key stays verified and can be applied again', async t => {
  const f = await fixture(t);
  let explicit, version = 0;
  const pluginId = 'fixture@test', configPath = path.join(f.root, 'config.toml');
  const pluginHost = { rpc: async (method, params) => {
    if (method === 'plugin/installed') return { marketplaces: [{ name: 'test', path: f.root, plugins: [{ id: pluginId, source: { type: 'local', path: f.root }, installed: true, enabled: explicit ?? true, localVersion: '1' }] }] };
    const config = explicit === undefined ? {} : { plugins: { [pluginId]: { enabled: explicit } } };
    if (method === 'config/read') return { config, layers: [{ name: { type: 'user', file: configPath }, version: String(version), config }] };
    assert.equal(method, 'config/value/write'); assert.equal(params.expectedVersion, String(version));
    explicit = params.value; version++; return { status: 'ok' };
  } };
  const input = { schemaVersion: 1, profile: { model: 'fixture', tasks: ['plugins'] }, discoveryRoots: [path.join(f.root, 'skills')], items: [{ id: 'plugin', kind: 'plugin', scope: 'plugin', action: 'disable', plugin: { id: pluginId, control: { host: 'codex', scope: 'user', pluginId, desiredEnabled: false } } }] };
  const run = path.join(f.root, 'codex-run'); await prepare(input, run, { pluginHost });
  const wb = await new Workbench(run, { pluginHost, lockRoot: path.join(f.root, 'codex-lock') }).open();
  for (let n = 0; n < 2; n++) {
    await wb.select(wb.plan.fingerprint, { plugin: 'approved' });
    const applied = await start(wb, 'apply', `apply-${n}`);
    assert.equal(applied.status, 'completed'); assert.equal(explicit, false);
    assert.equal((await start(wb, 'restore', `restore-${n}`, applied.id)).status, 'completed');
    assert.equal(explicit, true);
    await wb.refreshObservations(true);
    assert.equal(wb.view().items[0].effectiveState.status, 'verified');
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { preparePluginControl, readPluginState, setPluginEnabled, codexRequest } from '../skills/prune/scripts/plugin-host.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prune-plugin-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.claude-plugin'));
  await fs.writeFile(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'sample' }));
  const row = { id: 'sample@test', enabled: true, scope: 'user', version: '1', installPath: root };
  const calls = [];
  const run = async (command, args, options) => {
    calls.push({ command, args, options });
    assert.equal(command, 'claude');
    if (args[1] === 'list') return { stdout: JSON.stringify([row]) };
    row.enabled = args[1] === 'enable';
    return { stdout: 'done' };
  };
  return { root, row, calls, run, control: { host: 'claude-code', pluginId: row.id, scope: 'user' } };
}

test('Claude disable and restore use exact ID/scope and read back; session loading remains unknown', async t => {
  const f = await fixture(t), deps = { run: f.run };
  const prepared = await preparePluginControl(f.control, deps);
  const disabled = await setPluginEnabled(prepared.control, false, prepared.before, deps);
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.loaded, 'unknown');
  assert.equal(disabled.reloadRequired, true);
  const restored = await setPluginEnabled(prepared.control, true, disabled, deps);
  assert.equal(restored.enabled, true);
  assert.deepEqual(f.calls.filter(x => x.args[1] !== 'list').map(x => x.args), [
    ['plugin', 'disable', 'sample@test', '--scope', 'user'],
    ['plugin', 'enable', 'sample@test', '--scope', 'user'],
  ]);
});

test('Claude project scope uses frozen real directory and refuses version drift', async t => {
  const f = await fixture(t); f.row.scope = 'project';
  const control = { ...f.control, scope: 'project', projectRoot: f.root };
  const prepared = await preparePluginControl(control, { run: f.run });
  f.row.version = '2';
  await assert.rejects(setPluginEnabled(control, false, prepared.before, { run: f.run }), /已变化/);
  assert.ok(f.calls.every(x => x.options.cwd === prepared.control.projectRoot));
  assert.ok(f.calls.every(x => x.args[1] === 'list'));
});

test('invalid IDs, absent scopes and unsupported hosts never invoke a command', async () => {
  const run = () => assert.fail('must not execute');
  for (const raw of [{ host: 'claude-code', pluginId: '--all', scope: 'user' }, { host: 'claude-code', pluginId: 'a@b', scope: 'project' }, { host: 'other', pluginId: 'a@b', scope: 'user' }]) {
    assert.ok((await readPluginState(raw, { run })).blocked);
    await assert.rejects(preparePluginControl(raw, { run }));
  }
});

test('Claude command errors and false-success readbacks do not report success', async t => {
  const f = await fixture(t);
  const prepared = await preparePluginControl(f.control, { run: f.run });
  const run = async (...args) => args[1][1] === 'list' ? f.run(...args) : { stdout: 'success' };
  await assert.rejects(setPluginEnabled(f.control, false, prepared.before, { run }), /读回未确认/);
  const failing = async (...args) => { if (args[1][1] !== 'list') throw new Error('policy denied'); return f.run(...args); };
  await assert.rejects(setPluginEnabled(f.control, false, prepared.before, { run: failing }), /policy denied/);
});

test('Claude plugin dependencies block implicit transitive enablement', async t => {
  const f = await fixture(t); f.row.enabled = false;
  await fs.writeFile(path.join(f.root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'sample', dependencies: ['other'] }));
  const prepared = await preparePluginControl(f.control, { run: f.run });
  await assert.rejects(setPluginEnabled(f.control, true, prepared.before, { run: f.run }), /连带修改/);
  assert.ok(f.calls.every(x => x.args[1] === 'list'));
});

test('Claude disable is blocked when dependencies or missing manifest prevent safe restore', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'sample', dependencies: ['other'] }));
  const prepared = await preparePluginControl({ ...f.control, desiredEnabled: false }, { run: f.run });
  assert.match(prepared.before.blocked, /安全恢复/);
  await assert.rejects(setPluginEnabled(f.control, false, prepared.before, { run: f.run }), error => error.hostMutationAttempted === false && /安全恢复/.test(error.message));
  await fs.unlink(path.join(f.root, '.claude-plugin', 'plugin.json'));
  const missing = await preparePluginControl({ ...f.control, desiredEnabled: false }, { run: f.run });
  assert.match(missing.before.blocked, /清单不可读或缺失/);
  assert.ok(f.calls.every(x => x.args[1] === 'list'));
});

function codexFixture(root) {
  const configPath = path.join(root, 'config.toml');
  let enabled = true, version = 'v1';
  const calls = [];
  const plugin = { id: 'sample@test', source: { type: 'local', path: root }, enabled: true, installed: true, localVersion: '1' };
  const marketplace = { name: 'test', path: path.join(root, 'marketplace.json'), plugins: [plugin] };
  const rpc = async (method, params) => {
    calls.push({ method, params });
    if (method === 'plugin/installed') return { marketplaces: [marketplace] };
    if (method === 'config/read') return { config: { plugins: { 'sample@test': { enabled } } }, layers: [{ name: { type: 'user', file: configPath }, version, config: { plugins: { 'sample@test': { enabled } } } }] };
    assert.equal(method, 'config/value/write');
    assert.equal(params.expectedVersion, version);
    assert.equal(params.filePath, configPath);
    assert.equal(params.keyPath, 'plugins."sample@test".enabled');
    assert.equal(params.mergeStrategy, 'replace');
    enabled = params.value; version += 'x';
    return { status: 'ok', version, filePath: configPath };
  };
  return { rpc, calls, plugin, marketplace, control: { host: 'codex', pluginId: plugin.id, scope: 'user' } };
}

test('Codex official versioned single-key write supports disable and restore without TOML rewriting', async t => {
  const f = await fixture(t), c = codexFixture(f.root), deps = { rpc: c.rpc };
  const prepared = await preparePluginControl(c.control, deps);
  const disabled = await setPluginEnabled(c.control, false, prepared.before, deps);
  assert.equal(disabled.enabled, false);
  const restored = await setPluginEnabled(c.control, true, disabled, deps);
  assert.equal(restored.enabled, true);
  assert.equal(c.calls.filter(x => x.method === 'config/value/write').length, 2);
});

test('Codex remote and platform plugins are explicitly blocked', async t => {
  const f = await fixture(t), c = codexFixture(f.root);
  c.plugin.source = { type: 'remote' }; c.marketplace.path = null;
  const remote = await readPluginState(c.control, { rpc: c.rpc });
  assert.match(remote.blocked, /远端或工作区/);
  await assert.rejects(setPluginEnabled(c.control, false, remote, { rpc: c.rpc }), /远端或工作区/);
  c.marketplace.name = 'openai-bundled';
  assert.match((await readPluginState(c.control, { rpc: c.rpc })).blocked, /平台固定/);
  assert.ok(c.calls.every(x => x.method === 'plugin/installed'));
});

test('Codex overridden write is never reported as effective', async t => {
  const f = await fixture(t), c = codexFixture(f.root);
  const rpc = async (method, params) => method === 'config/value/write' ? { status: 'okOverridden' } : c.rpc(method, params);
  const prepared = await preparePluginControl(c.control, { rpc });
  await assert.rejects(setPluginEnabled(c.control, false, prepared.before, { rpc }), error => error.hostMutationAttempted === true && /覆盖/.test(error.message));
});

test('Codex global scope ignores project override and project writes are blocked', async t => {
  const f = await fixture(t), c = codexFixture(f.root);
  const rpc = async (method, params, options) => {
    assert.equal(options.cwd, os.homedir());
    if (method === 'config/read') assert.equal(params.cwd, null);
    if (method === 'plugin/installed') assert.equal(params.cwds, null);
    return c.rpc(method, params);
  };
  const prepared = await preparePluginControl({ ...c.control, projectRoot: f.root }, { rpc });
  assert.equal(prepared.control.projectRoot, undefined);
  assert.equal((await setPluginEnabled(prepared.control, false, prepared.before, { rpc })).enabled, false);
  const project = await readPluginState({ ...c.control, scope: 'project', projectRoot: f.root }, { rpc: () => assert.fail('unsupported scope must not call host') });
  assert.match(project.blocked, /仅允许用户配置/);
});

test('Codex administrator-controlled effective state is blocked before a no-op or write', async t => {
  const f = await fixture(t), c = codexFixture(f.root);
  const rpc = async (method, params) => {
    assert.notEqual(method, 'config/value/write');
    const result = await c.rpc(method, params);
    if (method === 'config/read') result.origins = { 'plugins.sample@test.enabled': { name: { type: 'enterpriseManaged', id: 'policy', name: 'policy' }, version: 'managed' } };
    return result;
  };
  const prepared = await preparePluginControl(c.control, { rpc });
  assert.match(prepared.before.blocked, /管理员配置/);
  await assert.rejects(setPluginEnabled(c.control, true, prepared.before, { rpc }), error => error.hostMutationAttempted === false && /管理员配置/.test(error.message));
  await assert.rejects(setPluginEnabled(c.control, false, prepared.before, { rpc }), /管理员配置/);
});

test('unrelated Codex config changes use fresh CAS version without invalidating the target', async t => {
  const f = await fixture(t), c = codexFixture(f.root);
  let configVersion = 'v1';
  const rpc = async (method, params) => {
    if (method === 'config/value/write') {
      assert.equal(params.expectedVersion, 'v2');
      return c.rpc(method, { ...params, expectedVersion: 'v1' });
    }
    const result = await c.rpc(method, params);
    if (method === 'config/read') result.layers[0].version = configVersion;
    return result;
  };
  const prepared = await preparePluginControl(c.control, { rpc });
  configVersion = 'v2';
  assert.equal((await setPluginEnabled(c.control, false, prepared.before, { rpc })).enabled, false);
});

test('official Codex RPC writes and restores only an isolated config', { skip: process.env.PRUNE_TEST_CODEX_RPC !== '1' }, async t => {
  const f = await fixture(t);
  const configPath = path.join(f.root, 'config.toml');
  await fs.writeFile(configPath, '# preserve comment\n[plugins."sample@test"]\nenabled = true\n');
  const options = { env: { ...process.env, CODEX_HOME: f.root }, cwd: f.root };
  const read = () => codexRequest('config/read', { includeLayers: true, cwd: f.root }, options);
  const before = await read();
  const layer = before.layers.find(x => x.name.type === 'user');
  const write = (value, expectedVersion) => codexRequest('config/value/write', { filePath: configPath, keyPath: 'plugins."sample@test".enabled', value, mergeStrategy: 'replace', expectedVersion }, options);
  const written = await write(false, layer.version);
  assert.equal(written.status, 'ok');
  assert.equal((await read()).config.plugins['sample@test'].enabled, false);
  await assert.rejects(write(true, layer.version), /version|changed|conflict/i);
  await write(true, written.version);
  assert.equal((await read()).config.plugins['sample@test'].enabled, true);
  assert.match(await fs.readFile(configPath, 'utf8'), /preserve comment/);
});

test('official Claude CLI disables and restores a local fixture in isolated CLAUDE_CONFIG_DIR', { skip: process.env.PRUNE_TEST_CLAUDE_CLI !== '1' }, async t => {
  const f = await fixture(t);
  const home = path.join(f.root, 'isolated-home'), market = path.join(f.root, 'market');
  await fs.mkdir(home);
  await fs.mkdir(path.join(market, '.claude-plugin'), { recursive: true });
  await fs.mkdir(path.join(market, 'sample', '.claude-plugin'), { recursive: true });
  await fs.writeFile(path.join(market, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'prune-acceptance-local', owner: { name: 'Prune fixture' }, plugins: [{ name: 'sample', source: './sample', description: 'Temporary acceptance fixture' }] }));
  await fs.writeFile(path.join(market, 'sample', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'sample', version: '1.0.0', description: 'Temporary acceptance fixture' }));
  const execute = promisify(execFile);
  const run = (command, args) => execute(command, args, { cwd: f.root, env: { ...process.env, CLAUDE_CONFIG_DIR: home }, timeout: 30000, windowsHide: true, shell: false });
  const initial = JSON.parse((await run('claude', ['plugin', 'list', '--json'])).stdout);
  assert.deepEqual(initial, [], 'isolated CLI must not see real installed plugins');
  await run('claude', ['plugin', 'marketplace', 'add', market, '--scope', 'user']);
  await run('claude', ['plugin', 'install', 'sample@prune-acceptance-local', '--scope', 'user']);
  const control = { host: 'claude-code', pluginId: 'sample@prune-acceptance-local', scope: 'user', desiredEnabled: false };
  const prepared = await preparePluginControl(control, { run });
  assert.equal(prepared.before.blocked, null);
  assert.equal(prepared.before.enabled, true);
  assert.ok(prepared.before.installPath.startsWith(f.root));
  const disabled = await setPluginEnabled(control, false, prepared.before, { run });
  assert.equal(disabled.enabled, false);
  assert.equal(JSON.parse(await fs.readFile(path.join(home, 'settings.json'), 'utf8')).enabledPlugins[control.pluginId], false);
  const restored = await setPluginEnabled(control, true, disabled, { run });
  assert.equal(restored.enabled, true);
  assert.equal(JSON.parse(await fs.readFile(path.join(home, 'settings.json'), 'utf8')).enabledPlugins[control.pluginId], true);
});

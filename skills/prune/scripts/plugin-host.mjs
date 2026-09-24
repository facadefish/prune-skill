import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';

const execute = promisify(execFile);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const check = (condition, message) => { if (!condition) throw new Error(message); };
const qualifiedId = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*@[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

// Only the official executable and fixed argument arrays are accepted. Plans
// cannot supply commands, environment overrides, or shell fragments.
async function run(command, args, options) {
  return execute(command, args, { ...options, timeout: 30000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, shell: false });
}

export async function codexRequest(method, params, options = {}) {
  const child = spawn('codex', ['app-server', '--stdio'], { cwd: options.cwd, env: options.env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = createInterface({ input: child.stdout });
  let settled = false;
  return new Promise((resolve, reject) => {
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer); lines.close(); child.stdin.destroy(); child.kill();
      const complete = () => error ? reject(error) : resolve(result);
      if (child.exitCode !== null || child.signalCode !== null || !child.pid) complete();
      else child.once('close', complete);
    };
    const timer = setTimeout(() => finish(new Error('Codex app-server 请求超时；无法确认插件状态')), 30000);
    child.on('error', error => finish(error));
    child.on('exit', () => finish(new Error('Codex app-server 在返回结果前退出')));
    child.stderr.resume();
    child.stdin.on('error', error => finish(error));
    const send = message => child.stdin.write(`${JSON.stringify(message)}\n`);
    lines.on('line', line => {
      let response;
      try { response = JSON.parse(line); } catch { return; }
      if (response.id !== 1 && response.id !== 2) return;
      if (response.error) return finish(new Error(`Codex ${method}：${response.error.message || '请求失败'}`));
      if (response.id === 1) {
        send({ method: 'initialized', params: {} });
        send({ id: 2, method, params });
      } else finish(null, response.result);
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'prune', version: '1.0.0' }, capabilities: { experimentalApi: true } } });
  });
}

async function normalize(raw) {
  check(raw && typeof raw === 'object', '缺少插件控制描述符');
  check(['claude-code', 'codex'].includes(raw.host), '当前宿主尚无已验证的插件启停接口');
  check(typeof raw.pluginId === 'string' && qualifiedId.test(raw.pluginId), '插件必须使用准确的 name@marketplace ID');
  check((raw.host === 'codex' ? ['user', 'project'] : ['user', 'project', 'local']).includes(raw.scope), '必须明确支持的插件配置作用域');
  let projectRoot;
  if (raw.projectRoot != null) {
    check(typeof raw.projectRoot === 'string' && path.isAbsolute(raw.projectRoot), 'projectRoot 必须是绝对目录');
    projectRoot = await fs.realpath(raw.projectRoot);
    check((await fs.stat(projectRoot)).isDirectory(), 'projectRoot 不是目录');
  }
  check(raw.scope === 'user' || projectRoot, '项目和本地作用域需要明确 projectRoot');
  // User scope is global. A project override must not make a global action
  // appear satisfied while the user-level setting is unchanged.
  return { host: raw.host, pluginId: raw.pluginId, scope: raw.scope, ...(raw.scope !== 'user' && projectRoot ? { projectRoot } : {}) };
}

function state(control, values) {
  const data = { ...control, enabled: null, configured: 'unknown', loaded: 'unknown', reloadRequired: null, installed: null, ...values };
  // Unrelated settings can change between selected plugin operations. The
  // target fingerprint detects semantic drift; the fresh layer version is
  // still passed to the host's compare-and-swap write below.
  data.fingerprint = hash({ control, enabled: data.enabled, installed: data.installed, version: data.version, installPath: data.installPath, configPath: data.configPath, explicitEnabled: data.explicitEnabled, manifestHash: data.manifestHash });
  return data;
}

async function claudeState(control, dependencies) {
  const result = await (dependencies.run || run)('claude', ['plugin', 'list', '--json'], { cwd: control.projectRoot || os.homedir() });
  const rows = JSON.parse(typeof result === 'string' ? result : result.stdout);
  check(Array.isArray(rows), 'Claude 插件列表格式不受支持');
  const matches = rows.filter(row => row.id === control.pluginId && row.scope === control.scope);
  if (matches.length !== 1) return state(control, { installed: matches.length ? null : false, blocked: matches.length ? '插件 ID 和作用域不唯一，不能执行' : '宿主未在指定作用域列出该插件' });
  const row = matches[0];
  check(typeof row.enabled === 'boolean', 'Claude 未返回明确的 enabled 状态');
  let manifestHash = null, dependenciesPresent = false, manifestError = null;
  if (typeof row.installPath === 'string' && path.isAbsolute(row.installPath)) {
    try {
      const text = await fs.readFile(path.join(row.installPath, '.claude-plugin', 'plugin.json'), 'utf8')
        .catch(error => { if (error.code !== 'ENOENT') throw error; return fs.readFile(path.join(row.installPath, 'plugin.json'), 'utf8'); });
      const manifest = JSON.parse(text);
      manifestHash = hash(text);
      dependenciesPresent = Array.isArray(manifest.dependencies) ? manifest.dependencies.length > 0 : manifest.dependencies != null;
    } catch { manifestError = '插件清单不可读或缺失，无法确认依赖影响'; }
  } else manifestError = '宿主未返回插件安装目录，无法确认依赖影响';
  return state(control, { enabled: row.enabled, configured: row.enabled ? 'enabled' : 'disabled', installed: true, version: row.version || null, installPath: row.installPath || null, manifestHash, dependenciesPresent, enableBlocked: manifestError || (dependenciesPresent ? '该插件声明依赖，启用可能连带修改其他插件；请在原宿主审阅依赖后启用' : null), blocked: row.errors?.length ? '宿主报告插件加载错误，请先在原宿主解决' : null });
}

async function codexState(control, dependencies) {
  if (control.scope !== 'user') return state(control, { blocked: '本机 Codex 正式配置写入接口仅允许用户配置；项目作用域请在原宿主管理' });
  const request = dependencies.rpc || codexRequest;
  const options = { cwd: control.projectRoot || os.homedir() };
  const listing = await request('plugin/installed', { cwds: control.projectRoot ? [control.projectRoot] : null }, options);
  const matches = (listing.marketplaces || []).flatMap(marketplace => (marketplace.plugins || []).filter(plugin => plugin.id === control.pluginId).map(plugin => ({ marketplace, plugin })));
  if (matches.length !== 1) return state(control, { installed: matches.length ? null : false, blocked: '宿主无法唯一确认该插件的安装记录' });
  const { marketplace, plugin } = matches[0];
  const common = { installed: plugin.installed === true, version: plugin.localVersion || plugin.version || null, enabled: typeof plugin.enabled === 'boolean' ? plugin.enabled : null };
  if (['openai-bundled', 'openai-primary-runtime'].includes(marketplace.name)) return state(control, { ...common, blocked: '平台固定插件不属于可修剪对象' });
  // Remote/workspace plugins have different ownership and control semantics.
  if (!marketplace.path || !['local', 'git', 'npm'].includes(plugin.source?.type)) return state(control, { ...common, blocked: '远端或工作区管理插件不适用本地配置启停；请在 Codex 插件管理页操作' });
  if (!plugin.installed || plugin.disabledReason || plugin.availability === 'DISABLED_BY_ADMIN') return state(control, { ...common, blocked: '插件未安装或被宿主策略限制，不能修改启停状态' });
  const config = await request('config/read', { includeLayers: true, cwd: control.projectRoot || null }, options);
  const layers = (config.layers || []).filter(layer => control.scope === 'user'
    ? layer.name?.type === 'user' && !layer.name.profile
    : layer.name?.type === 'project' && path.resolve(layer.name.dotCodexFolder) === path.join(control.projectRoot, '.codex'));
  check(layers.length === 1, '无法唯一定位目标配置层；请在原宿主创建并信任该项目配置');
  const layer = layers[0];
  check(!layer.disabledReason, `配置层未加载：${layer.disabledReason}`);
  const configPath = layer.name.type === 'user' ? layer.name.file : path.join(layer.name.dotCodexFolder, 'config.toml');
  check(typeof configPath === 'string' && path.isAbsolute(configPath) && typeof layer.version === 'string', '宿主未返回可校验的配置文件及版本');
  const explicit = layer.config?.plugins?.[control.pluginId]?.enabled;
  const effective = config.config?.plugins?.[control.pluginId]?.enabled;
  const enabled = typeof effective === 'boolean' ? effective : common.enabled;
  const origin = config.origins?.[`plugins.${control.pluginId}.enabled`]?.name;
  const blocked = origin && (!['user', 'packagedDefaults'].includes(origin.type) || (origin.type === 'user' && origin.profile))
    ? '插件启停由更高优先级或管理员配置控制；不能通过用户配置修改' : null;
  return state(control, { ...common, enabled, configured: enabled === true ? 'enabled' : enabled === false ? 'disabled' : 'unknown', explicitEnabled: typeof explicit === 'boolean' ? explicit : null, configPath, configVersion: layer.version, installPath: plugin.source.path || marketplace.path, blocked });
}

export async function readPluginState(raw, dependencies = {}) {
  let control;
  try {
    control = await normalize(raw);
    return await (control.host === 'claude-code' ? claudeState(control, dependencies) : codexState(control, dependencies));
  } catch (error) {
    return state(control || { host: raw?.host, pluginId: raw?.pluginId, scope: raw?.scope }, { blocked: error.message });
  }
}

export async function preparePluginControl(raw, dependencies = {}) {
  const control = await normalize(raw);
  const before = await readPluginState(control, dependencies);
  if (typeof raw.desiredEnabled === 'boolean' && raw.desiredEnabled !== before.enabled && before.enableBlocked) before.blocked ||= `${before.enableBlocked}；工作台无法保证安全恢复，暂不执行启停`;
  return { control, before };
}

export async function setPluginEnabled(raw, desired, expected, dependencies = {}) {
  let hostMutationAttempted = false;
  try {
  check(typeof desired === 'boolean', '目标 enabled 必须为布尔值');
  const control = await normalize(raw);
  const before = await readPluginState(control, dependencies);
  check(!before.blocked, before.blocked);
  check(expected?.fingerprint && before.fingerprint === expected.fingerprint, '插件配置或版本已变化，请重新审阅后执行');
  if (before.enabled === desired) return { ...before, changed: false };
  if (control.host === 'claude-code') {
    check(!before.enableBlocked, `${before.enableBlocked}；工作台无法保证安全恢复，暂不执行启停`);
    hostMutationAttempted = true;
    await (dependencies.run || run)('claude', ['plugin', desired ? 'enable' : 'disable', control.pluginId, '--scope', control.scope], { cwd: control.projectRoot || os.homedir() });
  } else {
    hostMutationAttempted = true;
    const written = await (dependencies.rpc || codexRequest)('config/value/write', { keyPath: `plugins.${JSON.stringify(control.pluginId)}.enabled`, value: desired, mergeStrategy: 'replace', filePath: before.configPath, expectedVersion: before.configVersion }, { cwd: control.projectRoot || os.homedir() });
    check(written?.status === 'ok', '配置写入被更高优先级规则覆盖，不能确认目标状态生效');
  }
  const after = await readPluginState(control, dependencies);
  check(!after.blocked && after.enabled === desired, `宿主命令已返回，但读回未确认目标状态${after.blocked ? `：${after.blocked}` : ''}；请刷新核查，勿重复执行`);
  return { ...after, changed: true, reloadRequired: true, loaded: 'unknown' };
  } catch (error) {
    error.hostMutationAttempted = hostMutationAttempted;
    throw error;
  }
}

import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { preparePluginControl, readPluginState, setPluginEnabled } from './plugin-host.mjs';

export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const exists = async p => !!(await fs.lstat(p).catch(e => { if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e; return null; }));
export const inside = (root, file) => { const r = path.relative(path.resolve(root), path.resolve(file)); return r === '' || (!r.startsWith(`..${path.sep}`) && r !== '..' && !path.isAbsolute(r)); };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
export async function writeJSON(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  const handle = await fs.open(tmp, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2)); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(tmp, file);
}
export const readJSON = async file => JSON.parse(await fs.readFile(file, 'utf8'));
async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function physicalPath(file) {
  const full = path.resolve(file);
  if (await exists(full)) return fs.realpath(full);
  const parent = path.dirname(full);
  assert(parent !== full, `无法解析路径：${file}`);
  return path.join(await physicalPath(parent), path.basename(full));
}
export async function protectedSource(file) {
  const physical = await physicalPath(file);
  for (const p of [path.resolve(file), physical]) {
    const normalized = p.replaceAll('\\', '/').toLowerCase();
    if (/\/(?:\.system|plugins|openai-bundled|openai-primary-runtime)(?:\/|$)/.test(normalized)) return '插件或平台管理的资源只能提供建议';
    let current = p;
    while (path.dirname(current) !== current) {
      if (await exists(path.join(current, '.codex-plugin', 'plugin.json')) || await exists(path.join(current, '.claude-plugin', 'plugin.json'))) return '实际来源属于插件，只能提供建议';
      current = path.dirname(current);
    }
  }
  return null;
}
// The root may be a user-owned junction. Nested links need a separate reviewed
// resource boundary; silently dereferencing them would change other packages.
export async function fingerprint(folder) {
  if (!(await exists(folder))) return null;
  const stat = await fs.lstat(folder);
  const link = stat.isSymbolicLink() ? await fs.readlink(folder) : null;
  const real = await fs.realpath(folder);
  assert((await fs.stat(real)).isDirectory(), `不是技能目录：${folder}`);
  const entries = [];
  async function walk(dir, relative = '') {
    for (const name of (await fs.readdir(dir)).sort()) {
      const file = path.join(dir, name), rel = relative ? `${relative}/${name}` : name;
      const st = await fs.lstat(file);
      assert(!st.isSymbolicLink(), `嵌套链接需要单独审阅，未执行：${file}`);
      if (st.isDirectory()) { entries.push({ path: rel, type: 'dir', mode: st.mode & 0o777 }); await walk(file, rel); }
      else { assert(st.isFile(), `不支持的资源类型：${file}`); entries.push({ path: rel, type: 'file', mode: st.mode & 0o777, bytes: st.size, hash: await hashFile(file) }); }
    }
  }
  await walk(real);
  return { hash: digest(entries), realPath: real, link, entries };
}
// Standalone rules have their own boundary; they never masquerade as a skill package.
export async function fingerprintFile(file) {
  if (!(await exists(file))) return null;
  const st = await fs.lstat(file);
  assert(st.isFile() && !st.isSymbolicLink() && st.nlink === 1, `规则必须为独立普通文件，不能是链接：${file}`);
  const entries = [{ path: '.', type: 'file', mode: st.mode & 0o777, bytes: st.size, hash: await hashFile(file) }];
  return { hash: digest(entries), realPath: await fs.realpath(file), link: null, entries };
}
const changeFingerprint = (change, file) => change.type === 'file' ? fingerprintFile(file) : fingerprint(file);
function sameSource(a, b) { return a === null ? b === null : !!b && a.hash === b.hash && a.realPath === b.realPath && a.link === b.link; }
function sameContent(a, b) { return a === null ? b === null : !!b && a.hash === b.hash; }
// Copies must remain ordinary objects at their frozen physical location.
function sameCopy(a, b, location) { return sameContent(a, b) && (!b || (b.link === null && b.realPath === location)); }
function changedFiles(a, b) {
  const before = new Map((a?.entries || []).map(f => [f.path, JSON.stringify(f)]));
  const after = new Map((b?.entries || []).map(f => [f.path, JSON.stringify(f)]));
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter(p => before.get(p) !== after.get(p));
  return changed.length ? changed.slice(0, 8).join('、') + (changed.length > 8 ? ` 等 ${changed.length} 项` : '') : '目录或链接目标';
}
async function copyPackage(from, to) {
  assert(!(await exists(to)), `目标已存在：${to}`);
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.cp(await fs.realpath(from), to, { recursive: true, preserveTimestamps: true, errorOnExist: true, force: false });
}
async function move(from, to) {
  assert(!(await exists(to)), `归档目标已存在：${to}`);
  await fs.mkdir(path.dirname(to), { recursive: true });
  // A cross-device archive must be chosen on the source volume for v1. Never
  // substitute a non-atomic copy/delete for the recoverable rename journal.
  await fs.rename(from, to).catch(e => { if (e.code === 'EXDEV') throw new Error('归档与技能不在同一文件系统，请在技能所在磁盘准备工作目录后重新审阅。'); throw e; });
}
export async function validatePackage(folder) {
  const files = await fingerprint(folder);
  assert(files && !files.link, '候选必须是独立普通目录');
  const entry = path.join(folder, 'SKILL.md');
  const text = await fs.readFile(entry, 'utf8');
  const header = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
  assert(header && /^name:\s*\S/m.test(header) && /^description:\s*\S/m.test(header), '候选 SKILL.md 必须包含 name 和 description');
  for (const file of files.entries.filter(x => x.type === 'file' && /\.md$/i.test(x.path))) {
    const content = (await fs.readFile(path.join(folder, file.path), 'utf8'))
      .replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, '')
      .replace(/(`+)[\s\S]*?\1/g, '');
    for (const match of content.matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
      let url = match[1].trim().replace(/^<|>$/g, '').split(/\s+["']/)[0];
      if (/^(?:[a-z][a-z\d+.-]*:|#|\/)/i.test(url)) continue;
      url = decodeURIComponent(url.split('#')[0]);
      if (!url) continue;
      const target = path.resolve(folder, path.dirname(file.path), url);
      assert(inside(folder, target) && await exists(target), `候选引用缺失或越界：${file.path} → ${url}`);
    }
  }
  return files;
}
const safeId = id => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id);
export const recommendation = item => ({ merge: 'modify', split: 'modify', review: 'undetermined', unreviewed: 'undetermined' }[item.action] || item.action);
const mutable = item => item.kind === 'skill' && ['modify', 'disable', 'merge', 'split'].includes(item.action) && ['user', 'project'].includes(item.scope);
const decidable = item => !['platform', 'system'].includes(item.scope) && recommendation(item) !== 'undetermined' && (!item.blocked || item.kind === 'plugin' || recommendation(item) === 'keep');
const executionMode = item => recommendation(item) === 'keep' ? 'none' : recommendation(item) === 'undetermined' ? 'unavailable' : item.kind === 'plugin' ? 'host' : (mutable(item) || (item.kind === 'instruction' && item.revisionDraft?.writable)) && item.changes.length && !item.blocked ? 'workbench' : 'unavailable';
const executable = item => executionMode(item) === 'workbench' || (executionMode(item) === 'host' && !!item.pluginControl && !item.blocked);
const reviewStatus = item => item.action === 'unreviewed' ? 'pending' : recommendation(item) === 'undetermined' ? 'needs-info' : 'reviewed';
function executionNote(item) {
  if (reviewStatus(item) === 'pending') return '内容审读尚未完成；由评审者继续核查后给出建议。';
  if (reviewStatus(item) === 'needs-info') return item.nextStep || '请评审者说明影响取舍的具体缺口及最小核查，补充后重新准备方案。';
  if (executionMode(item) === 'none') return '建议保留；采纳只记录决定，不涉及文件变更。';
  if (item.kind === 'plugin') return item.pluginControl && !item.blocked ? '通过原宿主正式接口变更整个插件的启用配置，并读回验证；当前会话加载状态未知，需重新加载宿主。' : item.blocked || item.plugin.instructions || '在原宿主管理完整插件；工作台只保存决定。';
  if (item.kind === 'instruction' && !item.blocked) return item.revisionDraft?.writable ? '规则原件与修订稿已冻结；应用后写入独立文件，可从历史恢复。磁盘核验不代表当前会话已加载。' : item.revisionDraft ? '旧方案仅冻结了规则对照稿，尚无写入授权；需准备可写新版本，再由用户选择应用。' : '规则文件尚无执行稿；需准备独立文件修订方案。';
  if (item.blocked) return `${item.blocked}。${item.nextStep || '解决该问题后重新准备方案。'}`;
  if (executionMode(item) === 'workbench') return '完整变更已冻结；选择并应用后写入文件，原件可从历史恢复。';
  return item.nextStep || '尚未准备完整修改稿或停用计划；由评审者准备新方案后审阅应用。';
}

export async function prepare(input, runDir, options = {}) {
  runDir = path.resolve(runDir);
  assert(input.schemaVersion === 1 && Array.isArray(input.items) && input.items.length, '需要 schemaVersion:1 和非空 items');
  assert(Array.isArray(input.discoveryRoots) && input.discoveryRoots.length, '必须声明技能发现目录 discoveryRoots');
  assert(input.profile?.model && input.profile?.tasks?.length, '需要目标模型及用户主要任务');
  const roots = await Promise.all(input.discoveryRoots.map(async r => { assert(path.isAbsolute(r), '发现目录必须是绝对路径'); return { path: path.resolve(r), physical: await physicalPath(r) }; }));
  const runPhysical = await physicalPath(runDir);
  for (const root of roots) assert(!inside(root.physical, runPhysical) && !inside(runPhysical, root.physical), '工作目录必须位于技能发现目录之外，且不能包围发现目录');
  assert(!(await exists(runDir)), '请使用新的工作目录；不能覆盖已有方案或备份');
  const ids = new Set(), pluginIds = new Set(), writePaths = [];
  assert(input.intent === undefined || ['review', 'revise'].includes(input.intent), 'intent 必须为 review 或 revise');
  const plan = { schemaVersion: 1, intent: input.intent || 'review', runPhysical, title: input.title || '你的技能审阅', createdAt: new Date().toISOString(), profile: input.profile, discoveryRoots: roots, coverage: input.coverage || [], items: [] };
  await fs.mkdir(runDir, { recursive: true });
  for (const raw of input.items) {
    assert(safeId(raw.id) && !ids.has(raw.id), '项目 ID 缺失、重复或格式不正确'); ids.add(raw.id);
    assert(['keep', 'modify', 'disable', 'merge', 'split', 'review', 'unreviewed', 'undetermined'].includes(raw.action), `无效动作：${raw.id}`);
    assert(raw.changes === undefined || Array.isArray(raw.changes), `changes 必须是数组：${raw.id}`);
    const item = { id: raw.id, name: String(raw.name || raw.id), group: String(raw.group || '其他能力'), action: raw.action, scope: raw.scope || 'unknown', summary: raw.summary || '', rationale: raw.rationale || '', preserves: raw.preserves || [], removes: raw.removes || [], evidence: raw.evidence || [], validation: raw.validation || [], tags: raw.tags || [], warnings: raw.warnings || [], sources: raw.sources || [], changes: [], blocked: null };
    item.sourceFingerprints = raw.sourceFingerprints || [];
    item.nextStep = String(raw.nextStep || '');
    assert(raw.priorDecision === undefined || ['approved', 'deferred', 'none'].includes(raw.priorDecision), 'priorDecision 只能记录旧建议决定');
    item.priorDecision = raw.priorDecision || null;
    item.kind = raw.kind || (item.scope === 'plugin' ? 'plugin' : 'skill');
    assert(['skill', 'plugin', 'instruction'].includes(item.kind), '对象类型必须为 skill、plugin 或 instruction');
    if (item.kind === 'instruction') {
      assert(['user', 'project'].includes(item.scope), '规则文件必须注明 user 或 project 来源');
      assert(!raw.changes?.length, '规则文件不能作为技能包应用；请使用 revisionDraft');
    }
    if (raw.revisionDraft) {
      assert(item.kind === 'instruction', 'revisionDraft 仅用于规则文本预览');
      const { source, path: draft } = raw.revisionDraft;
      assert(typeof source === 'string' && typeof draft === 'string' && path.isAbsolute(source) && path.isAbsolute(draft), '修订预览路径必须绝对化');
      assert(item.sources.includes(source) && /\.(md|txt)$/i.test(source) && /\.(md|txt)$/i.test(draft), '修订预览必须来自已声明的 Markdown 或文本规则');
      const physical = await physicalPath(draft);
      assert(!roots.some(root => inside(root.physical, physical)), '规则修订稿必须在技能发现范围外');
      assert(await physicalPath(source) !== physical, '修订稿不能是规则原件');
      const preview = { source, before: `previews/${item.id}/before.txt`, after: `previews/${item.id}/after.txt` };
      for (const [side, from] of [['before', source], ['after', draft]]) {
        const stat = await fs.stat(from); assert(stat.isFile(), '修订预览必须为文件');
        const hash = await hashFile(from), to = path.join(runDir, preview[side]);
        await fs.mkdir(path.dirname(to), { recursive: true }); await fs.copyFile(from, to);
        assert(hash === await hashFile(to) && hash === await hashFile(from), '冻结规则修订稿期间内容发生变化');
        preview[side + 'Hash'] = hash; preview[side + 'Bytes'] = stat.size;
      }
      item.revisionDraft = preview;
      if (raw.revisionDraft.writable === true) {
        assert(item.action === 'modify' && item.rationale, '规则写入需要 modify 和具体理由');
        const target = path.resolve(source), parent = await physicalPath(path.dirname(target));
        assert(!inside(runPhysical, await physicalPath(target)), '规则原件不能位于工作记录目录');
        assert(!(await protectedSource(target)), '不能改写插件或平台规则');
        const original = await fingerprintFile(target);
        for (const used of writePaths) assert(!inside(used, original.realPath) && !inside(original.realPath, used), '规则与其他写入目标重叠');
        writePaths.push(original.realPath);
        const snapshot = preview.before, candidate = preview.after;
        await fs.chmod(path.join(runDir, snapshot), original.entries[0].mode);
        await fs.chmod(path.join(runDir, candidate), original.entries[0].mode);
        assert(sameContent(original, await fingerprintFile(path.join(runDir, snapshot))) && sameSource(original, await fingerprintFile(target)), '冻结期间规则原件变化');
        item.changes.push({ type: 'file', path: target, parent, original, snapshot, candidate, expected: await fingerprintFile(path.join(runDir, candidate)) });
        preview.writable = true;
      }
    }
    if (item.kind === 'plugin') {
      assert(item.scope === 'plugin' && raw.plugin?.id && !pluginIds.has(raw.plugin.id), '整包插件必须有唯一 plugin.id 和 plugin 来源');
      assert(!raw.changes?.length, '插件按整包提供宿主管理建议，不能单独写入内部技能或缓存');
      pluginIds.add(raw.plugin.id);
      item.plugin = raw.plugin;
    }
    item.recommendation = recommendation(item);
    if (!['user', 'project'].includes(item.scope)) item.blocked = item.scope === 'platform' ? '平台固定背景，不能通过本工作台修改' : '此来源仅提供建议，不能应用';
    else if (item.action === 'unreviewed') item.blocked = '尚未开展内容评审，不能采纳或执行';
    else if (!mutable(item) && item.kind !== 'instruction' && item.action !== 'keep') item.blocked = '需要补充影响决定的信息';
    if (item.kind === 'plugin' && raw.plugin.control) {
      assert(['modify', 'disable'].includes(item.action), '插件启停必须提供明确修改或停用建议');
      assert(typeof raw.plugin.control.desiredEnabled === 'boolean', '插件必须明确 desiredEnabled');
      assert(item.action !== 'disable' || raw.plugin.control.desiredEnabled === false, '停用建议不能启用插件');
      assert(raw.plugin.control.pluginId === raw.plugin.id, '宿主控制的插件 ID 与评审对象不一致');
      try {
        const frozen = await preparePluginControl(raw.plugin.control, options.pluginHost);
        item.pluginControl = { ...frozen, desiredEnabled: raw.plugin.control.desiredEnabled };
        item.blocked = frozen.before?.blocked || null;
      } catch (e) { item.blocked = `宿主启停不可用：${e.message}`; }
    }
    assert(!mutable(item) || !raw.changes?.length || item.rationale, `可执行项目需要具体理由和 changes：${item.id}`);
    for (const [index, change] of (raw.changes || []).entries()) {
      assert(path.isAbsolute(change.path), '变更路径必须是绝对路径');
      const target = path.resolve(change.path), parent = await physicalPath(path.dirname(target));
      assert(roots.some(r => inside(r.physical, parent) && target !== r.path), `变更目标不在声明的发现目录：${target}`);
      const writePhysical = await physicalPath(target);
      for (const used of writePaths) assert(!inside(used, writePhysical) && !inside(writePhysical, used), `不同变更不可重复或相互包含：${target}`);
      writePaths.push(writePhysical);
      const blocked = await protectedSource(target);
      if (blocked) item.blocked = blocked;
      let original;
      try { original = await fingerprint(target); } catch (e) { item.blocked = e.message; original = null; }
      const record = { path: target, parent, original, snapshot: null, candidate: null, expected: null };
      if (original) {
        assert(await exists(path.join(target, 'SKILL.md')), `源目录不是 skill：${target}`);
        record.snapshot = `originals/${item.id}/${index}`;
        await copyPackage(target, path.join(runDir, record.snapshot));
        assert(sameContent(original, await fingerprint(path.join(runDir, record.snapshot))), '备份期间源文件发生变化');
        assert(sameSource(original, await fingerprint(target)), '备份期间源路径发生变化');
      }
      if (change.candidate) {
        assert(path.isAbsolute(change.candidate), '候选目录必须是绝对路径');
        const candidatePhysical = await physicalPath(change.candidate);
        assert(!roots.some(r => inside(r.physical, candidatePhysical)), '候选必须在技能发现目录之外');
        record.candidate = `candidates/${item.id}/${index}`;
        await validatePackage(change.candidate);
        await copyPackage(change.candidate, path.join(runDir, record.candidate));
        record.expected = await validatePackage(path.join(runDir, record.candidate));
      }
      assert(original || record.candidate || item.blocked, '变更既没有原件也没有候选');
      if (item.action === 'disable') assert(original && !record.candidate, '停用必须只有原件，没有候选');
      if (item.action === 'modify') assert(original && record.candidate, '修改必须有原件和候选');
      item.changes.push(record);
    }
    plan.items.push(item);
  }
  const pendingReview = plan.items.filter(item => reviewStatus(item) === 'pending').length;
  const missingCandidates = plan.intent === 'revise' ? plan.items.filter(item =>
    (item.kind === 'skill' && !['platform', 'system'].includes(item.scope) && ['modify', 'disable', 'merge', 'split'].includes(item.action) && executionMode(item) !== 'workbench') ||
    (item.kind === 'instruction' && recommendation(item) === 'modify' && !executable(item)) ||
    (item.kind === 'plugin' && ['modify', 'disable'].includes(recommendation(item)) && !executable(item))).length : 0;
  plan.completion = { status: pendingReview || missingCandidates ? 'partial' : 'complete', pendingReview, missingCandidates };
  plan.fingerprint = digest(plan);
  await writeJSON(path.join(runDir, 'plan.json'), plan);
  await writeJSON(path.join(runDir, 'state.json'), { version: 1, selection: {}, jobs: [] });
  return plan;
}

export class Workbench {
  constructor(runDir, options = {}) { this.runDir = path.resolve(runDir); this.busy = false; this.lockRoot = options.lockRoot || path.join(os.homedir(), '.prune'); this.pluginHost = options.pluginHost; this.observations = {}; }
  async open() {
    this.plan = await readJSON(path.join(this.runDir, 'plan.json'));
    const { fingerprint: hash, ...body } = this.plan;
    assert(hash === digest(body), '方案文件已变化，请重新准备审阅版本');
    await this.checkRunBoundary();
    this.state = await readJSON(path.join(this.runDir, 'state.json'));
    // A process interruption never silently retries an apply. Recovery uses the
    // same journal and can only return paths to their reviewed original state.
    for (const job of this.state.jobs) if (job.status === 'running') { job.status = 'interrupted'; job.error = '服务在执行中停止；请从历史记录恢复未完成项后重新评审。'; }
    await this.save();
    return this;
  }
  async save() { await writeJSON(path.join(this.runDir, 'state.json'), this.state); }
  async storagePath(relative) {
    const full = path.resolve(this.runDir, relative);
    assert(inside(this.runDir, full), '记录路径越界');
    const expectedParent = path.resolve(this.plan.runPhysical, path.dirname(relative));
    assert(await physicalPath(path.dirname(full)) === expectedParent, '归档内部路径的链接目标已变化');
    return full;
  }
  async checkRunBoundary() {
    const current = await physicalPath(this.runDir);
    assert(current === this.plan.runPhysical, '工作记录目录的真实路径已变化，请还原目录位置后重开');
    for (const root of this.plan.discoveryRoots) {
      const physical = await physicalPath(root.path);
      assert(physical === root.physical, '技能发现目录的链接目标已变化');
      assert(!inside(physical, current) && !inside(current, physical), '工作记录必须位于技能发现范围之外');
    }
  }
  item(id) { const item = this.plan.items.find(x => x.id === id); assert(item, '不存在的项目'); return item; }
  current(id) {
    for (const job of [...this.state.jobs].reverse()) {
      if (job.kind !== 'apply') continue;
      const item = job.items.find(x => x.id === id);
      if (item && ['applied', 'running', 'recovery-conflict'].includes(item.status)) return { job, item };
    }
    return null;
  }
  pluginBaseline(item) {
    const previous = [...this.state.jobs].reverse().filter(job => job.kind === 'apply').flatMap(job => job.items).find(entry => entry.id === item.id && entry.status === 'restored');
    return previous?.hostRestored || item.pluginControl.before;
  }
  async refreshObservations(force = false) {
    if (this.busy || (!force && Date.now() - (this.observedAt || 0) < 5000)) return this.view();
    if (this.observing) return this.observing;
    this.observing = (async () => {
      for (const item of this.plan.items) {
        const current = this.current(item.id);
        if (!executable(item) && !item.revisionDraft) continue;
        const checkedAt = new Date().toISOString();
        try {
          if (!executable(item) && item.revisionDraft) {
            const hash = await hashFile(item.revisionDraft.source);
            const original = hash === item.revisionDraft.beforeHash, draft = hash === item.revisionDraft.afterHash;
            this.observations[item.id] = { status: original ? 'not-applied' : draft ? 'verified' : 'drifted', detail: original ? '原文件仍与冻结原件一致，规则稿尚未写入。' : draft ? '当前文件与修订稿一致，但本方案没有写入记录，不能归因于本工作台。' : '当前规则与冻结原件和修订稿均不同，需重新审阅。', checkedAt, loaded: 'unknown' };
          } else if (item.pluginControl) {
            const state = await readPluginState(item.pluginControl.control, this.pluginHost);
            const expected = current?.item.hostAfter || this.pluginBaseline(item);
            this.observations[item.id] = { status: state.enabled === null || state.blocked ? 'unknown' : state.fingerprint === expected.fingerprint ? 'verified' : 'drifted', detail: state.blocked || `宿主配置：${state.enabled === true ? '已启用' : state.enabled === false ? '已停用' : '未知'}；当前会话加载状态未知，请重新加载宿主。`, checkedAt, loaded: 'unknown', hostState: state };
          } else if (current?.item.status === 'applied') {
            let matches = true;
            for (const change of item.changes) {
              if (await physicalPath(path.dirname(change.path)) !== change.parent || !sameCopy(change.expected, await changeFingerprint(change, change.path), path.join(change.parent, path.basename(change.path)))) matches = false;
            }
            this.observations[item.id] = { status: matches ? 'verified' : 'drifted', detail: matches ? '磁盘内容与已应用方案一致；当前会话是否加载未验证。' : '磁盘内容或路径已变化，与已应用方案不一致。', checkedAt, loaded: 'unknown' };
          } else if (!current) {
            let matches = true;
            for (const change of item.changes) if (!sameSource(change.original, await changeFingerprint(change, change.path))) matches = false;
            this.observations[item.id] = { status: matches ? 'not-applied' : 'drifted', detail: matches ? '原件状态已核对；本方案尚未应用或已恢复。' : '原件已发生变化，应用前需要重新审阅。', checkedAt, loaded: 'unknown' };
          } else this.observations[item.id] = { status: 'unknown', detail: '操作未完成，请检查历史记录。', checkedAt, loaded: 'unknown' };
        } catch (e) { this.observations[item.id] = { status: 'unknown', detail: `无法核验当前状态：${e.message}`, checkedAt, loaded: 'unknown' }; }
      }
      this.observedAt = Date.now();
      return this.view();
    })().finally(() => { this.observing = null; });
    return this.observing;
  }
  view() {
    return { plan: this.plan, selection: this.state.selection, jobs: this.state.jobs, busy: this.busy, items: this.plan.items.map(item => {
      const latest = [...this.state.jobs].reverse().find(job => job.items.some(record => record.id === item.id));
      const record = latest?.items.find(record => record.id === item.id);
      const current = this.current(item.id), mode = executionMode(item);
      const executionState = !executable(item) ? null : current?.item.status === 'recovery-conflict' || (current && latest?.kind === 'restore' && record?.status === 'conflict') || (current?.item.status === 'running' && !this.busy) ? 'problem' : current?.item.status || 'ready';
      return { ...item, executable: executable(item), effectiveState: this.observations[item.id] || { status: 'unknown', detail: '尚未核验当前磁盘或宿主状态', loaded: 'unknown' }, reviewStatus: reviewStatus(item), executionNote: executionNote(item), recommendation: recommendation(item), decisionAllowed: decidable(item), executionMode: mode, executionState, state: current?.item.status || 'ready', lastOutcome: record ? { status: record.status, kind: latest.kind, operationId: latest.id, error: record.error || null } : null };
    }) };
  }
  async select(hash, decisions) {
    assert(hash === this.plan.fingerprint, '方案版本已更新，请刷新'); assert(!this.busy, '执行中不能修改选择');
    for (const [id, choice] of Object.entries(decisions)) {
      const item = this.item(id); assert(['approved', 'deferred', 'none'].includes(choice), '无效选择');
      assert(choice !== 'approved' || (decidable(item) && !this.current(id)), '此项不可批准：尚无可采纳的结论、来源受保护或已有未恢复操作');
      assert(!this.current(id), '已有未恢复操作，不能修改本次决定');
    }
    Object.assign(this.state.selection, decisions); await this.save(); return this.view();
  }
  async previewText(relative, expectedHash, expectedBytes) {
    const full = await this.storagePath(relative);
    assert(await physicalPath(full) === path.resolve(this.plan.runPhysical, relative), '文件预览路径被重定向');
    const handle = await fs.open(full, 'r'), hash = createHash('sha256'), chunks = [];
    let bytes = 0;
    try {
      // Hash the very stream used for display, retaining only the preview prefix.
      for await (const chunk of handle.createReadStream({ autoClose: false })) {
        hash.update(chunk);
        if (bytes < 200_000) chunks.push(chunk.subarray(0, 200_000 - bytes));
        bytes += chunk.length;
      }
    } finally { await handle.close(); }
    assert(bytes === expectedBytes && hash.digest('hex') === expectedHash, '冻结的文件预览已变化，请重新准备');
    return Buffer.concat(chunks).toString('utf8');
  }
  async details(id) {
    const item = this.item(id), files = [];
    if (item.revisionDraft) {
      const draft = item.revisionDraft;
      const file = { path: path.basename(draft.source), target: draft.source, index: 0, status: 'modified', binary: false, previewOnly: !draft.writable };
      for (const side of ['before', 'after']) {
        file[side + 'Hash'] = draft[side + 'Hash']; file[side + 'Bytes'] = draft[side + 'Bytes'];
        file[side] = await this.previewText(draft[side], file[side + 'Hash'], file[side + 'Bytes']);
        if (file[side + 'Bytes'] > 200_000) file.truncated = true;
      }
      files.push(file);
    }
    for (const [index, change] of item.changes.entries()) {
      if (change.type === 'file') continue; // revisionDraft already provides the frozen text diff.
      for (const [root, expected] of [[change.snapshot, change.original], [change.candidate, change.expected]]) {
        if (root) assert(sameCopy(expected, await fingerprint(await this.storagePath(root)), path.resolve(this.plan.runPhysical, root)), '冻结的技能预览已变化，请重新准备');
      }
      const before = new Map((change.original?.entries || []).filter(f => f.type === 'file').map(f => [f.path, f]));
      const after = new Map((change.expected?.entries || []).filter(f => f.type === 'file').map(f => [f.path, f]));
      for (const name of [...new Set([...before.keys(), ...after.keys()])].sort()) {
        const b = before.get(name), a = after.get(name); if (a?.hash === b?.hash && a?.mode === b?.mode) continue;
        const file = { path: name, target: change.path, index, status: !b ? 'added' : !a ? 'removed' : 'modified', beforeBytes: b?.bytes || 0, afterBytes: a?.bytes || 0, beforeHash: b?.hash || null, afterHash: a?.hash || null };
        const text = /\.(md|txt|json|ya?ml|toml|js|mjs|cjs|ts|tsx|jsx|py|sh|ps1|css|html|csv|sql|xml|svg)$/i.test(name);
        file.binary = !text;
        for (const [side, entry, root] of [['before', b, change.snapshot], ['after', a, change.candidate]]) {
          if (entry && text) {
            file[side] = await this.previewText(path.join(root, name), entry.hash, entry.bytes);
            if (entry.bytes > 200_000) file.truncated = true;
          } else file[side] = '';
        }
        files.push(file);
      }
    }
    return { item, files };
  }
  async acquire() {
    await fs.mkdir(this.lockRoot, { recursive: true });
    const file = path.join(this.lockRoot, 'mutation.lock');
    try { const h = await fs.open(file, 'wx'); await h.writeFile(JSON.stringify({ pid: process.pid, run: this.runDir })); await h.close(); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const lock = await readJSON(file).catch(() => null); let alive = true;
      if (Number.isInteger(lock?.pid)) { try { process.kill(lock.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; } }
      assert(!alive, '另一个 Prune 文件任务正在执行');
      await fs.unlink(file); return this.acquire();
    }
    return async () => { if ((await readJSON(file)).pid === process.pid) await fs.unlink(file); };
  }
  async start(kind, request) {
    await this.checkRunBoundary();
    assert(request.planFingerprint === this.plan.fingerprint, '方案版本不匹配');
    assert(safeId(request.requestId), '请求标识格式不正确');
    const requestHash = digest({ kind, ids: request.itemIds, operationId: request.operationId || null });
    const prior = this.state.jobs.find(j => j.requestId === request.requestId);
    if (prior) { assert(prior.requestHash === requestHash, '同一请求标识不能用于不同操作'); return prior; }
    assert(!this.busy, '已有任务正在执行');
    assert(Array.isArray(request.itemIds) && request.itemIds.length && new Set(request.itemIds).size === request.itemIds.length, '请选择不同的项目');
    const items = request.itemIds.map(id => this.item(id));
    if (kind === 'apply') for (const item of items) {
      assert(executable(item) && this.state.selection[item.id] === 'approved', '存在未经批准或不可执行的项目');
      assert(!this.current(item.id), '此项已应用或有未恢复操作');
    }
    else {
      assert(kind === 'restore', '未知操作');
      const original = this.state.jobs.find(j => j.id === request.operationId && j.kind === 'apply'); assert(original, '没有对应的应用记录');
      for (const item of items) assert(original.items.some(i => i.id === item.id && ['applied', 'running', 'recovery-conflict'].includes(i.status)), '此项不可恢复');
    }
    this.busy = true;
    if (this.observing) await this.observing;
    this.observations = {}; this.observedAt = 0;
    let release;
    try { release = await this.acquire(); } catch (e) { this.busy = false; throw e; }
    const job = { id: randomUUID(), requestId: request.requestId, requestHash, kind, operationId: request.operationId || null, status: 'running', startedAt: new Date().toISOString(), items: items.map(i => ({ id: i.id, status: 'pending', steps: [] })) };
    this.state.jobs.push(job);
    try { await this.save(); }
    catch (e) {
      // No execution was started. Retain a terminal record even if the failed
      // save reached disk; the same request must not silently replay later.
      job.status = 'interrupted'; job.error = e.message; job.finishedAt = new Date().toISOString();
      try { await this.save(); } catch { /* Keep the in-memory record if storage is still unavailable. */ }
      finally { this.busy = false; await release(); }
      throw e;
    }
    this.pending = this.execute(job).finally(async () => { this.busy = false; await release(); });
    return job;
  }
  async preflight(item, restoring = false) {
    await this.checkRunBoundary();
    for (const change of item.changes) {
      assert(await physicalPath(path.dirname(change.path)) === change.parent, '技能父目录的链接目标已变化');
      assert(!(await protectedSource(change.path)), '来源现在属于插件或平台，已停止');
      if (change.snapshot) assert(sameCopy(change.original, await changeFingerprint(change, await this.storagePath(change.snapshot)), path.resolve(this.plan.runPhysical, change.snapshot)), '原始快照损坏，未执行');
      if (!restoring) {
        const current = await changeFingerprint(change, change.path);
        assert(sameSource(change.original, current), `源内容或路径已变化，请重新审阅：${change.path}；差异：${changedFiles(change.original, current)}`);
        if (change.candidate) assert(sameContent(change.expected, await (change.type === 'file' ? fingerprintFile(await this.storagePath(change.candidate)) : validatePackage(await this.storagePath(change.candidate)))), '候选内容已变化，请重新准备方案');
      }
    }
  }
  async applyItem(item, entry, job) {
    await this.preflight(item);
    if (item.pluginControl) {
      entry.hostBefore = this.pluginBaseline(item);
      const current = await readPluginState(item.pluginControl.control, this.pluginHost);
      assert(!current.blocked && current.fingerprint === entry.hostBefore.fingerprint, current.blocked || '插件配置或版本已变化，请重新审阅后执行');
      entry.hostAttempted = true;
      await this.save();
      try { entry.hostAfter = await setPluginEnabled(item.pluginControl.control, item.pluginControl.desiredEnabled, entry.hostBefore, this.pluginHost); }
      catch (e) { if (e.hostMutationAttempted === false) entry.hostAttempted = false; throw e; }
      await this.save();
      return;
    }
    // Prepare all replacements outside discovery roots before moving any source.
    for (const [index, change] of item.changes.entries()) {
      const step = { index, archive: `operations/${job.id}/${item.id}/${index}/original`, staged: `operations/${job.id}/${item.id}/${index}/replacement`, stage: 'prepared' };
      if (change.candidate) await copyPackage(await this.storagePath(change.candidate), await this.storagePath(step.staged));
      entry.steps.push(step);
    }
    await this.save();
    for (const step of entry.steps) {
      const change = item.changes[step.index];
      assert(sameSource(change.original, await changeFingerprint(change, change.path)), '写入前源文件发生变化');
      step.stage = 'moving'; await this.save();
      if (change.original) await move(change.path, await this.storagePath(step.archive));
      step.stage = 'archived'; await this.save();
      if (change.candidate) await move(await this.storagePath(step.staged), change.path);
      step.stage = 'installed'; await this.save();
      assert(sameCopy(change.expected, await changeFingerprint(change, change.path), path.join(change.parent, path.basename(change.path))), '应用后的文件与批准版本不一致');
    }
  }
  async rollback(item, entry, job, recovery = false) {
    await this.preflight(item, true);
    if (item.pluginControl) {
      if (entry.hostAttempted) {
        const current = await readPluginState(item.pluginControl.control, this.pluginHost);
        if (current.fingerprint !== entry.hostBefore.fingerprint) {
          assert(entry.hostAfter && current.fingerprint === entry.hostAfter.fingerprint, '宿主状态存在后续变化或操作结果未知；停止恢复，请在原宿主核查');
          entry.hostRestored = await setPluginEnabled(item.pluginControl.control, entry.hostBefore.enabled, entry.hostAfter, this.pluginHost);
        } else entry.hostRestored = current;
        if (recovery) this.state.selection[item.id] = 'none';
        await this.save();
      }
      return;
    }
    // Check the complete group before any restore, including merge/split targets.
    for (const step of entry.steps) {
      const change = item.changes[step.index], archived = await exists(await this.storagePath(step.archive));
      const current = await changeFingerprint(change, change.path);
      if (!archived && sameSource(change.original, current)) continue;
      assert(current === null || sameCopy(change.expected, current, path.join(change.parent, path.basename(change.path))), `恢复冲突：${change.path} 存在后续修改；差异：${changedFiles(change.expected, current)}`);
      if (change.original) {
        assert(archived, '原件归档缺失，停止恢复');
        if (change.original.link) {
          assert(await fs.readlink(path.join(this.runDir, step.archive)) === change.original.link, '原链接归档已变化');
          assert(sameCopy(change.original, await fingerprint(change.original.realPath), change.original.realPath), '原链接目标已有更新，停止恢复');
        } else assert(sameCopy(change.original, await changeFingerprint(change, await this.storagePath(step.archive)), path.resolve(this.plan.runPhysical, step.archive)), '归档原件已变化');
      }
    }
    for (const step of [...entry.steps].reverse()) {
      const change = item.changes[step.index], archive = await this.storagePath(step.archive);
      if (!(await exists(archive)) && sameSource(change.original, await changeFingerprint(change, change.path))) continue;
      if (await exists(change.path)) await move(change.path, await this.storagePath(`operations/${job.id}/replaced/${item.id}/${step.index}-${randomUUID()}`));
      if (change.original) await move(archive, change.path);
      step.stage = 'restored'; await this.save();
      assert(sameSource(change.original, await changeFingerprint(change, change.path)), '恢复后原件校验失败');
    }
    if (recovery) this.state.selection[item.id] = 'none';
  }
  async execute(job) {
    try {
      for (const entry of job.items) {
        const item = this.item(entry.id); entry.status = 'running'; await this.save();
        try {
          if (job.kind === 'apply') { await this.applyItem(item, entry, job); entry.status = 'applied'; }
          else {
            const original = this.state.jobs.find(j => j.id === job.operationId).items.find(i => i.id === entry.id);
            await this.rollback(item, original, job, true); original.status = 'restored'; entry.status = 'restored';
          }
        } catch (e) {
          entry.error = e.message;
          if (job.kind === 'apply') this.state.selection[item.id] = 'none';
          if (job.kind === 'apply' && (entry.steps.length || entry.hostAttempted)) {
            try { await this.rollback(item, entry, job); entry.status = 'rolled-back'; }
            catch (rollbackError) { entry.status = 'recovery-conflict'; entry.error += `；${rollbackError.message}`; }
          } else entry.status = job.kind === 'apply' ? 'blocked' : 'conflict';
          job.status = 'failed'; job.error = entry.error; break;
        }
        await this.save();
      }
      if (job.status === 'running') job.status = 'completed';
    } catch (e) { job.status = 'interrupted'; job.error = e.message; }
    finally { job.finishedAt = new Date().toISOString(); this.observedAt = 0; this.observations = {}; await this.save(); }
  }
}

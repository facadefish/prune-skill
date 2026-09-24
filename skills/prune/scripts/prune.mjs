#!/usr/bin/env node
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { Workbench, prepare, readJSON, writeJSON, exists } from './engine.mjs';

export async function serve(runDir, { port = 0, lockRoot, pluginHost } = {}) {
  const leasePath = path.join(runDir, 'server.lock');
  await fs.mkdir(runDir, { recursive: true });
  if (await exists(leasePath)) {
    const old = await readJSON(leasePath).catch(() => null);
    let alive = true;
    if (Number.isInteger(old?.pid)) { try { process.kill(old.pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; } }
    if (alive) throw new Error('此工作台已有服务，请使用原地址；不要并行打开同一记录。');
    await fs.unlink(leasePath);
  }
  const lease = await fs.open(leasePath, 'wx');
  await lease.writeFile(JSON.stringify({ pid: process.pid })); await lease.close();
  let workbench;
  try { workbench = await new Workbench(runDir, { lockRoot, pluginHost }).open(); }
  catch (e) { await fs.unlink(leasePath); throw e; }
  const tokenFile = path.join(runDir, 'session.json');
  const token = (await exists(tokenFile)) ? (await readJSON(tokenFile)).token : randomBytes(32).toString('hex');
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('工作台会话令牌损坏');
  if (!(await exists(tokenFile))) await writeJSON(tokenFile, { token });
  const template = await fs.readFile(fileURLToPath(new URL('../assets/workbench.html', import.meta.url)), 'utf8');
  let base;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    try {
      if (req.headers.host !== new URL(base).host) return json(403, { error: '主机不匹配' });
      const url = new URL(req.url, base);
      if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(template); }
      if (req.method === 'GET' && url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
      if (req.headers.authorization !== `Bearer ${token}`) return json(401, { error: '请使用 Prune 启动时提供的完整工作台链接' });
      if (req.headers.origin && req.headers.origin !== base) return json(403, { error: '请求来源不匹配' });
      if (req.method === 'GET' && url.pathname === '/api/state') return json(200, await workbench.refreshObservations());
      if (req.method === 'GET' && url.pathname.startsWith('/api/items/')) return json(200, await workbench.details(decodeURIComponent(url.pathname.slice(11))));
      if (req.method !== 'POST' || req.headers.origin !== base || !req.headers['content-type']?.startsWith('application/json')) return json(403, { error: '需要来自工作台的 JSON 操作' });
      let body = '', size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 64_000) throw new Error('请求体过大'); body += chunk; }
      const data = JSON.parse(body);
      if (url.pathname === '/api/selection') return json(200, await workbench.select(data.planFingerprint, data.decisions));
      if (url.pathname === '/api/apply') return json(202, await workbench.start('apply', data));
      if (url.pathname === '/api/restore') return json(202, await workbench.start('restore', data));
      return json(404, { error: '不存在的接口' });
    } catch (e) { json(409, { error: e.message }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }).catch(async e => { await fs.unlink(leasePath); throw e; });
  base = `http://127.0.0.1:${server.address().port}`;
  const close = async () => {
    if (workbench.pending) await workbench.pending;
    await new Promise(resolve => server.close(resolve));
    await fs.unlink(leasePath).catch(() => {});
  };
  return { server, workbench, url: `${base}/#${token}`, token, base, close };
}

export async function demo(root, count = 40) {
  if (!Number.isInteger(count) || count < 5 || count > 500) throw new Error('demo 数量范围为 5–500');
  root = path.resolve(root);
  if (await exists(root)) throw new Error('演示目录已存在，请使用新目录');
  const skills = path.join(root, 'skills'), drafts = path.join(root, 'drafts');
  await fs.mkdir(skills, { recursive: true }); await fs.mkdir(drafts, { recursive: true });
  const groups = ['构建与开发', '探索与研究', '文字与叙事', '视觉与创作', '工具与连接', '知识与协作'];
  const names = ['code-review', 'prototype-lab', 'arch-lens', 'doc-lint', 'release-beacon', 'data-cleanse', 'boundary-test', 'design-system', 'deep-research', 'evidence-search', 'note-compactor', 'news-watch', 'paper-parse', 'market-radar', 'style-tuning', 'narrative-craft', 'tech-writing', 'content-edit', 'idea-notes', 'longform-layout'];
  const writeSource = async (dir, name, line) => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} 演示技能，用于指定任务。\n---\n\n# ${name}\n\n保留用户的交付约定。\n${line}\n`);
  };
  const writeCandidate = async (dir, name) => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: 用户明确需要 ${name} 时使用，不扩展到无关任务。\n---\n\n# ${name}\n\n保留用户的交付约定。\n根据本次变更验证相关行为；有新失败时扩大检查。\n`);
  };
  const base = (id, extra) => ({ id, name: id, kind: 'skill', summary: '为真实任务留下恰到好处的能力。', preserves: ['用户明确的交付约定', '适用任务中的专业能力'], validation: [{ name: '演示候选结构', status: 'passed', detail: '仅验证临时目录文件，不是模型效果证据。' }], ...extra });
  const items = [];
  for (let i = 0; i < count; i++) {
    const id = names[i % names.length] + (i >= names.length ? `-${Math.floor(i / names.length) + 1}` : ''), name = id;
    const scope = i % 13 === 12 ? 'plugin' : 'user';
    const action = i % 7 === 0 ? 'disable' : i % 3 === 0 ? 'modify' : 'keep';
    const source = path.join(skills, id);
    await writeSource(source, name, '每次操作都重新执行全部检查。');
    let candidate = null;
    if (action === 'modify') { candidate = path.join(drafts, id); await fs.cp(source, candidate, { recursive: true }); await writeCandidate(candidate, name); }
    items.push({ id, name, kind: scope === 'plugin' ? 'plugin' : 'skill', ...(scope === 'plugin' ? { plugin: { id: id + '@demo', components: ['临时整包插件示例'], inventoryStatus: '演示安装快照', instructions: '演示：插件操作由宿主管理。' } } : {}), group: groups[Math.min(5, Math.floor(i * 6 / count))], scope, action, summary: '为真实任务留下恰到好处的能力。', rationale: action === 'disable' ? '演示：与现有能力重叠，没有发现独立贡献，建议可恢复停用。' : action === 'modify' ? '演示：保留交付约定，收窄触发条件，去掉无变化仍重复检查的要求。' : '演示：提供明确的资源或用户约定，保留在合适的任务中使用。', preserves: ['用户明确的交付约定', '适用任务中的专业能力'], removes: action === 'keep' ? [] : ['不必要的流程负担'], evidence: [{ path: path.join(source, 'SKILL.md'), line: 9, quote: '每次操作都重新执行全部检查。' }], validation: [{ name: '演示候选结构', status: 'passed', detail: '仅验证临时目录文件，不是模型效果证据。' }], sources: [source], changes: action !== 'keep' && scope === 'user' ? [{ path: source, candidate }] : [] });
  }
  // 固定覆盖样本(不占 count):无法判定 review / 整组多变更 / 二进制变化 / 超长文本截断
  {
    const id = 'legacy-notes', source = path.join(skills, id);
    await writeSource(source, id, '内容零散，缺少使用记录。');
    items.push(base(id, { group: '知识与协作', scope: 'user', action: 'review', rationale: '演示：现有资料不足以判断此技能的实际用途与重叠情况，补充使用记录后再评估。', removes: [], evidence: [{ path: path.join(source, 'SKILL.md'), line: 9, quote: '内容零散，缺少使用记录。' }], sources: [source], changes: [] }));
  }
  {
    const id = 'pipeline-bridge', srcA = path.join(skills, 'pipeline-fetch'), srcB = path.join(skills, 'pipeline-render');
    const candA = path.join(drafts, 'pipeline-fetch'), candB = path.join(drafts, 'pipeline-render');
    await writeSource(srcA, 'pipeline-fetch', '每次操作都重新执行全部检查。');
    await writeSource(srcB, 'pipeline-render', '每次操作都重新执行全部检查。');
    await writeCandidate(candA, 'pipeline-fetch'); await writeCandidate(candB, 'pipeline-render');
    items.push(base(id, { group: '工具与连接', scope: 'user', action: 'modify', rationale: '演示：两处相关技能作为整组收窄触发条件；整组采纳、应用与恢复。', removes: ['不必要的流程负担'], evidence: [{ path: path.join(srcA, 'SKILL.md'), line: 9, quote: '每次操作都重新执行全部检查。' }], sources: [srcA, srcB], changes: [{ path: srcA, candidate: candA }, { path: srcB, candidate: candB }] }));
  }
  {
    const id = 'brand-kit', source = path.join(skills, id), candidate = path.join(drafts, id);
    await writeSource(source, id, '每次操作都重新执行全部检查。');
    await fs.writeFile(path.join(source, 'logo.bin'), randomBytes(96));
    await fs.cp(source, candidate, { recursive: true });
    await fs.writeFile(path.join(candidate, 'logo.bin'), randomBytes(128));
    items.push(base(id, { group: '视觉与创作', scope: 'user', action: 'modify', rationale: '演示：更新二进制资源；二进制文件不支持在线预览，只展示路径、大小与指纹。', removes: ['不必要的流程负担'], evidence: [{ path: path.join(source, 'SKILL.md'), line: 9, quote: '每次操作都重新执行全部检查。' }], sources: [source], changes: [{ path: source, candidate }] }));
  }
  {
    const id = 'field-guide', source = path.join(skills, id), candidate = path.join(drafts, id);
    const big = mark => Array.from({ length: 5000 }, (_, n) => `演示长文本第 ${n + 1} 行，${mark}，用于触发截断预览。`).join('\n');
    await writeSource(source, id, '每次操作都重新执行全部检查。');
    await fs.writeFile(path.join(source, 'appendix.txt'), big('原件'));
    await fs.cp(source, candidate, { recursive: true });
    await fs.writeFile(path.join(candidate, 'appendix.txt'), big('候选'));
    items.push(base(id, { group: '探索与研究', scope: 'user', action: 'modify', rationale: '演示：超长文本资源更新；预览按每侧 200,000 字节截断，完整内容保存在方案目录。', removes: ['不必要的流程负担'], evidence: [{ path: path.join(source, 'SKILL.md'), line: 9, quote: '每次操作都重新执行全部检查。' }], sources: [source], changes: [{ path: source, candidate }] }));
  }
  const input = { schemaVersion: 1, title: '一片更自由的能力宇宙', profile: { model: '当前宿主强模型 · 演示', host: '临时技能目录', tasks: ['构建产品', '探索知识', '表达创意'], preferences: ['保留明确贡献，减少无效负担'] }, discoveryRoots: [skills], coverage: ['所有条目均为生成的演示技能，操作只影响此演示目录。'], items };
  const run = path.join(root, 'run'); await prepare(input, run); return run;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const option = key => { const i = args.indexOf(`--${key}`); return i >= 0 ? args[i + 1] : undefined; };
  if (command === 'prepare') {
    if (!option('input') || !option('out')) throw new Error('prepare --input <审阅输入.json> --out <新工作目录>');
    const plan = await prepare(await readJSON(option('input')), option('out'));
    console.log(JSON.stringify({ run: path.resolve(option('out')), fingerprint: plan.fingerprint, items: plan.items.length }));
  } else if (command === 'serve') {
    if (!option('run')) throw new Error('serve --run <工作目录> [--port 端口]');
    const service = await serve(path.resolve(option('run')), { port: Number(option('port') || 0) });
    console.log(`Prune 工作台：${service.url}\n记录目录：${path.resolve(option('run'))}\n关闭网页不会取消任务；Ctrl+C 等待当前操作完成后关闭服务。`);
    const stop = () => service.close().then(() => process.exit(0)); process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } else if (command === 'demo') {
    const root = option('out') || path.join(os.homedir(), '.prune', 'demos', new Date().toISOString().replaceAll(/[:.]/g, '-'));
    const run = await demo(root, Number(option('count') || 40)); console.log(JSON.stringify({ run, next: `node "${fileURLToPath(import.meta.url)}" serve --run "${run}"` }));
  } else console.log('Prune · 本地技能修剪工作台\nprepare --input <方案.json> --out <新工作目录>\nserve --run <工作目录> [--port 端口]\ndemo [--out <新演示目录>] [--count 40]\n依赖 Node.js >=22.19；不安装依赖、不调用模型。用户在工作台应用后才写入文件或调用宿主插件启停接口。');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(e => { console.error(e.message); process.exitCode = 1; });

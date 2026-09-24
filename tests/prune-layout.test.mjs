import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const html = await fs.readFile(new URL('../skills/prune/assets/workbench.html', import.meta.url), 'utf8');
const geometry = html.slice(html.indexOf('const textW='), html.indexOf('function advIconKids'));
const filters = html.slice(html.indexOf('function matchFilter('), html.indexOf('function applyFilters('))
  + html.slice(html.indexOf('function activeFilterCount('), html.indexOf('function filteredItems('));
const items = Array.from({ length: 44 }, (_, n) => ({ id: `skill-${n}`, name: `original-skill-${n}`, group: `用途${Math.floor(n / 8)}` }));
function layout({ mobile = false, search = '', expanded = [], data = items } = {}) {
  const ctx = vm.createContext({ items: data, isMobile: () => mobile,
    S: { expandedGroups: new Set(expanded), filters: { text: search, source: 'all', advice: 'all', decision: 'all', execution: 'all' } },
    adviceName: () => '修改' });
  return vm.runInContext(filters + geometry + '\ntreeGeom(items)', ctx);
}

test('Prune dense overview keeps readable tiers, separated leaves and roots below all branches', () => {
  const g = layout();
  assert.equal(g.groups.length, 6);
  assert.equal(g.leafPos.size, 6);
  assert.equal(g.morePos.size, 6);
  const points = [...g.leafPos.values(), ...g.morePos.values()];
  for (const a of points) {
    assert(g.base > a.y + 32, 'roots must remain below leaves');
    for (const b of points) if (a !== b && a.side === b.side)
      assert(Math.abs(a.y - b.y) >= 72, '72px click targets must not overlap');
  }
  assert(g.bbox.maxY - g.bbox.minY < 620, 'overview must fit a short desktop without tiny labels');
});

test('Prune search reveals a collapsed original name and expansion retains every item', () => {
  const g = layout({ search: 'original-skill-7' });
  assert(g.leafPos.has('skill-7'));
  assert.equal(g.leafPos.size, 1);
  const expanded = layout({ expanded: ['用途0'] });
  for (let n = 0; n < 8; n++) assert(expanded.leafPos.has(`skill-${n}`));
  assert(!expanded.morePos.has('用途0'));
});

test('Prune mobile expands one purpose branch while preserving other group entry points', () => {
  const g = layout({ mobile: true, expanded: ['用途2'] });
  assert.equal(g.leafPos.size, 8);
  assert([...g.leafPos.values()].every(p => p.grp === '用途2'));
  assert.equal(g.morePos.size, 5);
});


test('Prune 53-object summaries preserve every group and fit the full bounds', () => {
  const data = Array.from({ length: 53 }, (_, n) => ({ id: 'dense-'+n, name: 'original-'+n,
    group: '很长的项目名称与规则目录分组-'+(n % 14) }));
  const g = layout({ data });
  assert.equal(g.groups.length, 14);
  assert.equal(g.leafPos.size, 0);
  assert.equal(g.morePos.size, 0);
  assert.equal(g.compact, true);
  const ctx = vm.createContext({});
  const fit = html.slice(html.indexOf('function fitTransform('), html.indexOf('function zoomAt('));
  const transform = vm.runInContext(fit+';fitTransform', ctx)(g.bbox, 1329, 650);
  assert(transform.k > .5);
  assert(g.bbox.minX * transform.k + transform.x >= 16);
  assert(g.bbox.maxX * transform.k + transform.x <= 1313);
  assert(g.bbox.minY * transform.k + transform.y >= 19.99);
  assert(g.bbox.maxY * transform.k + transform.y <= 570.01);
  const expanded = layout({ data, expanded: [data[0].group] });
  for (const i of data.filter(i => i.group === data[0].group)) assert(expanded.leafPos.has(i.id));
});

test('Prune long group captions occupy at most two bounded lines', () => {
  const ctx = vm.createContext({});
  const lines = vm.runInContext(geometry+';groupLines("项目规则/一个非常长的中文目录名和名称abcdefghijklmnopqrstuv")', ctx);
  const measure = vm.runInContext('textW', ctx);
  assert.equal(lines.length, 2);
  assert(lines.every(line => measure(line) <= 126));
  assert(lines[1].endsWith('…'));
});

test('Prune reading context keeps catalog, per-object tabs and per-file positions through replacement', () => {
  const doc = { activeElement: null };
  const ctx = vm.createContext({ document: doc, CSS: { escape: x => x } });
  const source = html.slice(html.indexOf('const readingState='), html.indexOf('function render(){'));
  vm.runInContext(source, ctx);
  const save = vm.runInContext('saveReadingContext', ctx), restore = vm.runInContext('restoreReadingContext', ctx);
  function pane(className, key, top = 0, file = '') {
    return { className, dataset: { scrollKey: file }, scrollTop: top, scrollLeft: 17,
      closest: () => ({ dataset: { readingKey: key } }), matches: selector => selector === '.'+className };
  }
  function root(panes, focus = null) {
    return { querySelectorAll: () => panes, contains: el => el === focus,
      querySelector: () => focus };
  }
  const focus = { id: 'cutCatalogSearch', selectionStart: 2, selectionEnd: 4,
    focus: options => { assert.equal(options.preventScroll, true); },
    setSelectionRange: (start, end) => assert.deepEqual([start, end], [2, 4]) };
  doc.activeElement = focus;
  const snapshot = save(root([pane('cat-groups', 'a/advice', 1715), pane('detail-body', 'a/advice', 420)], focus));
  const catalog = pane('cat-groups', 'a/diffs'), diff = pane('diff-pane', 'a/diffs', 0, 'a/file:before');
  restore(root([catalog, diff], focus), snapshot);
  assert.equal(catalog.scrollTop, 1715);
  assert.equal(diff.scrollTop, 0);
  diff.scrollTop = 830;save(root([catalog, diff]));
  const other = pane('detail-body', 'b/advice');restore(root([other]), null);
  assert.equal(other.scrollTop, 0, 'new object must not inherit old object body position');
  other.scrollTop = 110;save(root([other]));
  const returned = pane('detail-body', 'a/advice');restore(root([returned]), null);
  assert.equal(returned.scrollTop, 420, 'return restores this object and tab');
  const loaded = pane('diff-pane', 'a/diffs', 0, 'a/file:before');restore(root([loaded]), null);
  assert.equal(loaded.scrollTop, 830, 'async replacement restores the same file');
  assert.equal(loaded.scrollLeft, 17);
});


test('Prune distinguishes unfinished review, host operations, rule drafts and fresh authorization', () => {
  const ctx = vm.createContext({ S: { data: { selection: {} } } });
  const source = html.slice(html.indexOf('function adviceKey('), html.indexOf('function outcomeText('));
  vm.runInContext(source, ctx);
  const advice = vm.runInContext('adviceName', ctx), label = vm.runInContext('executionModeLabel', ctx);
  const adopt = vm.runInContext('canAdopt', ctx), decision = vm.runInContext('decisionName', ctx);
  const pending = { reviewStatus: 'pending', action: 'unreviewed', state: 'ready', decisionAllowed: true };
  assert.equal(advice(pending), '待审读');
  assert.equal(label(pending), '待完成审读');
  assert.equal(adopt(pending), false);
  assert.equal(label({ executionMode: 'host', kind: 'plugin' }), '宿主管理');
  assert.equal(label({ executionMode: 'unavailable', kind: 'instruction', revisionDraft: {} }), '规则修订稿待落实');
  assert.equal(decision({ id: 'new', priorDecision: 'approved' }), '未决定');
});


test('Prune previews rule drafts with no executable changes and remembers files per object', () => {
  const S = { detailFiles: { rule: 1, other: 0 } };
  const ctx = vm.createContext({ S, isMobile: () => false, changeStatusName: { modified: '修改' },
    h: (tag, attrs, ...children) => ({ tag, attrs, children }),
    computeDiff: () => ({}), diffPane: (d, f) => f.path });
  const source = html.slice(html.indexOf('function renderDiffs('), html.indexOf('function renderAdviceTab('));
  const render = vm.runInContext(source+';renderDiffs', ctx);
  const files = ['AGENTS.md', 'CLAUDE.md'].map(path => ({ path, status: 'modified', previewOnly: true }));
  const tree = render(files, { id: 'rule', changes: [], revisionDraft: {} });
  assert.equal(S.detailFile, 1);
  assert(JSON.stringify(tree).includes('不会进入工作台应用清单'));
  render(files, { id: 'other', changes: [] });
  assert.equal(S.detailFile, 0);
  render(files, { id: 'rule', changes: [] });
  assert.equal(S.detailFile, 1);
});


test('Prune selection response prevents an identical poll from rebuilding the view', async () => {
  const state = { plan: { fingerprint: 'f' }, selection: { a: 'approved' }, items: [{ state: 'ready', executionState: 'ready' }], jobs: [], busy: false };
  let renders = 0;
  const S = { data: state, online: true, requesting: false, lastViewKey: '', lastJobStatuses: new Map(), enteredView: true };
  const ctx = vm.createContext({ S, api: async () => state, render: () => renders++, notice: () => {}, $: () => ({ hidden: false }) });
  const source = html.slice(html.indexOf('function stateKey('), html.indexOf('// Read identity from the DOM:'))
    + html.slice(html.indexOf('async function setChoice('), html.indexOf('function flashViewX('));
  vm.runInContext(source, ctx);
  await vm.runInContext("setChoice('a','approved')", ctx);
  assert.equal(renders, 1);
  await vm.runInContext('refresh()', ctx);
  assert.equal(renders, 1, 'same state returned by poll must not rebuild');
  state.selection = { a: 'deferred' };
  await vm.runInContext('refresh()', ctx);
  assert.equal(renders, 2, 'new server state must still rebuild');
});

test('Prune asynchronous detail loads rebuild only the selected file-difference tab', async () => {
  let renders = 0;
  const S = { details: {}, route: 'cut', cutView: 'detail', selected: 'a', detailTab: 'advice' };
  const ctx = vm.createContext({ S, api: async () => ({ files: [] }), render: () => renders++ });
  vm.runInContext(html.slice(html.indexOf('async function loadDetails('), html.indexOf('function backToOverview(')), ctx);
  for (const tab of ['advice', 'evidence', 'diffs']) {
    S.details = {}; S.detailTab = tab;
    await vm.runInContext("loadDetails('a')", ctx);
    assert.equal(renders, tab === 'diffs' ? 1 : 0);
  }
  S.details = {}; S.selected = 'b';
  await vm.runInContext("loadDetails('a')", ctx);
  assert.equal(renders, 1, 'a late response from the previous object must not interrupt reading');
});


test('Prune 12-group overview keeps captions readable in a 1280x720 window', () => {
  const data = Array.from({ length: 53 }, (_, n) => ({ id: 'real-'+n, name: 'original-'+n,
    group: '项目名称与规则目录分组-'+(n % 12) }));
  const g = layout({ data });
  const ctx = vm.createContext({});
  const fit = html.slice(html.indexOf('function fitTransform('), html.indexOf('function zoomAt('));
  // Reserve 300px for browser/app header, plan notice and toolbar; fit also reserves tree controls.
  const transform = vm.runInContext(fit+';fitTransform', ctx)(g.bbox, 1280, 420);
  assert.equal(g.compact, true);
  assert(20 * transform.k >= 12, 'group captions need at least 12 screen pixels');
  assert(64 * transform.k >= 40, 'summary click target must remain usable');
  assert(g.bbox.minY * transform.k + transform.y >= 19.99);
  assert(g.bbox.maxY * transform.k + transform.y <= 340.01);
  const ys = [...g.groupPos.values()].filter(p => p.side === 1).map(p => p.y);
  for (let n=1;n<ys.length;n++) assert(ys[n]-ys[n-1]>=64);
  const expanded = layout({ data, expanded: [data[0].group] });
  assert.equal(expanded.compact, false);
  for(const i of data.filter(i => i.group === data[0].group)) assert(expanded.leafPos.has(i.id));
});


test('Prune advice does not repeat identical plugin instructions as an execution note', () => {
  const explanation = '在原宿主插件设置中选择此完整插件并停用。';
  const ctx = vm.createContext({ h: (tag, attrs, ...children) => ({ tag, attrs, children }),
    adviceKey: () => 'modify', executionExplanation: i => i.executionNote,
    executable: i => !!i.executable, pluginTarget: () => '', pluginInventory: () => '安装信息:未同步' });
  const source = html.slice(html.indexOf('function renderAdviceTab('), html.indexOf('function renderEvidenceTab('));
  const render = vm.runInContext(source+';renderAdviceTab', ctx);
  const item = { kind: 'plugin', plugin: { id: 'sample', instructions: explanation }, changes: [], executionNote: explanation };
  assert.equal(JSON.stringify(render(item)).split(explanation).length-1, 1);
  item.executionNote = '额外的已核实处理要求。';
  assert(JSON.stringify(render(item)).includes(item.executionNote), 'different information remains visible');
});


test('Prune tree inspector file-difference link opens the selected object directly on diffs', () => {
  const source = html.slice(html.indexOf('function treeToCut('), html.indexOf("$('navTree').onclick"));
  for (const reduced of [true, false]) {
    const S = { selected: 'previous', cutView: 'overview', detailTab: 'advice', reduced };
    let navigations = 0;
    const ctx = vm.createContext({ S,
      treeUI: { insTitle: { isConnected: true, getBoundingClientRect: () => ({ left: 0, top: 0 }) } },
      getComputedStyle: () => ({ fontSize: '20px' }), requestAnimationFrame: () => {},
      go: route => { navigations++; assert.equal(route, 'cut'); assert.equal(S.selected, 'target');
        assert.equal(S.cutView, 'detail'); assert.equal(S.detailTab, 'diffs'); } });
    vm.runInContext(source+";treeToCut('target')", ctx);
    assert.equal(navigations, 1);
  }
});

test('Prune pending list includes executable rules and host controls but keeps preview-only decisions outstanding', () => {
  const items = [
    { id: 'skill', kind: 'skill', executionMode: 'workbench' },
    { id: 'rule', kind: 'instruction', executable: true, executionMode: 'workbench' },
    { id: 'plugin', kind: 'plugin', executable: true, executionMode: 'host', pluginControl: {
      control: { host: 'claude-code', pluginId: 'example@market', scope: 'project', projectRoot: '/example/project' },
      before: { version: '1.2.3' }, desiredEnabled: true } },
    { id: 'draft', kind: 'instruction', executable: false, executionMode: 'unavailable', revisionDraft: {} },
    { id: 'advice', kind: 'plugin', executable: false, executionMode: 'host' },
    { id: 'keep', kind: 'instruction', executable: false, executionMode: 'none', action: 'keep' },
  ].map(i => ({ name: i.id, action: 'modify', executionState: 'ready', state: 'ready', ...i }));
  const S = { data: { items, selection: Object.fromEntries(items.map(i => [i.id, 'approved'])), plan: {} }, online: true };
  const ctx = vm.createContext({ S, h: (tag, attrs, ...children) => ({ tag, attrs, children }),
    plHead: (title, sub) => [title, sub], fmtDate: () => '', matchFilter: () => true,
    execStateName: { ready: '未应用' }, setChoice: () => {}, closePendingList: () => {}, applySelected: () => {} });
  vm.runInContext(html.slice(html.indexOf('function adviceKey('), html.indexOf('let toastTimer=')), ctx);
  const available = vm.runInContext('available', ctx);
  assert.deepEqual(items.filter(available).map(i => i.id), ['skill', 'rule', 'plugin']);
  const render = vm.runInContext(html.slice(html.indexOf('function renderPendingList('), html.indexOf('function renderJobRunning('))+';renderPendingList', ctx);
  const text = JSON.stringify(render());
  assert(text.includes('1 项规则、1 项插件已采纳但待落实'));
  assert(text.includes('claude-code · example@market · 冻结版本 1.2.3 · 作用域 project · 项目 /example/project · 目标启用'));
  assert(text.includes('正式插件接口'));
  assert.equal(vm.runInContext('adviceName', ctx)(items[2]), '启用');
  assert(text.includes('应用所选 3'));
  items.slice(0, 3).forEach(i => { i.executionState = 'applied'; });
  const completed = JSON.stringify(render());
  assert(completed.includes('当前没有可执行项，仍有已采纳建议待落实'));
});

test('Prune writable rule diff does not present the draft-only limitation', () => {
  const ctx = vm.createContext({ S: { detailFiles: {} }, isMobile: () => false,
    changeStatusName: { modified: '修改' }, h: (tag, attrs, ...children) => ({ tag, attrs, children }),
    computeDiff: () => ({}), diffPane: (d, f) => f.path });
  const render = vm.runInContext(html.slice(html.indexOf('function renderDiffs('), html.indexOf('function renderAdviceTab('))+';renderDiffs', ctx);
  const tree = render([{ path: 'AGENTS.md', status: 'modified', previewOnly: false }],
    { id: 'rule', changes: [{ type: 'file' }], revisionDraft: { writable: true } });
  assert(!JSON.stringify(tree).includes('不会进入工作台应用清单'));
});

test('Prune verification drift refreshes the view but a new check timestamp preserves reading position', () => {
  const ctx = vm.createContext({});
  const stateKey = vm.runInContext(html.slice(html.indexOf('function stateKey('), html.indexOf('async function refresh('))+';stateKey', ctx);
  const state = { selection: {}, jobs: [], items: [{ state: 'applied', executionState: 'applied',
    effectiveState: { status: 'verified', detail: '配置已读回', checkedAt: 'first', loaded: 'unknown' } }] };
  const original = stateKey(state);
  state.items[0].effectiveState.checkedAt = 'second';
  assert.equal(stateKey(state), original);
  state.items[0].effectiveState.status = 'drifted';
  assert.notEqual(stateKey(state), original);
  state.items[0].effectiveState.hostState = { installed: true, version: '1', configured: 'enabled' };
  const previousVersion = stateKey(state);
  state.items[0].effectiveState.hostState.version = '2';
  assert.notEqual(stateKey(state), previousVersion, 'observed plugin version changes must refresh the inventory');
  vm.runInContext(html.slice(html.indexOf('const executable='), html.indexOf('function planNotice(')), ctx);
  const label = vm.runInContext('effectiveText', ctx)({ ...state.items[0], kind: 'plugin' });
  assert(label.includes('与执行记录不一致'));
  assert(label.includes('当前会话加载状态未确认'));
});

test('Prune plugin inventory prefers observed host state, labels snapshots and avoids duplicate load caveats', () => {
  const ctx = vm.createContext({});
  vm.runInContext(html.slice(html.indexOf('const executable='), html.indexOf('function planNotice(')), ctx);
  const inventory = vm.runInContext('pluginInventory', ctx), effective = vm.runInContext('effectiveText', ctx);
  const item = { kind: 'plugin', plugin: { inventoryStatus: '旧安装记录' } };
  assert.equal(inventory(item), '安装信息:旧安装记录');
  item.pluginControl = { before: { installed: true, version: '1', configured: 'enabled' } };
  assert.equal(inventory(item), '冻结快照：已安装 · 版本 1 · 已启用');
  item.effectiveState = { status: 'verified', detail: '宿主配置：已停用；当前会话加载状态未知，请重新加载宿主。',
    hostState: { installed: true, version: '2', configured: 'disabled' } };
  assert.equal(inventory(item), '最近宿主核验：已安装 · 版本 2 · 已停用');
  assert.equal(effective(item).split('当前会话加载状态').length - 1, 1);
  item.effectiveState.hostState = { installed: null, configured: 'unknown' };
  assert.equal(inventory(item), '最近宿主核验：安装状态未知 · 版本 未确认 · 启停配置未知');
});

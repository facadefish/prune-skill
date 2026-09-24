# 工作台方案与执行契约

开始 Prune 任务时读取本契约，语义审查完成后据此准备并打开工作台；应用或恢复也遵守本契约。来源与内容判断由宿主完成；脚本不调用模型。

## 准备与打开

需要 Node.js >=22.19，无 npm 包或模型 SDK 依赖；缺失时说明依赖，不全局安装。默认将稿件和记录放在 `~/.prune/`，且必须在技能发现范围之外。归档与技能须在同一文件系统；跨盘技能按盘拆方案。

```text
node <Prune目录>/scripts/prune.mjs prepare --input <input.json> --out <新工作目录>
node <Prune目录>/scripts/prune.mjs serve --run <工作目录>
```

使用输出的完整链接（含 `#` 后的令牌）打开包内工作台，不另做网页。服务只监听本机；不安装常驻服务。已有服务优先复用，停止后对原目录运行 `serve`；模板在启动时读取，改模板需重启。关闭网页不取消操作，Ctrl+C 等待当前任务完成再关闭服务。

同一审阅的继续请求先核查原运行目录和服务，不另建一份失去用户选择的方案。网址失效时，检查原服务是否仍在监听；若已停止，以原目录重新 `serve` 并使用新输出的完整链接。页面打开后核对方案与选择入口，再交付；服务运行与页面可用是不同检查。

## 输入

所有文件路径必须绝对化。原名称写入 `name`，用途解释写入 `summary` / `group`，不以翻译别名替换对象身份。

`intent` 为 `review`（默认，仅建议）或 `revise`（要求实施改进）。`prepare` 返回的 `completion` 根据待审读及实施任务缺失候选数显示 `complete` / `partial`；它只检查产物齐备，不证明语义质量或模型效果。`action:unreviewed` 显示“待审读”，不与审读后仍缺事实的“无法判定”混为一谈。后一种用 `nextStep` 说明具体缺口和最小补查。

独立技能修改项没有 `changes`、规则没有可写修订稿、插件没有控制计划时只能记录建议。要求实施时继续准备对应执行材料，不能用仅建议方案交付修剪完成。因真实阻塞未能准备时，在 `nextStep` 写明原因，保留未完成状态。更新方案保留旧记录；可用 `priorDecision` 记录旧建议的 `approved` / `deferred` / `none`，只作上下文，新方案的 `selection` 仍为空。

规则修订使用 `revisionDraft: {"source":"/absolute/AGENTS.md","path":"/absolute/drafts/AGENTS.md","writable":true}`。source 必须在该对象 sources 中，两者是独立的 Markdown/文本文件，稿件在发现范围外。`action:modify`、显式 `writable:true` 才准备写入；输入 `changes:[]`，执行器冻结内容与指纹并生成 `type:file` 变更，页面可审阅差异。规则原件不支持符号链接或硬链接；父目录真实路径被冻结，执行与恢复时核对，重定向即停止。未设置 writable 的修订仍是只读预览；旧方案和已有采纳决定不提升授权，须准备新方案、由用户重新采纳并点击应用。

插件启停使用 `plugin.control: {"host":"claude-code","pluginId":"example@marketplace","scope":"user","desiredEnabled":false}`，并保持 `plugin.id` 与 pluginId 一致、`changes:[]`。host 为 `claude-code` 或 `codex`；Claude Code 支持 user/project/local，本版 Codex 仅支持 user，project 控制明确阻止（本机正式接口只允许写用户配置）；非 user 范围必须提供绝对 `projectRoot`。停用用 `action:disable` 和 false；启用用 `action:modify` 和 true。准备以正式接口只读核验来源与状态，冻结 `pluginControl:{control,before,desiredEnabled}`；应用和恢复再调用正式接口并读回核验。没有 plugin.control 的插件仍为建议，使用 `plugin.instructions` 给出具体接续方法。不能宣称采纳建议已经改变插件状态。

```json
{
  "schemaVersion": 1,
  "title": "技能审阅",
  "profile": {
    "model": "实际模型或未知项",
    "host": "实际宿主",
    "tasks": ["用户任务"],
    "preferences": ["影响取舍的偏好"]
  },
  "discoveryRoots": ["/absolute/skills"],
  "coverage": ["来源范围、归并方式、排除对象和未知项"],
  "items": [{
    "id": "example",
    "name": "original-skill-name",
    "kind": "skill",
    "scope": "user",
    "group": "任务用途",
    "action": "modify",
    "summary": "此对象的具体贡献",
    "rationale": "原文问题如何影响用户任务",
    "preserves": ["保留的能力或约束"],
    "removes": ["移除的负担与可能损失"],
    "warnings": ["影响决定的限制"],
    "sources": ["/absolute/skills/example"],
    "evidence": [{"path": "/absolute/skills/example/SKILL.md", "line": 12, "quote": "原文证据"}],
    "validation": [{"name": "引用检查", "status": "passed", "detail": "实际完成的检查；模型效果未测"}],
    "changes": [{"path": "/absolute/skills/example", "candidate": "/absolute/drafts/example"}]
  }]
}
```

- `action` 支持 `keep`、`modify`、`disable`、`merge`、`split`、`undetermined`。对外 `recommendation` 为保留、修改、停用、无法判定；合并/拆分归修改，旧 `review` / `unreviewed` 归无法判定。
- `scope` 为 `user`、`project`、`plugin`、`platform`（兼容 `system`）、`unknown`；`kind` 为 `skill`、`plugin` 或 `instruction`。固定平台对象不放候选，在 `coverage` 说明。用途分组不是依赖关系或效果分数。
- 插件用 `scope:plugin`、`kind:plugin`、唯一 `plugin.id` 和 `changes:[]`。`plugin` 可含 `version`、`components`、`inventoryStatus`、`instructions`，说明整包组成、安装快照与原宿主管理方法。可执行控制计划仅支持完整插件启停；不卸载、更新、撤销服务授权或修改内部文件。缺少正式接口或无法确定目标与作用域时保留为建议，明确阻塞，不伪造成功。
- 准备候选前核实真实路径、目录自身及祖先的 `.codex-plugin/plugin.json` / `.claude-plugin/plugin.json` 与安装归属；位于 skills 目录不等于独立技能。可复用 `scripts/engine.mjs` 导出的 `protectedSource(path)` 检查执行保护。发现插件归属时归并为完整插件建议，不移除 manifest、不弱化保护，也不用不可执行候选冒充实施完成。
- 提示词、AGENTS.md / CLAUDE.md 等规则用 `kind:instruction`、`scope:user` 或 `project`、输入 `changes:[]`，在 `sources` 和证据中保留真实文件路径。规则写入仅来自显式可写 revisionDraft，不接收冒充技能目录的候选或任意文件变更清单。
- 同一逻辑对象只有一个 ID；同源多入口汇入 `sources` 与相应 `changes`。不同项目的写入路径不能重叠或互相包含，不能为绕过边界扩大来源范围。
- 独立技能修改的原目录须存在，`candidate` 指向完整独立技能包；停用用 `candidate:null`。合并/拆分作为一个项目处理所有变更：移出原目录用 null，新目录指向候选；新目标已占用即冲突，不能覆盖。保留、未知和仅建议项目可省略 `changes` 或用空数组；有明确结论的本地仅建议项可记录采纳，但显示尚无执行方案，不能应用。需要执行时重新准备含完整候选的新方案，不在采纳后补入变更。
- 宿主核对保留对象对变更对象的调用，并验证项目可独立应用和恢复。合并/拆分连带的引用迁移，在现有整项变更能够准确表达时纳入同项；否则保留兼容入口、消除跨项依赖或仅提供建议。不能靠建议用户按顺序全选维持正确性，也不扩大对象来源或授权。执行器检查文件与路径，不会自动发现语义依赖。
- 候选与运行目录均在发现范围外，保留资源与执行权限。源根链接可转成独立副本；嵌套资源链接需要另行明确边界，当前版本阻止执行，不默默解引用。
- `validation.status` 仅用 `passed` 或 `unknown`，记录实际检查；未完成或失败的检查说明原因，不能标通过。`sourceFingerprints` 可记录只读盘点范围，执行器另算完整包指纹，不信任输入哈希。

## 冻结与决定

准备生成 `plan.json`、`state.json`、`originals/`、`candidates/`。冻结建议、源/候选指纹、根真实路径和链接信息；指纹覆盖文件相对路径、内容、大小与权限。候选自动检查 name/description 与本地 Markdown 引用；脚本行为、隐式引用和内容正确性仍需宿主验证。准备失败保留诊断，修正后用新目录，不覆盖原备份。

| 概念 | 含义 |
|---|---|
| 建议 | 保留、修改、停用、无法判定，与用户决定分开 |
| `selection` | `none` 未决定、`approved` 已采纳、`deferred` 暂不采纳；采纳不等于执行 |
| `decisionAllowed` | 有明确可采纳结论；保留与插件可以采纳，无法判定不可采纳 |
| `executionMode` | `workbench` 本地技能或规则执行、`host` 原宿主管理、`none` 无变更、`unavailable` 无执行方案；host 不单独表示可执行，另看 `executable` |
| `executionState` | 可执行本地项及插件控制项有 `ready`、`applied`、`running`、`problem`；其他项为 null |
| `lastOutcome` | 最近操作结果与历史，不取代当前状态；插件快照不等于实时安装或加载状态 |
| `effectiveState` | 当前文件或宿主配置的核验结果；不能把配置已写入表述为当前会话已重新加载，加载状态无证据时为未知 |

两视图共享方案、决定和历史。筛选不撤销已采纳项；隐藏的可执行项仍在全量待应用清单中。已采纳但不可执行的规则与插件单独计为待落地，不纳入已执行数量，也不能因执行队列为零而隐藏。文本差异每侧最多预览 200 KB，超出标明；二进制显示大小与哈希，完整文件留在候选目录。

只有用户点击“应用所选”才授权冻结方案中已采纳项目的实际变更；真实“恢复所选”也由用户操作，不代点或绕过 API。按钮外不加重复聊天确认。源、候选或方案变化时重新准备，不在采纳后追加生成。多个发现入口逐个说明，不能把处理一处说成全部停用。

## 失败、恢复与服务

执行前核对目录真实路径、来源、候选与备份；内部目录不得被链接重定向。按项目写入日志，先归档原件再放置候选。失败项回退并停止后续，先前成功项保留；合并/拆分整项处理。中断保留现场，不自动重放未完成操作。

规则文件共用历史、备份、源与候选指纹检查及恢复冲突检测；写入后核验实际文件，恢复不能覆盖用户后续编辑。插件执行由 `scripts/plugin-host.mjs` 适配正式接口：Claude Code CLI 或 Codex app-server 的配置接口，不直接重写 TOML、不操作插件缓存。应用前核对冻结目标、作用域和 before 状态；恢复前核对应用后的状态，再恢复先前 enabled 布尔值并读回。恢复是该作用域启停状态的恢复，不是配置文件逐字节回滚；不删除本次新增的覆盖配置，不承诺版本回滚、服务授权恢复或当前会话热加载；宿主能力或状态不明时停止并保留记录。

Codex 适配器要求 `plugin/installed` 证明 local/git/npm 安装且本地 marketplace 路径存在；拒绝平台、远程/工作区托管、管理员限制或已禁用的配置层。写入用 `config/value/write` 的准确 filePath、keyPath 和 expectedVersion。Claude Code 使用准确插件 ID 与 `--scope`；manifest 含可能连带启用其他插件的 dependencies，或无法读取清单以确认恢复边界时，启停均阻止。成功控制只核验配置，返回 `reloadRequired:true`，在独立验证前会话加载状态仍为未知。

恢复核对归档和当前文件；后续编辑、目标占用、备份漂移或链接变化造成冲突时保留现场，不覆盖。恢复时现有修订版也归档，不永久删除。成功后回到 `ready` 和 `none`，可重新采纳应用，历史保留；失败但完整回退仍为 ready，部分回退/中断/恢复冲突需处理。执行中不能更改决定；已应用且尚未恢复的项目也不能改决定，其他未执行项目不受已完成项目约束。

服务每个运行目录仅一实例，同一用户默认只允许一个文件任务。随机端口监听 `127.0.0.1`，令牌保存在 `session.json`，重启复用。API 需要 Bearer 令牌，POST 还须匹配 Origin 和 JSON Content-Type。`requestId` 使用唯一字母数字/连字符 ID；相同 ID 和参数不重复执行，改参数则拒绝。操作记录在磁盘，localStorage 不是执行事实；重新打开或重连不证明新会话发现或已加载指令改变。

## 临时验收

`node <Prune目录>/scripts/prune.mjs demo --count 40 --out <新临时目录>` 生成纯演示技能，再按输出启动服务。技能与规则验收使用临时文件；插件启停验收使用隔离宿主替身或明确隔离的临时插件环境，不能操作真实用户插件。核对应用、恢复、漂移拒绝、仅建议待落地计数及会话加载未知提示；演示和替身验证不是用户真实清单、真实宿主写入验收或模型效果证据。

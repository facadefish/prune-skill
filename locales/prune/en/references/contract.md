# Workbench plan and execution contract

Read this contract at task intake; after semantic review, use it to prepare and open the workbench. It also governs application and restoration. The host performs provenance and content analysis; the scripts make no model calls.

## Prepare and open

Requires Node.js >=22.19, with no npm packages or model SDK. If unavailable, report the dependency instead of installing it globally. Place drafts and records under `~/.prune/` by default, outside skill discovery roots. Archives and affected skills must share a filesystem; prepare separate plans for different volumes.

```text
node <prune-directory>/scripts/prune.mjs prepare --input <input.json> --out <new-run-directory>
node <prune-directory>/scripts/prune.mjs serve --run <run-directory>
```

Open the full emitted URL, including its fragment token, to use the bundled workbench. Do not generate a replacement webpage or install a persistent service. Reuse a running service; otherwise serve the existing run directory. The template is read at startup, so template changes require a restart. Closing the page does not cancel operations; Ctrl+C waits for the current operation before stopping the service.

This package provides English instructions with the shared Chinese workbench and runtime messages. `采纳` means Accept: it records a decision. `应用所选` means Apply selected: it executes eligible accepted items. `历史与恢复` opens History and restore; `恢复所选` means Restore selected. Acceptance alone never applies a change. The instruction language does not dictate the user's response language.

When continuing the same review, inspect its existing run directory and service instead of replacing the user’s choices with a new blank plan. If the URL fails, check whether that service is still listening; if stopped, serve the existing directory and use the newly emitted full URL. Verify the intended plan and decision controls in the opened page before handoff. A running service and a usable page are separate checks.

## Input

Set `intent` to `review` (default, advice) or `revise` (implementation requested). The prepared plan's `completion` is `complete` or `partial`, based on unfinished review and missing implementation artifacts. It checks artifact readiness, not semantic quality or model gains. `action:unreviewed` is displayed as pending review, separately from Undetermined after review. Use `nextStep` for the specific missing fact and smallest useful check.

Standalone skill revisions without `changes`, rules without writable drafts, and plugins without control plans record advice only. For implementation requests, continue preparing the appropriate execution artifacts; do not present an advice-only plan as completed pruning. Describe genuine blockers in `nextStep` and retain the incomplete status. Preserve earlier plan records when creating a new version. Optional `priorDecision` records an earlier recommendation's `approved`, `deferred`, or `none` as context only; the new plan's `selection` remains empty.

Rule revisions use `revisionDraft: {"source":"/absolute/AGENTS.md","path":"/absolute/drafts/AGENTS.md","writable":true}`. The source must be declared in the item's `sources`; both must be separate Markdown or text files, with the draft outside discovery roots. Only `action:modify` with explicit `writable:true` prepares a write. Supply `changes:[]`; the executor freezes contents and fingerprints and generates a `type:file` change for review and execution. Rule files cannot be symbolic links or hard links. Freeze the real parent path, recheck it before execution and restoration, and stop if it is redirected. Omitting writable retains a read-only preview. Existing plans and accepted previews gain no authority through an upgrade: prepare a new plan and obtain the user's new acceptance and Apply action.

Plugin controls use `plugin.control: {"host":"claude-code","pluginId":"example@marketplace","scope":"user","desiredEnabled":false}`, with matching `plugin.id` and `changes:[]`. Host is `claude-code` or `codex`; Claude Code supports user/project/local scopes. This version supports only user scope for Codex; project controls are blocked because the installed official interface permits writes only to user configuration. Any non-user scope requires an absolute `projectRoot`. Disable uses `action:disable` with false; enable uses `action:modify` with true. Preparation reads provenance and state through the official host interface and freezes `pluginControl:{control,before,desiredEnabled}`. Apply and Restore call the official interface and verify readback. Plugins without plugin.control remain advice; provide concrete next steps in `plugin.instructions`, without implying acceptance changed their state.

All filesystem paths must be absolute. Preserve the original skill or plugin identity in `name`; put localized explanations in `summary` and `group`.

```json
{
  "schemaVersion": 1,
  "title": "Skill review",
  "profile": {
    "model": "Actual model or stated unknowns",
    "host": "Actual host",
    "tasks": ["User task"],
    "preferences": ["Decision-relevant preference"]
  },
  "discoveryRoots": ["/absolute/skills"],
  "coverage": ["Provenance, scope, deduplication, exclusions, and unknowns"],
  "items": [{
    "id": "example",
    "name": "original-skill-name",
    "kind": "skill",
    "scope": "user",
    "group": "Task category",
    "action": "modify",
    "summary": "Specific contribution",
    "rationale": "How the located instruction affects the user's task",
    "preserves": ["Retained capability or constraint"],
    "removes": ["Removed burden and potential loss"],
    "warnings": ["Decision-relevant limitation"],
    "sources": ["/absolute/skills/example"],
    "evidence": [{"path": "/absolute/skills/example/SKILL.md", "line": 12, "quote": "Source evidence"}],
    "validation": [{"name": "Reference check", "status": "passed", "detail": "Check actually performed; model impact untested"}],
    "changes": [{"path": "/absolute/skills/example", "candidate": "/absolute/drafts/example"}]
  }]
}
```

- `action` accepts `keep`, `modify`, `disable`, `merge`, `split`, and `undetermined`. User-facing recommendations are Keep, Revise, Disable, and Undetermined. Merges and splits map to `modify`; legacy `review` and `unreviewed` map to `undetermined`. Do not translate protocol values.
- `scope` is `user`, `project`, `plugin`, `platform` (legacy `system`), or `unknown`; `kind` is `skill`, `plugin`, or `instruction`. Exclude fixed platform objects from candidates and explain them in `coverage`. Task categories are neither dependency edges nor effectiveness scores.
- Plugins require `scope:plugin`, `kind:plugin`, a unique `plugin.id`, and `changes:[]`. Optional `plugin.version`, `components`, `inventoryStatus`, and `instructions` describe the whole package, installation snapshot, and original host's management method. Executable controls only enable or disable the whole plugin; they do not uninstall, update, revoke service authorization, or rewrite internals. If the official interface is unavailable or the target and scope cannot be established, retain advice with a concrete blocker rather than reporting success.
- Before authoring candidates, resolve the physical source, inspect `.codex-plugin/plugin.json` / `.claude-plugin/plugin.json` in that directory and its ancestors, and establish installation ownership. A location under a skills directory does not establish an independent skill. The exported `protectedSource(path)` in `scripts/engine.mjs` can check execution protection. Classify plugin-owned content as a whole plugin recommendation; do not remove its manifest, weaken protection, or present a blocked candidate as completed implementation.
- Represent prompts and rule files such as AGENTS.md or CLAUDE.md as `kind:instruction`, `scope:user` or `project`, and input `changes:[]`. Preserve their actual file paths in `sources` and evidence. Rule writes derive only from explicitly writable revisionDraft input, never from disguised skill directories or arbitrary file-change lists.
- Use one ID per logical object, combining aliases of the same source into `sources` and the corresponding `changes`. Write paths belonging to different items must not overlap or contain one another. Do not widen source boundaries to evade restrictions.
- For a standalone skill revision, the original directory must exist and `candidate` must identify a complete standalone skill package. For disablement, use `candidate:null`. Treat a merge or split as one item covering all changes: null for removed source directories and complete candidates for new targets. An occupied new target is a conflict, not permission to overwrite. Keep, Undetermined, and advice-only items may omit `changes` or use an empty array. A local advice-only item with a definite recommendation may record acceptance, but has no execution plan and cannot be applied. To execute it later, prepare a new plan with complete candidates; do not add mutations after acceptance.
- The host checks calls from retained objects to changed objects and verifies that each item can be applied and restored independently. Include reference migrations in the same merge or split item when the existing operation accurately represents all coupled changes. Otherwise preserve compatible entrypoints, remove cross-item dependencies, or provide advice only. Correctness cannot depend on asking the user to select every item in a particular order; do not expand provenance or authority boundaries. The executor checks files and paths, not semantic dependencies.
- Keep candidates and run directories outside discovery roots, retaining resources and executable permissions. A linked source root may become an independent candidate copy. Nested resource links require a separately defined boundary; this version blocks execution rather than silently dereferencing them.
- `validation.status` is `passed` or `unknown`. Record checks actually performed; explain incomplete or failed checks and never label them passed. Optional `sourceFingerprints` describes read-only inventory coverage. The executor computes its own complete-package fingerprints instead of trusting supplied hashes.

## Freeze and decide

Preparation creates `plan.json`, `state.json`, `originals/`, and `candidates/`. It freezes recommendations, source and candidate fingerprints, real root paths, and link information. Fingerprints cover relative paths, contents, sizes, and permissions. Automatic candidate checks cover name/description and local Markdown links; the host remains responsible for relevant script behavior, implicit references, and content correctness. Preserve failed preparation for diagnosis; correct the input and use a new directory without overwriting backups.

| Concept | Meaning |
|---|---|
| Recommendation | Keep, Revise, Disable, or Undetermined; separate from the user's decision |
| `selection` | `none`, `approved`, or `deferred`; accepting a recommendation does not execute it |
| `decisionAllowed` | A supported, actionable recommendation exists; Keep and plugin advice can be accepted, Undetermined cannot |
| `executionMode` | `workbench`: local skill or rule execution; `host`: original host; `none`: no change; `unavailable`: no executable plan. Host mode alone does not establish executability; check `executable` |
| `executionState` | Executable local items and plugin controls: `ready`, `applied`, `running`, or `problem`; otherwise null |
| `lastOutcome` | The latest operation result and history, not a replacement for current state; plugin snapshots do not prove live installation or loading |
| `effectiveState` | Verification of current files or host configuration. A configuration write does not establish that the current session has reloaded it; absent evidence, loaded state remains unknown |

Both views share the plan, decisions, and history. Filtering does not revoke acceptance: hidden executable items remain in the full pending-application list. Count accepted but non-executable rules and plugins separately as awaiting implementation, never as executed; an empty execution queue must not hide them. Text diffs preview at most 200 KB per side and identify truncation. Binary previews show size and hash; complete files remain in the candidate directory.

Only the user's Apply selected action authorizes mutations for accepted items in the frozen plan. Restore selected is also a user action; never operate it on their behalf or bypass it through the API. Do not add a second chat approval outside those controls. Re-prepare when a source, candidate, or plan changes; do not generate additional changes after acceptance. Account for each discovery entrypoint rather than claiming all copies are disabled after handling one.

## Failure, restoration, and service behavior

Before execution, verify real directory paths, sources, candidates, and backups; links must not redirect internal directories. Journal each item's operations, archive originals, then place candidates. Roll back a failing item and stop later items; preserve earlier successes. A merge or split is one unit. Preserve interrupted state without automatically replaying unfinished work.

Rule files share the history, backups, source/candidate fingerprint checks, and restore-conflict detection. Verify the written file and never restore over later user edits. Plugin execution uses `scripts/plugin-host.mjs` with the official Claude Code CLI or Codex app-server configuration interface, never direct TOML rewrites or plugin cache operations. Before Apply, verify the frozen target, scope, and before state; before Restore, verify the post-apply state, then restore the prior enabled boolean and read it back. Restoration returns the enabled state in that scope, not the configuration file byte for byte. It does not remove a newly introduced override, roll back a plugin version, restore service authorization, or prove hot loading. Stop and preserve records when host capability or state is uncertain.

The Codex adapter requires `plugin/installed` evidence of local/git/npm installation with an existing local marketplace path. It rejects platform, remote/workspace-managed, administrator-restricted, or disabled configuration layers; writes use `config/value/write` with the exact filePath, keyPath, and expectedVersion. Claude Code uses the exact plugin ID and `--scope`; both enablement and disablement are blocked when manifest dependencies could enable additional plugins during restoration, or the manifest cannot be read to establish that boundary. Successful control verifies configuration, reports `reloadRequired:true`, and leaves session loading unknown until independently established.

Restoration verifies archives and current files. Preserve the scene rather than overwriting later edits, occupied targets, changed backups, or redirected links. Archive the current revised package during restoration as well; do not permanently delete packages. Successful restoration returns the item to `ready` and `none`, permitting a new acceptance and application while retaining history. Fully rolled-back failures remain ready; incomplete rollback, interruption, and restore conflicts need attention. Decisions cannot change during execution. An applied item also remains locked until restored; completed items do not prevent decisions on other, unapplied items.

Use one service per run directory; the default user-level lock permits one file task at a time. Listen on a random port at `127.0.0.1`. Persist the token in `session.json` and reuse it after restart. The API requires a Bearer token; POST requests also require matching Origin and JSON Content-Type. Use unique alphanumeric/hyphen `requestId` values. Repeating an ID with the same parameters does not execute twice; changing its parameters is rejected. Disk records establish execution state, not localStorage. Reopening or reconnecting does not prove a new session has discovered changed skills or that already-loaded instructions have changed.

## Temporary acceptance

Run `node <prune-directory>/scripts/prune.mjs demo --count 40 --out <new-temporary-directory>`, then start the service with the emitted command. Use temporary files for skill and rule acceptance. Test plugin controls with isolated host doubles or a demonstrably isolated temporary plugin environment, never real user plugins. Check Apply, Restore, drift rejection, accepted advice counts, and unknown session-loading status. Demo and test-double results are not the user's inventory, proof of real host mutations, or evidence of model effectiveness.

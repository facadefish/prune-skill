<p align="center">
  <img src="media/prune-flow.svg" alt="Prune: review, choose, apply, restore" width="900">
</p>

<h1 align="center">Prune · Keep the useful parts</h1>

<p align="center">Review AI skills against real tasks. Inspect the evidence and diffs locally. You decide what changes.</p>

<p align="center">
  <a href="README.md">简体中文</a> ·
  <a href="https://github.com/facadefish/prune-skill/releases/latest">Download complete language packages</a> ·
  <a href="LICENSE">Apache-2.0</a>
</p>

> Prune does not edit a skill merely because an agent recommends it. The agent prepares a frozen plan; you inspect it in a local workbench and explicitly select **Apply** before a real file or supported plugin setting changes.

## What it does

| Capability | Result |
| --- | --- |
| Task-aware review | Judge a skill by its contribution to your tasks, model, and host. Preserve useful methods and resources; correct broad triggers, conflicts, and unnecessary procedure. No length-based scoring. |
| Reviewable choices | Browse source evidence, recommendations, complete candidates, file diffs, and actual execution state in the workbench. |
| Reversible files | Freeze fingerprints and backups for independent skills and standalone rule files; detect drift before Apply or Restore. |
| Whole-plugin controls | Review a plugin as one object. Enable or disable it only through a supported host's official interface, without rewriting plugin internals. |

![Prune workflow](media/workflow.svg)

## Get started

You need **Node.js 22.19+**, a local browser, and an agent that loads skills. Prune has no npm runtime dependencies, model API key, cloud service, or telemetry. The agent makes semantic judgments; bundled scripts freeze plans and run the local workbench.

1. Download **one** complete package, `prune-en.zip` or `prune-zh.zip`, from [Releases](https://github.com/facadefish/prune-skill/releases/latest). Unzip it; the result is a `prune/` folder containing `SKILL.md`, `scripts/`, `references/`, `assets/`, and `agents/`, alongside `LICENSE` and `NOTICE`.
2. Place the whole folder in your host's personal skills directory:

   | Host | macOS / Linux | Windows |
   | --- | --- | --- |
   | Codex | `~/.agents/skills/prune/` | `%USERPROFILE%\.agents\skills\prune\` |
   | Claude Code | `~/.claude/skills/prune/` | `%USERPROFILE%\.claude\skills\prune\` |

   These paths follow the [Codex](https://learn.chatgpt.com/docs/build-skills) and [Claude Code](https://code.claude.com/docs/en/skills) documentation. Back up an existing `prune/` folder before replacing it; do not overlay two versions. Restart the host session if it has not discovered the skill yet.
3. Ask your agent:

   > Use $prune to review the skills I name against my current tasks. Show the evidence, proposed changes, and file diffs in the Prune workbench so I can choose what to apply.

An audit leaves evaluated originals untouched. If you ask for an implementation, the agent prepares complete candidates first; you still make the final workbench selection.

### Try a safe demo

From the repository root:

```text
node skills/prune/scripts/prune.mjs demo --out .prune-demo
node skills/prune/scripts/prune.mjs serve --run .prune-demo/run
```

Open the **complete localhost URL** printed by `serve`. The demo operates only on generated fixtures inside `.prune-demo/`, so you can explore recommendations, diffs, Apply, and Restore without touching installed skills. Stop the service with `Ctrl+C`. Do not share the full URL: its fragment contains the local session token.

## How it works

```text
Your task + skill/rule/plugin sources
             ↓  semantic review by your agent
Frozen plan: evidence + fingerprints + proposed changes
             ↓  local workbench
Your selection → Apply → disk/host readback → optional Restore
```

For integrations, use `prepare --input <plan.json> --out <new-run-directory>` and then `serve --run <run-directory>`. The [execution contract](locales/prune/en/references/contract.md) defines the input and safety boundaries. Keep run directories outside skill-discovery roots and public repositories, on the same filesystem as skills that may be archived. A revised plan needs a new selection; previous decisions never authorize new files.

The UI separates **accepted advice**, **verified disk/host configuration**, and **loading in the current model session**. One is not proof of another.

## Compatibility and limits

- **Operating systems:** Standard-library Node.js runtime targeting Windows, macOS, and Linux. Filesystem and symlink behavior can vary; rely on readback and explicit error states.
- **Hosts:** Core review and the workbench do not need a plugin CLI. Optional plugin controls support local user-scope Codex plugins and Claude Code user/project/local plugins where the host interface is available. Unsupported or ambiguous targets remain advice-only.
- **Privacy:** The server binds only to `127.0.0.1` on a random port and uses a per-run token. No telemetry or automatic upload. Real plans, history, and tokens are never part of this repository or its release archives.
- **Authority:** Preparation does not authorize mutation. The user must select and Apply the current frozen plan, and initiate Restore separately. Plugin uninstall, updates, and internal rewrites are unsupported.
- **Evidence:** Tests establish specific operation/restore behavior, not that a reviewed skill improves model performance or that a running model session hot-reloaded a changed file.

## Develop

[`skills/prune/`](skills/prune/SKILL.md) is the complete Chinese source and shared runtime. [`locales/prune/en/`](locales/prune/en/SKILL.md) holds English instruction sources. The packager produces two standalone alternatives:

```text
npm run check
node scripts/package-prune.mjs .release/local
```

`packages.json` records relative package paths and content fingerprints. Official-host integration checks require an isolated host installation and are opt-in.

Do not include real plans, session tokens, private skill content, or personal file paths in public issues. See [SECURITY.md](SECURITY.md) for private reporting. Apache-2.0 licensed; independent of OpenAI and Anthropic.

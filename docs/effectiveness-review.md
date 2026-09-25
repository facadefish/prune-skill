# Effectiveness review and regression scenarios

Reviewed baseline: [`3a3b390`](https://github.com/facadefish/prune-skill/tree/3a3b39014c2bde760792a8a693db1f799655eab4). Scope: the instructions that guide Prune's semantic decisions and candidate validation. This is a source review and a manual walkthrough of constructed scenarios, not a model benchmark. It establishes instruction coverage, not a measured improvement in task success, routing, speed, or token use.

## Findings

The existing design has useful safeguards: whole-object review, task-specific incremental value, retained substitutes when disabling skills, dependency checks before moving resources, and separate states for advice, file changes, and session loading. These should remain. The workbench is a delivery and execution mechanism; its tests cannot establish the quality of a recommendation.

### P2: Failure diagnosis does not distinguish selection from execution

[R2](../skills/prune/references/strong-model-review-rules.md) already asks for intended and neighboring tasks, but the baseline does not explain how to diagnose a reported ineffective skill. A missing installation, an overly broad description, a broken procedure, and an unavailable tool need different corrections. Rewriting the description after a tool failure can change routing without repairing the failure.

Change: add a short distinction between discovery, selection, execution, and prerequisites. Use supplied, authorized evidence; absent traces remain a hypothesis. This is an instruction gap, not an observed failure rate.

### P2: Candidate checks lack an explicit task outcome comparison

Baseline R7 asks for trigger, constraint, and reference checks, but does not specify how to connect them to concrete tasks before and after a meaningful rewrite. [`validatePackage`](../skills/prune/scripts/engine.mjs) checks the package, basic metadata presence, and local Markdown references; it cannot detect the deletion of a necessary workflow condition. A successful package check is compatible with a semantic regression.

Change: derive a few relevant scenarios before rewriting, then compare original and candidate against observable outcomes and prohibited side effects. Distinguish skill selection from completion and inspect content rather than merely the presence of a file or heading. Use the existing `validation` fields; no schema, scoring, or mandatory test matrix is needed. Assessment-only requests describe future checks without pretending to validate a candidate.

### P3: The optional path to measured claims is underspecified

Baseline R7 correctly says that static checks do not demonstrate model gains and does not start A/B runs by default. It does not specify baseline contamination, matched conditions, environment failures, or tuning on the same examples. These omissions matter when a user actually requests a comparison.

Change: describe those checks conditionally, including original-versus-candidate and with-versus-without baselines, retained raw outputs, final unused tasks after iterative tuning, and unknown telemetry. Ordinary semantic review remains sufficient for reasoned advice.

## Comparable public implementations

Sources are pinned to the inspected revisions. These are comparisons of particular files, not rankings of whole projects. No upstream code or runtime dependency is incorporated.

| Inspected source | Useful mechanism | Application and limit in Prune |
| --- | --- | --- |
| Anthropic [`run_eval.py`](https://github.com/anthropics/skills/blob/33375500bcea98d610eb30ce10ac4e59b89c390d/skills/skill-creator/scripts/run_eval.py) | Measures selection for positive and negative queries via skill/read events. | Separate routing evidence from output quality. Do not treat a selection event as task success or import its Claude-specific runner. |
| Anthropic [`grader.md`](https://github.com/anthropics/skills/blob/33375500bcea98d610eb30ce10ac4e59b89c390d/skills/skill-creator/agents/grader.md) | Inspects actual artifacts and challenges assertions that accept superficial output. | Check task content and prohibited effects, rather than headings or file existence alone. |
| Anthropic [`run_loop.py`](https://github.com/anthropics/skills/blob/33375500bcea98d610eb30ce10ac4e59b89c390d/skills/skill-creator/scripts/run_loop.py) | Separates training examples from a test partition and hides test fields from the description improver. | Keep unused tasks for final checks when iterating. That implementation also uses test scores to select an iteration; Prune should not describe repeatedly consulted selection data as an untouched final test. |
| Agent Skills [`evaluating-skills.mdx`](https://github.com/agentskills/agentskills/blob/69ef37e9424c0a7ea9dd2293b559e43ec8176379/docs/skill-creation/evaluating-skills.mdx) | Uses realistic prompts, expected outputs, baseline artifacts, and outcome assertions. | Adopt concrete scenarios, but keep model runs optional. A child task is not automatically uncontaminated: inherited rules and skill visibility still need checking. |
| Fastxyz [`prompt-evaluator.ts`](https://github.com/fastxyz/skill-optimizer/blob/7fe480ddec98d8b687acb62a4d137de0f51f9211/src/benchmark/prompt-evaluator.ts) | Evaluates sections, formats, keywords, and structure; generates some criteria from skill text. | These can check a specific format contract. They cannot establish semantic correctness or incremental value and should not become Prune's ranking system. |

## Constructed scenarios for reviewer walkthroughs

These scenarios are author-created, public, and deliberately small. They are not private user examples or executed agent transcripts. Reviewers can use them to check a proposed instruction change without starting model calls. A future agent evaluation must use the same case inputs independently, preserve outputs, and report its actual method; this document alone supplies no agent pass rate.

### 1. Broad selection with a retained useful capability

- User request: “Review and revise the description of `pdf-forms` for filling existing PDF forms.”
- Original description: “Use for documents, forms, reports, and data.” The body fills existing PDF form fields and reports unresolved fields.
- Candidate description: “Fill fields in an existing PDF form and report unresolved fields. Use for PDF form completion.” The body is unchanged.
- Checks: “Fill the attached PDF form from these supplied values” should fit; “Summarize this plain-text report” should not. Reporting unresolved PDF fields must remain available.
- Walkthrough: R2 and R7 support comparing these boundaries while preserving the body. This predicts applicability only; neither actual host discovery nor task completion has been run. A record must say `static walkthrough`, not `routing accuracy improved`.

### 2. Shorter instructions that lose a necessary constraint

- User request: “Simplify this CSV cleanup skill; keep original input files intact.”
- Original: “Write the cleaned result to a separate file. Preserve the input. Count rows with missing email values; do not invent email addresses.”
- Bad candidate: “Clean the CSV and save it.”
- Revised candidate: “Save a cleaned copy, preserving the input; count missing emails without inventing values.”
- Input: a CSV with `id,email` and rows `1,supplied-address` and `2,` (the nonempty value is a public placeholder).
- Checks: the expected missing-email count is one; the original must remain byte-identical; no email may be fabricated. Static inspection rejects the bad candidate's lost requirements and finds them retained in the revised candidate. It does not show that either version was executed successfully.

### 3. A tool failure is not a description defect

- User request: “This image skill was selected, but produced no image. Review why it failed.”
- Supplied synthetic trace: skill selected; invoked its documented renderer; renderer returned `command not found`.
- Skill procedure: use that renderer to produce an image and verify the file.
- Check: identify the unavailable prerequisite and propose checking its installation or documented alternative. Do not broaden the description or claim that an image was generated. Do not install anything from this review request.
- Walkthrough: the new R2 diagnoses the evidenced failure layer; R7 separates the environmental failure from a content-quality comparison. A corrected description alone would not address the supplied evidence.

### 4. A superficial check accepts an incorrect artifact

- Task: report the number of missing emails in scenario 2.
- Observed fixture artifact: `{"missing_email_count": 0}`. It is a constructed artifact, not model output.
- Weak check: a JSON file exists and contains `missing_email_count`.
- Meaningful check: the count equals one, derived from the input, and the input remains unchanged.
- Walkthrough: the artifact passes the weak check but fails the content check. R7 now states that existence and keywords alone are insufficient. The actual failed check must not be marked `passed`; the current contract records failed or unperformed checks as `unknown` with a clear reason in `detail`.

### 5. A nominal no-skill baseline still inherits the skill

- Requested comparison: a skill that teaches a project-specific validation command versus no skill.
- Supplied setup: the baseline omits the skill path but inherits a project instruction containing that same command; a new child task is used for each run.
- Check: do not attribute equal outcomes to the skill having no incremental value. Mark the comparison as contaminated; either establish an eligible isolated comparison within the authorized scope or retain the limitation.
- Walkthrough: the added conditional R7 addresses the inherited content directly. No baseline or candidate model run was performed during this audit.

### 6. Advice only, with no candidate

- User request: “Only assess whether this CSV skill needs changes.”
- Inputs: the original instructions from scenario 2 and a report of concern about overwriting input; no candidate exists.
- Check: explain that the source already preserves input, seek supplied execution evidence only if needed to diagnose a reported failure, and describe any useful future check as unperformed. Do not invent a candidate, claim its validation, or apply files.
- Walkthrough: R7 now explicitly distinguishes future checks from candidate validation; the existing entrypoint still determines the requested delivery and authority boundaries.

## Verification and follow-up

Manual comparison covers both Chinese and English R2/R7 changes against the scenarios above. The additions provide explicit guidance for these decisions; they do not prove that the previous skill would fail or the revised skill would succeed in an actual session. Existing entrypoints, metadata, resource paths, R1/R3–R6/R8–R9, execution contract, runtime, and workbench remain unchanged.

Package validation and the repository checks establish metadata/reference integrity and existing runtime behavior only. No real installed skill, plugin configuration, host integration, or model comparison is part of this change. No measured effectiveness result is claimed.

Local verification for this proposal: Windows with Node.js 24.15.0; `npm run check` passed with 76 tests passing and two opt-in official-host integration tests skipped. Both standalone language packages built and passed skill frontmatter validation. No runtime or workbench behavior changed, so this proposal does not require new browser Apply/Restore acceptance.

If comparative performance is requested later, choose representative tasks and the specific claim first, use frozen old/new packages and comparable environments, verify isolation, and preserve the outputs. Add new cases when an observed failure justifies them. Do not build an automatic optimizer, generic score, or full evaluation platform merely to review a few instructions.

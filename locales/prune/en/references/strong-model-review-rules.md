# Review rules

Judge against the user's tasks and actual model and host. Apply only the rules that affect the decision. Do not score skills, count rule matches, or require an R1–R9 checklist in every report.

## R1 · Incremental value

Identify the specific contribution and any overlap with existing instructions or capabilities. Domain knowledge, preferences, reliable methods, resources, and tool integration can all be valuable. Length, the presence of scripts, usage frequency, or the assumption that a model already knows something cannot decide the recommendation on their own. Preserve a useful specialization while correcting problematic instructions within it.

For a collection, assess coverage against the set that would remain after the recommendations. Distinguish substitutes from complementary capabilities and explain which capabilities the relevant tasks should use. A substitute offered as a reason to disable an object must remain available, retained, and suitable for that task; two objects cannot each justify disabling the other. If the substitute's contents or availability are unknown, disclose the gap rather than asserting coverage.

## R2 · Accurate selection

Describe the capability and its actual activation conditions. Remove catchalls that pull the skill into unrelated tasks and modifiers that add no distinction. Check competing triggers across skills. After revising a description, consider an intended task and a nearby task that should not activate it. Optimize discrimination, not an arbitrary length or compression ratio.

When the user reports that a skill does not work, distinguish host discovery, selection, execution after selection, and unavailable tools or resources. Diagnose from records provided within the authorized scope. Without execution evidence, label the cause as a hypothesis; do not collect private sessions on your own. Rewriting a description cannot fix installation, missing tools, or execution logic. Propose a correction at the layer that failed.

## R3 · Selective loading

For multiple workflows, route to the material needed for the current task. Keep shared invariants and discoverable resource paths. Moving repeated content into an always-required reference does not make loading selective. A short, single workflow need not be split; restructuring must preserve prerequisites, links, and dependencies.

Before removing or relocating an entrypoint, resource, or script, check references and calls from other retained objects within the review scope; valid links inside the candidate alone are insufficient. Coupled changes must fit the execution contract's single-item apply and restore boundaries, or preserve compatible entrypoints or independently usable items. If dependency coverage is uncertain or the existing execution model cannot represent the change safely, disclose the gap and offer advice only. Do not present dependent steps as independently selectable executable items.

## R4 · Necessary constraints

Retain the objective, deliverable, non-obvious context, and necessary operation order. Remove or qualify a procedure only when you can explain the irrelevant work it imposes. Strict wording alone is not a defect: transaction order, format contracts, tool limitations, and explicit user choices may need precise enforcement.

## R5 · Model and host context

Distinguish host-provided behavior, official model guidance, and the skill's specialized contribution. Verify current official sources for capability claims that could change the recommendation; mark unknowns rather than treating Astra-specific advice as universal. Shared skills should retain a common contract, with conditional guidance only for supported model differences.

## R6 · Project instructions

Check for duplication or conflicts among skills, task prompts, and relevant project rules. Correct the owning instruction layer instead of adding a counter-instruction inside a skill. State when referenced documents are needed. Maintain one authoritative statement per rule and verify that references and factual assumptions remain valid.

## R7 · Proportionate validation

Match checks to the change and the claim. For text revisions, inspect activation boundaries, retained constraints, and references. Test relevant behavior when scripts change, and retain required project checks. Repeat or expand validation only for new changes, failures, or unresolved concerns. Semantic review does not initiate model A/B runs by default. File checks, author review, and tool tests do not establish improved model performance.

For revisions that change selection or workflow, derive a few discriminating scenarios and expected outcomes from the user's tasks and original skill before rewriting; compare the original and candidate afterward. Reuse provided examples where possible. Label constructed examples rather than presenting them as observed usage. Choose ordinary tasks, confusing neighboring tasks, or failures involving necessary constraints according to the change; do not impose a case quota or a full matrix on every object. Wording-only corrections need no separate case suite. For assessment-only requests, describe useful future checks without claiming to have validated a nonexistent candidate.

A scenario identifies the input and necessary context, observable result or prohibited side effect, evidence from the original and candidate, and the check method and actual result. Check correct content, retained capabilities, and stopping conditions, not just keywords, headings, file existence, or skill invocation. Judge correct selection separately from task completion. The original may fail on the defect being corrected; unrelated capabilities and constraints must survive. Reuse existing `validation` records: make static walkthroughs, tool checks, and model runs explicit in `name` / `detail`. `passed` means only that the named check actually passed. Use `unknown` with the reason for unperformed or failed checks; never report a walkthrough as an execution result.

Only when the user requests measured comparisons, establish the tasks, inputs, success conditions, budget, and stopping scope separately. Use the original version as the baseline for a revision. For incremental value with versus without the skill, verify that conversations, project rules, memory, or other skills have not supplied its content to the baseline; starting a new child task alone does not establish isolation. Keep the model, host, tools, other instructions, and inputs comparable, and preserve actual outputs and failures. Separate environmental failures such as missing tools or timeouts from content failures; mark an invalid comparison unknown. If iterating against cases, reserve tasks not used during rewriting for the final check. Report individual outcomes and sample limitations; unavailable token, cost, or loading telemetry remains unknown.

## R8 · Decision boundaries

Replace blanket step-by-step approval requirements with concrete authorized work, user decisions, and stop conditions. Allow preparation and validation within scope; greater model capability does not confer broader authority. Preserve real mutation, publication, and source-drift boundaries. For installed originals and plugins, follow the authority rules in the entrypoint.

## R9 · Completion boundaries

For execution requests, define the deliverable, observable acceptance conditions, and responsibility for in-scope corrections. For exploration, define the questions and stopping scope. When the user asks only for a review or proposal, that deliverable is the endpoint. A recommendation to revise is not authorization to implement it; avoid unbounded instructions to keep working until perfect.

## Reach a recommendation

- **Keep:** A concrete contribution is supported, with no identified issue requiring a change.
- **Revise:** Preserve the contribution and explain the located problem, proposed correction, and retained capabilities. Prepare complete candidates when the user wants pruning, optimization, or revision implemented; give recommendations for assessment-only requests. Follow the intended outcome, not a particular verb. Explain merges and splits as revisions.
- **Disable:** The use case and contents are understood but no clear contribution remains, or existing capabilities demonstrably cover it. Explain what may be lost and recommend reversible disablement; do not claim proven ineffectiveness.
- **Undetermined:** After the necessary review, missing facts could still change the recommendation. Identify those facts and the smallest useful check instead of forcing a conclusion. Available material that has not been read is unfinished review, not this outcome.

Connect the task, source evidence, reasoning, potential losses, and checks actually performed in a form the user can readily read. Cite rule IDs when useful. After making the semantic judgment, convert it into execution-contract fields and present it in the workbench for the user to choose; prose is supplementary. Deliver prompts and project instructions as standalone file revisions, never disguised skill packages. Plugin control plans enable or disable whole plugins, without embedding internal skill rewrites. Distinguish accepted advice, verified file or configuration state, and loading in the current session; do not collapse these into a claim of effectiveness without the corresponding evidence.

Basis: [OpenAI, Rethinking skills and prompts for GPT-6 Astra](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra), published September 11, 2026; checked September 15, 2026. R2–R9 operationalize the article for this project. R1 and recommendation boundaries come from Prune's product requirements. These rules are not empirical evidence of model gains.

# Issue tracker: GitHub

Issues for this repository live in [facadefish/prune-skill](https://github.com/facadefish/prune-skill/issues). Use `gh` from this checkout; verify the remote before any write.

## Issues

- List open issues: `gh issue list --state open --json number,title,labels,updatedAt`.
- Read an issue and its discussion: `gh issue view <number> --json number,title,body,comments,labels,author,state`.
- Create or comment on an issue with `gh issue create` or `gh issue comment`; use `--body-file` for multiline text.
- Change labels with `gh issue edit <number> --add-label <label>` or `--remove-label <label>`.
- Close an issue with `gh issue close <number> --comment <reason>`.

Read each issue's comments before making a triage decision. A state label alone never starts an agent or a scheduled job.

## Pull requests

**PRs as a request surface: no.** External PRs are not included in `/triage` discovery. A specifically named PR can still be examined; use `gh pr view <number> --json number,title,body,comments,labels,author,state` and `gh pr diff <number>`. Use `/code-review` for code review. Never enable automatic merging.

If PR discovery is later enabled, use `gh api repos/facadefish/prune-skill/pulls?state=open` to read `author_association`; `gh pr list --json` does not expose that field.

## Skill conventions

- "Publish to the issue tracker" means create a GitHub issue in this repository.
- "Fetch the relevant ticket" means read the issue and its comments with `gh issue view`.

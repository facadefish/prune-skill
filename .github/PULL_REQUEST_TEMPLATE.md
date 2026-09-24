## Change

Describe the problem, the smallest change, and the related issue (for example, `Closes #123`).

## Verification

- `npm run check`:
- Standalone Chinese and English package build, if runtime or packaging changed:
- Browser Apply and Restore with disposable objects, if the workbench changed:
- Operating systems and Agent host integrations actually tested:

## Review boundaries

- Does this affect real file writes, Restore, path or fingerprint checks, user selection and Apply, plugin host controls, or the execution contract? If so, explain the behavior and request a maintainer decision.
- Confirm that the PR contains no real review plans, private skills, local paths, tokens, credentials, or generated run directories.

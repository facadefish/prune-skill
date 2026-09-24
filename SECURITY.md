# Security

Prune serves its workbench on `127.0.0.1` with a per-run token. The complete local URL contains that token: treat it like a local capability and do not post it in issues, logs, screenshots, or public examples. Review plans can contain private file paths and instruction text; keep run directories outside Git repositories and do not attach them to bug reports without redaction.

Preparing a plan does not modify evaluated files. The workbench requires a fresh selection and an explicit Apply action for each frozen plan. It checks source and candidate fingerprints before file changes, journals operations, and offers conflict-aware Restore. Plugin controls call the host's official interface and verify the returned state; a changed on-disk configuration does not prove an already-running model session has reloaded it.

To report a vulnerability, use [GitHub private vulnerability reporting](https://github.com/facadefish/prune-skill/security/advisories/new) for this repository. Please do not include real credentials or private plans in a public issue.

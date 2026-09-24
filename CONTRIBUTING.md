# Contributing and maintenance

Bug reports should include a minimal reproduction with disposable objects. Use the issue forms for defects and proposals. Report vulnerabilities through the private channel in [SECURITY.md](SECURITY.md). Never publish real review plans, skill contents, session URLs, local paths, or credentials.

Keep pull requests focused and link the relevant issue. Follow [AGENTS.md](AGENTS.md) for source layout and required checks. State which operating systems, browsers, and Agent host integrations were actually tested; do not treat an unrun check as passed.

Maintainers triage issues, ask for missing reproduction details, and prepare fixes without requiring a decision for each routine step. A maintainer decision is required for changes to Prune's user authority, real file writes, Restore, path and fingerprint validation, plugin host controls, execution contract, public security handling, and releases. These changes need evidence appropriate to their behavior, including disposable browser checks when the workbench changes.

Every merge is a deliberate maintainer action. Passing CI or an automated review never merges a pull request. Maintainers do not automatically close issues because they are old.

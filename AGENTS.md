# Prune contributor rules

- `skills/prune/` is the complete Chinese skill and the single runtime source. `locales/prune/en/` contains only the four English instruction files. Build both standalone language packages with `scripts/package-prune.mjs`.
- Keep the two instruction variants equivalent in purpose, safety boundaries, and user authority. Never translate away a capability or turn a review into permission to write.
- Do not commit real review inputs, plans, session tokens, personal paths, credentials, installed-skill snapshots, or generated run directories. Tests use disposable fixtures only.
- A real skill or rule file changes only after the user chooses the frozen item and clicks Apply in the workbench. Restore also requires a user action. Plugin enablement uses the original host's official interface; plugin internals remain untouched.
- Before changing runtime or packaging, run `npm run check`. Workbench changes also need browser checks with disposable objects, including Apply and Restore. State which operating systems and host integrations were actually tested.

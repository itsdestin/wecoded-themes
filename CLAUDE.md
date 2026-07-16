# CLAUDE.md

wecoded-themes is the YouCoded community theme registry. `registry/theme-registry.json` is auto-generated from `themes/{slug}/manifest.json` on merge to main — don't edit it by hand. Theme PRs must pass the CI checks (15 required CSS tokens, CSS safety rules, size <10MB, slug uniqueness) and the contrast thresholds in `scripts/audit-contrast.mjs`.

## Workspace conventions (read this if you opened this repo standalone)

This repo is one component of the YouCoded product. Development is coordinated from the **youcoded-dev workspace repo**: https://github.com/itsdestin/youcoded-dev — if it isn't on this machine, clone it and run `bash setup.sh` (it clones every sub-repo and carries the working rules, path-scoped rules, and cross-repo docs).

- **Lifecycle documents** (specs, plans, handoffs, investigations) do NOT live in this repo — they go to the workspace: `youcoded-dev/docs/active/` (in flight) → `youcoded-dev/docs/archive/` (done).
- **Planning** happens in the workspace `ROADMAP.md` — one roadmap for the whole product.
- Registry/theme invariants live in the workspace rule `youcoded-dev/.claude/rules/registries.md` + `youcoded-dev/docs/registries.md`.

# Contributing Themes

## Submitting a Theme

1. Fork this repo
2. Create a new folder under `themes/` with your theme's slug (kebab-case, e.g. `my-cool-theme`)
3. Add a `manifest.json` and an `assets/` folder with any images/SVGs
4. Open a PR to this repo

### Theme Structure

```
themes/your-theme-slug/
├── manifest.json     # Required — theme definition
└── assets/           # Optional — wallpapers, patterns, icons, mascots
    ├── wallpaper.jpg
    ├── pattern.svg
    └── ...
```

### Manifest Requirements

Your `manifest.json` must include:
- `name` — display name
- `slug` — kebab-case identifier (must match folder name)
- `dark` — boolean (true for dark themes, false for light)
- `tokens` — all 15 color tokens (canvas, panel, inset, well, accent, on-accent, fg, fg-2, fg-dim, fg-muted, fg-faint, edge, edge-dim, scrollbar-thumb, scrollbar-hover)

Optional but recommended:
- `author` — your name or GitHub username
- `description` — a short description of the theme's vibe
- `created` — date string (YYYY-MM-DD)

### Rules

- **No external URLs** in `custom_css` — all assets must be bundled locally
- **No `@import`** rules in CSS
- **Total theme size** must be under 10MB
- **Slug must be unique** — check existing themes before submitting
- Theme must pass the CI validation checks automatically

### Publishing from YouCoded

You can also publish directly from the app:
1. Create a theme using the theme builder or customizer
2. Go to Settings → Themes → select your theme
3. Click "Publish to Marketplace"
4. The app will create the PR for you (requires `gh` CLI)

## License & Submission Terms

This repository is licensed under the **Apache License, Version 2.0** — see [LICENSE](./LICENSE).

By opening a pull request to this repository, you certify that:

1. **You wrote the theme yourself, or otherwise have the right to submit it.** Any third-party assets you include (wallpapers, images, fonts, icons) are either your original work, in the public domain, or licensed under terms that permit redistribution under Apache 2.0 — and any required attribution is included in your `manifest.json`.
2. **You agree that your contribution is licensed under Apache 2.0**, the same terms as this repository, and that you grant the maintainers and downstream users the rights described in that license — including the right to redistribute your theme through the YouCoded app and registry.
3. **Your contribution does not include malicious content** — no remote-loaded code, no obfuscated scripts, no tracking pixels, no attempts to exfiltrate user data. Themes are styling assets; they should not behave like applications.

If you can't agree to all three, please don't submit. If you discover that a theme already in the registry violates someone's rights (yours or a third party's), see the takedown process in the main YouCoded [TERMS.md](https://github.com/itsdestin/youcoded/blob/master/TERMS.md).

## Developer Certificate of Origin

Every commit in a pull request must carry a sign-off line:

```
Signed-off-by: Your Name <you@example.com>
```

`git commit -s` adds it for you, using the name and email in your git config. This is the [Developer Certificate of Origin](https://developercertificate.org/) — a one-line statement that you have the right to submit the work under this repository's license.

By signing off you confirm that your contribution — the theme itself, any code, and any preview images or other assets — is submitted under the Apache License 2.0 that covers this repository, and that you wrote it or otherwise have the right to submit it under that license (the same terms listed above). There is no separate contributor agreement; the sign-off is the whole of it.

If a commit is missing the sign-off, you'll be asked to add it before the PR is merged — `git commit --amend -s` fixes the last commit, and `git rebase --signoff` fixes a whole branch.

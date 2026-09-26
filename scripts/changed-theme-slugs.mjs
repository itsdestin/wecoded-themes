#!/usr/bin/env node
// WHY: A PR checkout with missing base history must not turn a theme change into
// an empty slug list and silently skip every manifest/asset/version check.
import { execFileSync } from 'node:child_process';

// WHY --installed-content: preview.png never reaches an installed theme (the app downloads
// only the registry's assetUrls, and build-registry.py leaves the preview out of those), so a
// preview-only change needs no version bump. Only the bump check uses this flag; every other
// check still sees the preview change. Without it, a preview refresh forced a pointless
// "Update available" on every installed copy (PR #35, 2026-09-25).
const args = process.argv.slice(2);
const installedOnly = args.includes('--installed-content');
const [base, head] = args.filter((a) => a !== '--installed-content');
if (![base, head].every((sha) => /^[0-9a-f]{40}$/.test(sha || ''))) {
  console.error('Expected base and head commit SHAs from the pull request event.');
  process.exit(1);
}

let names;
try {
  // WHY: Three-dot diff excludes changes made only on main after the PR branched.
  names = execFileSync('git', ['diff', '--name-only', `${base}...${head}`, '--', 'themes/'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (error) {
  console.error(`Cannot diff PR base commit ${base} against head ${head}: fetch full history before validating themes. ${error.stderr?.toString().trim() || error.message}`);
  process.exit(1);
}

const slugs = new Set();
for (const path of names.trim().split('\n').filter(Boolean)) {
  const slug = path.split('/')[1];
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug || '')) {
    console.error(`Invalid changed theme directory: ${path}`);
    process.exit(1);
  }
  if (installedOnly && path === `themes/${slug}/preview.png`) continue;
  slugs.add(slug);
}
// WHY: This workflow also runs for validator-only PRs. An empty theme list is
// legitimate after a successful diff; missing history is not (the catch above fails).
console.log([...slugs].sort().join(' '));

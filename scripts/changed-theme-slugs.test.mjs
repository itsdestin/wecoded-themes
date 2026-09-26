import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checker = join(repo, 'scripts', 'changed-theme-slugs.mjs');
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

// WHY: pull_request checkout defaults to shallow history. A missing base used to
// produce zero slugs and silently skip the manifest/version/asset checks.
test('changed theme detection fails closed on shallow history and validates a fetched PR', () => {
  const root = mkdtempSync(join(tmpdir(), 'theme-pr-diff-'));
  const source = join(root, 'source');
  const checkout = join(root, 'checkout');
  try {
    mkdirSync(join(source, 'themes', 'morning-rounds'), { recursive: true });
    git(source, 'init', '-q', '-b', 'main');
    git(source, 'config', 'user.name', 'Fixture');
    git(source, 'config', 'user.email', 'fixture@example.test');
    writeFileSync(join(source, 'README.md'), 'base\n');
    git(source, 'add', 'README.md');
    git(source, 'commit', '-qm', 'base');
    const base = git(source, 'rev-parse', 'HEAD');
    git(source, 'switch', '-qc', 'feature');
    writeFileSync(join(source, 'themes', 'morning-rounds', 'manifest.json'), '{}\n');
    git(source, 'add', 'themes');
    git(source, 'commit', '-qm', 'theme');
    const head = git(source, 'rev-parse', 'HEAD');
    execFileSync('git', ['clone', '-q', '--depth', '1', '--branch', 'feature', `file://${source}`, checkout]);

    const shallow = spawnSync(process.execPath, [checker, base, head], { cwd: checkout, encoding: 'utf8' });
    assert.notEqual(shallow.status, 0, 'missing base history must never report success');
    assert.match(shallow.stderr, /base commit|history|diff/i);

    git(checkout, 'fetch', '-q', '--unshallow');
    const complete = spawnSync(process.execPath, [checker, base, head], { cwd: checkout, encoding: 'utf8' });
    assert.equal(complete.status, 0, complete.stderr);
    assert.equal(complete.stdout.trim(), 'morning-rounds');

    // A later main-only edit to another theme is not part of the feature PR.
    git(source, 'switch', '-q', 'main');
    mkdirSync(join(source, 'themes', 'other'), { recursive: true });
    writeFileSync(join(source, 'themes', 'other', 'manifest.json'), '{"name":"other unrelated theme"}\n');
    git(source, 'add', 'themes');
    git(source, 'commit', '-qm', 'unrelated main theme');
    const laterBase = git(source, 'rev-parse', 'HEAD');
    git(checkout, 'fetch', '-q', 'origin', 'main');
    assert.match(git(checkout, 'diff', '--name-only', laterBase, head, '--', 'themes/'), /themes\/other\//);
    const diverged = spawnSync(process.execPath, [checker, laterBase, head], { cwd: checkout, encoding: 'utf8' });
    assert.equal(diverged.status, 0, diverged.stderr);
    assert.equal(diverged.stdout.trim(), 'morning-rounds', 'main-only changes are not PR changes');

    const empty = spawnSync(process.execPath, [checker, head, head], { cwd: checkout, encoding: 'utf8' });
    assert.equal(empty.status, 0, 'a script-only PR may have no changed themes');
    assert.equal(empty.stdout.trim(), '');

    // WHY: The shell assignment must stop CI on missing history, not swallow the
    // helper's exit status and continue with zero slugs as the old workflow did.
    const ciStep = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', `THEMES=$(node "${checker}" "${'0'.repeat(40)}" "${head}"); echo "themes=$THEMES"`], { cwd: checkout, encoding: 'utf8' });
    assert.notEqual(ciStep.status, 0);
    assert.doesNotMatch(ciStep.stdout, /themes=/);

    const workflow = readFileSync(join(repo, '.github', 'workflows', 'validate-theme.yml'), 'utf8');
    assert.match(workflow, /fetch-depth:\s*0/);
    assert.match(workflow, /- 'scripts\/\*\*'/);
    assert.match(workflow, /- '\.github\/workflows\/validate-theme\.yml'/);
    assert.match(workflow, /THEMES=\$\(node scripts\/changed-theme-slugs\.mjs[^\n]+\)\n\s*echo "themes=/);
    assert.match(workflow, /node --test scripts\/\*\.test\.mjs/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// WHY: preview.png never reaches an installed theme, so the version-bump check must not
// demand a bump for it — but any other file in the same theme still must (PR #35, 2026-09-25).
test('--installed-content drops preview-only themes and keeps real content changes', () => {
  const root = mkdtempSync(join(tmpdir(), 'theme-preview-only-'));
  try {
    for (const slug of ['pic-only', 'real-change']) mkdirSync(join(root, 'themes', slug), { recursive: true });
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'config', 'user.name', 'Fixture');
    git(root, 'config', 'user.email', 'fixture@example.test');
    for (const slug of ['pic-only', 'real-change']) {
      writeFileSync(join(root, 'themes', slug, 'manifest.json'), '{}\n');
      writeFileSync(join(root, 'themes', slug, 'preview.png'), 'old');
    }
    git(root, 'add', 'themes');
    git(root, 'commit', '-qm', 'base');
    const base = git(root, 'rev-parse', 'HEAD');
    writeFileSync(join(root, 'themes', 'pic-only', 'preview.png'), 'new');
    writeFileSync(join(root, 'themes', 'real-change', 'preview.png'), 'new');
    writeFileSync(join(root, 'themes', 'real-change', 'manifest.json'), '{"x":1}\n');
    git(root, 'commit', '-qam', 'change');
    const head = git(root, 'rev-parse', 'HEAD');

    const all = spawnSync(process.execPath, [checker, base, head], { cwd: root, encoding: 'utf8' });
    assert.equal(all.status, 0, all.stderr);
    assert.equal(all.stdout.trim(), 'pic-only real-change', 'every other check still sees preview changes');

    const bump = spawnSync(process.execPath, [checker, '--installed-content', base, head], { cwd: root, encoding: 'utf8' });
    assert.equal(bump.status, 0, bump.stderr);
    assert.equal(bump.stdout.trim(), 'real-change');

    const workflow = readFileSync(join(repo, '.github', 'workflows', 'validate-theme.yml'), 'utf8');
    assert.match(workflow, /BUMP=\$\(node scripts\/changed-theme-slugs\.mjs --installed-content/);
    assert.match(workflow, /for slug in \$\{\{ steps\.changed\.outputs\.bump_themes \}\}/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

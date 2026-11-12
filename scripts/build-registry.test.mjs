import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(repo, 'scripts', 'build-registry.py');

// WHY: every rebuild used to stamp every theme "updated: today", so the marketplace "New" sort
// treated all themes as fresh. A theme's date must move only when its own version or files change.
function build(root) {
  const r = spawnSync('python3', [script], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return Object.fromEntries(JSON.parse(readFileSync(join(root, 'registry', 'theme-registry.json'), 'utf8')).themes.map((t) => [t.slug, t]));
}
function theme(root, slug, manifest) {
  mkdirSync(join(root, 'themes', slug), { recursive: true });
  writeFileSync(join(root, 'themes', slug, 'manifest.json'), JSON.stringify({ name: slug, author: 'x', version: '1.0.0', tokens: {}, ...manifest }));
}

test('updated date moves only for the theme whose version or files changed', () => {
  const root = mkdtempSync(join(tmpdir(), 'build-registry-'));
  try {
    theme(root, 'a', {});
    theme(root, 'b', {});
    theme(root, 'c', {});
    theme(root, 'd', {});
    const first = build(root);
    const today = first.a.updated;
    // Pretend the first build happened long ago.
    const regPath = join(root, 'registry', 'theme-registry.json');
    const reg = JSON.parse(readFileSync(regPath, 'utf8'));
    for (const t of reg.themes) t.updated = '2026-01-01';
    writeFileSync(regPath, JSON.stringify(reg));

    theme(root, 'b', { version: '1.1.0' });          // version bump
    theme(root, 'c', { description: 'edited' });     // files changed, same version
    const second = build(root);
    assert.equal(second.a.updated, '2026-01-01', 'untouched theme keeps its date');
    assert.equal(second.d.updated, '2026-01-01', 'untouched theme keeps its date');
    assert.equal(second.b.updated, today, 'a version bump moves the date');
    assert.equal(second.c.updated, today, 'a changed file moves the date');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an old entry with only contentHash keeps its date when nothing differs, and a new theme gets today', () => {
  const root = mkdtempSync(join(tmpdir(), 'build-registry-'));
  try {
    theme(root, 'a', { contentHash: 'abc' });
    mkdirSync(join(root, 'registry'), { recursive: true });
    writeFileSync(join(root, 'registry', 'theme-registry.json'), JSON.stringify({ version: 1, themes: [
      { slug: 'a', version: '1.0.0', updated: '2026-01-01', contentHash: 'abc' }] }));
    theme(root, 'n', {});
    const out = build(root);
    assert.equal(out.a.updated, '2026-01-01');
    assert.notEqual(out.n.updated, '2026-01-01');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

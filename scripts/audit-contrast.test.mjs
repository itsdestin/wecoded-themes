import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// WHY: Without a wallpaper average a translucent theme looks green while the
// compositor can make its muted text illegible. This must fail CI, not warn.
test('translucent wallpaper without average-color fails the contrast audit', () => {
  const root = mkdtempSync(join(tmpdir(), 'theme-contrast-'));
  try {
    mkdirSync(join(root, 'scripts', 'vendor'), { recursive: true });
    mkdirSync(join(root, 'themes', 'morning-rounds'), { recursive: true });
    copyFileSync(join(repo, 'scripts', 'audit-contrast.mjs'), join(root, 'scripts', 'audit-contrast.mjs'));
    copyFileSync(join(repo, 'scripts', 'vendor', 'contrast-rules.js'), join(root, 'scripts', 'vendor', 'contrast-rules.js'));
    const theme = JSON.parse(readFileSync(join(repo, 'themes', 'morning-rounds', 'manifest.json'), 'utf8'));
    delete theme.background['average-color'];
    writeFileSync(join(root, 'themes', 'morning-rounds', 'manifest.json'), JSON.stringify(theme));
    const result = spawnSync(process.execPath, [join(root, 'scripts', 'audit-contrast.mjs')], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /morning-rounds:.*background\.average-color/);
    assert.match(result.stdout, /fail a blocking check/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

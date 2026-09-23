import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// WHY: A missing or unknown type on an image-backed glass theme cannot quietly
// turn an absent wallpaper average into a certified flat-colour pass.
test('image-backed glass without a recognized background type still needs average-color', () => {
  const root = mkdtempSync(join(tmpdir(), 'theme-background-'));
  try {
    mkdirSync(join(root, 'scripts', 'vendor'), { recursive: true });
    mkdirSync(join(root, 'themes', 'morning-rounds'), { recursive: true });
    copyFileSync(join(repo, 'scripts', 'audit-contrast.mjs'), join(root, 'scripts', 'audit-contrast.mjs'));
    copyFileSync(join(repo, 'scripts', 'vendor', 'contrast-rules.js'), join(root, 'scripts', 'vendor', 'contrast-rules.js'));
    for (const kind of [undefined, 'unknown']) {
      const theme = JSON.parse(readFileSync(join(repo, 'themes', 'morning-rounds', 'manifest.json'), 'utf8'));
      delete theme.background['average-color'];
      if (kind === undefined) delete theme.background.type;
      else theme.background.type = kind;
      writeFileSync(join(root, 'themes', 'morning-rounds', 'manifest.json'), JSON.stringify(theme));
      const result = spawnSync(process.execPath, [join(root, 'scripts', 'audit-contrast.mjs')], { encoding: 'utf8' });
      assert.equal(result.status, 1, `${kind ?? 'missing type'}: ${result.stdout}${result.stderr}`);
      assert.match(result.stdout, /background\.average-color/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

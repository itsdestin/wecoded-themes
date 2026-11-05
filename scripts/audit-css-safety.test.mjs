import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditManifest, sanitizeCSS, isAllowedGoogleFontUrl } from './audit-css-safety.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), 'audit-css-safety.mjs');

// WHY: the check must fail loudly if it is ever loosened; --self-test holds the known-bad list.
test('self-test passes and every published theme is clean', () => {
  const r = spawnSync('node', [script, '--self-test'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('escaped and string-only remote loads are rejected', () => {
  for (const css of [
    'a{background:url(\\68ttps://e.example/b.png)}',
    '@\\69mport "https://e.example/x.css";',
    'a{background:image-set("https://e.example/b.png" 1x)}',
    '@imp@import a;ort "https://e.example/x.css";',
  ]) assert.notEqual(auditManifest({ custom_css: css }).length, 0, css);
});

test('theme-asset, data and relative addresses are accepted unchanged', () => {
  const css = 'a{background:url(theme-asset://s/a.png)} b{background:url(img/x.png)} c{background:url("data:image/png;base64,AAAA")}';
  assert.equal(sanitizeCSS(css), css);
  assert.deepEqual(auditManifest({ custom_css: css }), []);
});

test('only https://fonts.googleapis.com/css2?... is an allowed font address', () => {
  assert.ok(isAllowedGoogleFontUrl('https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap'));
  for (const u of ['https://evil.example/css2?family=A', 'http://fonts.googleapis.com/css2?family=A', 'https://fonts.googleapis.com/css?family=A', 'https://fonts.googleapis.com@evil.example/css2?x=1'])
    assert.equal(isAllowedGoogleFontUrl(u), false, u);
});

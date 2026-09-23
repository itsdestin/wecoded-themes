#!/usr/bin/env node
// Contrast audit for community themes.
//
// WHY THIS WAS REWRITTEN (2026-07-19)
// -----------------------------------
// This script used to carry its OWN hand-written table of ~8 token pairs, all
// measured against `canvas`. Two other copies of the same idea existed — the
// theme-builder's contrast-rules.js and youcoded/desktop's audit-theme-contrast.mjs
// — each with different pairs and different thresholds. Three tables, three
// repos, no shared source.
//
// That divergence is not academic; it shipped bugs:
//   - `fg-muted` on a raised surface failed in 9 of 11 themes
//   - `fg-faint` on a raised surface had NEVER passed in any shipped theme
//   - a theme could pass the builder's gate and still fail this audit
//   - composited over its real wallpaper, meadow-mist bottomed out at 1.01
//     (identical luminance — invisible) while this script reported 1.24, because
//     it measured the flat `inset` token rather than what the app paints
//
// So the rules now live in ONE place — the theme-builder skill — and this script
// consumes a vendored copy. `npm run check:rules-drift` (and the CI step of the
// same name) fetches the canonical file and fails loudly if the vendored copy
// has drifted. Do not edit scripts/vendor/contrast-rules.js by hand.
//
// GLASS: wallpaper themes paint panel/inset/well translucently over the
// background image, so the colour under the text is a composite, not the token.
// Decoding a JPEG in CI without dependencies isn't practical, so the builder
// precomputes the wallpaper's average into `background.average-color` and this
// script reads it. A wallpaper theme missing that field FAILS, because a flat
// audit of a glass theme cannot certify its actual text contrast.
//
// Run from the repo root:
//   node scripts/audit-contrast.mjs

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const THEMES_DIR = join(REPO_ROOT, 'themes');
const rules = require('./vendor/contrast-rules.js');

function loadThemes() {
  if (!existsSync(THEMES_DIR)) {
    console.error(`No themes/ directory at ${THEMES_DIR}`);
    process.exit(1);
  }
  const out = [];
  for (const slug of readdirSync(THEMES_DIR).sort()) {
    const manifestPath = join(THEMES_DIR, slug, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (manifest && manifest.tokens) out.push({ slug, manifest });
    } catch (err) {
      console.error(`✗ ${slug}: manifest.json is not valid JSON — ${err.message}`);
      process.exit(1);
    }
  }
  return out;
}

const themes = loadThemes();
const failing = [];

for (const { slug, manifest } of themes) {
  const bg = manifest.background || {};
  const panelsOpacity = typeof bg['panels-opacity'] === 'number' ? bg['panels-opacity'] : 1;
  const averageColor = bg['average-color'] || null;

  // WHY: A flat-token pass cannot certify contrast over a translucent wallpaper;
  // fail closed until the theme declares the background colour used for compositing.
  // A mistyped/missing `type` must not make an actual image path look like flat
  // paint; all registry wallpaper paths live under assets/.
  const wallpaperValue = typeof bg.value === 'string' && (
    bg.value.startsWith('assets/') || bg.value.startsWith('data:image/') || bg.value.includes('gradient(')
  );
  const needsGlass = panelsOpacity < 1 && (bg.type === 'image' || bg.type === 'gradient' || wallpaperValue);
  const missingAverage = needsGlass && !averageColor;

  const { results, hardFails, surfaceFails, softWarns, glassAware } = rules.evaluate(
    manifest.tokens,
    { wallpaperAvg: averageColor, panelsOpacity },
  );

  const blocking = hardFails + surfaceFails + Number(missingAverage);
  if (blocking > 0) failing.push(slug);

  const mark = blocking > 0 ? '❌' : '✓';
  const glassNote = glassAware ? ` [glass ${Math.round(panelsOpacity * 100)}% over ${averageColor}]` : '';
  console.log(`\n${mark} ${slug}${glassNote}`);
  if (missingAverage) {
    console.log(`    ✗ HARD    ${slug}: panels-opacity ${panelsOpacity} but no background.average-color — cannot certify text over the wallpaper; re-run the theme-builder to populate it.`);
  }

  for (const tier of ['HARD', 'SURFACE', 'SOFT']) {
    for (const r of results[tier]) {
      if (r.status === 'PASS') continue;
      if (r.status === 'SKIP') {
        console.log(`    · ${tier.padEnd(7)} ${r.rule.padEnd(24)} skipped — ${r.reason}`);
        continue;
      }
      const glyph = tier === 'SOFT' ? '  ⚠' : '  ✗';
      console.log(
        `${glyph} ${tier.padEnd(7)} ${r.rule.padEnd(24)} ${String(r.actual).padStart(6)} ` +
          `(min ${r.threshold}) — ${r.description}`,
      );
    }
  }
  if (blocking === 0 && softWarns === 0) console.log('    all checks pass');
}

console.log('\n────────────────────────────────────────');

if (failing.length === 0) {
  console.log(`All ${themes.length} themes pass HARD and SURFACE checks.`);
  process.exit(0);
}
console.log(`${failing.length} of ${themes.length} themes fail a blocking check:`);
for (const slug of failing) console.log(`  - ${slug}`);
process.exit(1);

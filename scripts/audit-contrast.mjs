#!/usr/bin/env node
// Contrast audit for community themes.
//
// Computes WCAG relative-luminance contrast ratios for the color pairs
// the YouCoded app relies on, across every theme in `themes/`. Exits
// non-zero if any theme fails any check (CI-friendly).
//
// Pairs + thresholds:
//   panel ↔ canvas       — chrome surface vs content surface (≥1.07)
//   fg ↔ canvas          — primary text (WCAG AA, ≥4.5)
//   fg-2 ↔ canvas        — secondary text (≥4.5)
//   fg-dim ↔ canvas      — dim text (≥3.0, AA large)
//   fg-muted ↔ canvas    — muted text (≥3.0)
//   fg-faint ↔ canvas    — faint/decorative text (≥1.8)
//   fg ↔ inset           — text on assistant bubbles (≥4.5)
//   on-accent ↔ accent   — text on user bubbles (≥4.5)
//
// Run from the repo root:
//   node scripts/audit-contrast.mjs

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const THEMES_DIR = join(REPO_ROOT, 'themes');

// ────────────────────────────────────────────────────────────────────────────
// Color math (sRGB → linear luminance → WCAG contrast ratio).

function srgbChannelToLinear(c) {
  c = c / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relLuminance(hex) {
  if (!hex || typeof hex !== 'string') return null;
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return null;
  const r = srgbChannelToLinear(parseInt(m[1], 16));
  const g = srgbChannelToLinear(parseInt(m[2], 16));
  const b = srgbChannelToLinear(parseInt(m[3], 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(hexA, hexB) {
  const lA = relLuminance(hexA);
  const lB = relLuminance(hexB);
  if (lA == null || lB == null) return null;
  const [hi, lo] = lA > lB ? [lA, lB] : [lB, lA];
  return (hi + 0.05) / (lo + 0.05);
}

// ────────────────────────────────────────────────────────────────────────────
// Pairs + thresholds.

const PAIRS = [
  { name: 'panel/canvas',     a: 'panel',      b: 'canvas', min: 1.07, label: 'chrome vs content surface' },
  { name: 'fg/canvas',        a: 'fg',         b: 'canvas', min: 4.5,  label: 'primary text on content (AA)' },
  { name: 'fg-2/canvas',      a: 'fg-2',       b: 'canvas', min: 4.5,  label: 'secondary text on content (AA)' },
  { name: 'fg-dim/canvas',    a: 'fg-dim',     b: 'canvas', min: 3.0,  label: 'dim text on content (AA large)' },
  { name: 'fg-muted/canvas',  a: 'fg-muted',   b: 'canvas', min: 3.0,  label: 'muted text on content' },
  { name: 'fg-faint/canvas',  a: 'fg-faint',   b: 'canvas', min: 1.8,  label: 'faint text on content (decorative)' },
  { name: 'fg/inset',         a: 'fg',         b: 'inset',  min: 4.5,  label: 'primary text on bubbles (AA)' },
  { name: 'on-accent/accent', a: 'on-accent',  b: 'accent', min: 4.5,  label: 'user-bubble text (AA)' },
];

// ────────────────────────────────────────────────────────────────────────────
// Run.

function loadThemes() {
  if (!existsSync(THEMES_DIR)) {
    console.error(`themes/ not found at ${THEMES_DIR}`);
    process.exit(2);
  }
  const out = [];
  for (const dir of readdirSync(THEMES_DIR)) {
    const manifest = join(THEMES_DIR, dir, 'manifest.json');
    if (!existsSync(manifest)) continue;
    const data = JSON.parse(readFileSync(manifest, 'utf-8'));
    if (!data.tokens) continue;
    out.push({ slug: data.slug || dir, tokens: data.tokens });
  }
  return out;
}

function auditTheme(slug, tokens) {
  return PAIRS.map((p) => {
    const ratio = contrast(tokens[p.a], tokens[p.b]);
    const fail = ratio != null && ratio < p.min;
    return { ...p, ratio, fail };
  });
}

const themes = loadThemes().sort((a, b) => a.slug.localeCompare(b.slug));
const overallFails = [];

for (const { slug, tokens } of themes) {
  const results = auditTheme(slug, tokens);
  const hasFail = results.some((r) => r.fail);
  if (hasFail) overallFails.push(slug);

  const header = hasFail ? `❌ ${slug}` : `✓ ${slug}`;
  console.log(`\n${header}`);
  for (const r of results) {
    const ratio = r.ratio == null ? 'n/a' : r.ratio.toFixed(3);
    const status = r.fail ? '  ✗' : '   ';
    const minStr = `(min ${r.min.toFixed(2)})`;
    console.log(`${status} ${r.name.padEnd(20)} ${ratio.padStart(7)}:1 ${minStr.padEnd(13)} — ${r.label}`);
  }
}

console.log(`\n────────────────────────────────────────`);
if (overallFails.length === 0) {
  console.log('All themes pass.');
  process.exit(0);
} else {
  console.log(`${overallFails.length} theme${overallFails.length === 1 ? '' : 's'} fail at least one check:`);
  for (const slug of overallFails) console.log(`  - ${slug}`);
  process.exit(1);
}

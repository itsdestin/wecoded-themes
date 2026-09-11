#!/usr/bin/env node
/**
 * Drawing safety audit — the store-side half of the 2026-09-10 mascot fix.
 *
 * Why this exists: a theme's mascot rig and scene companions are drawn INTO the
 * app's own page, so a drawing that smuggles in script would run with the app's
 * powers. The app cleans every drawing before showing it, and that cleaning is
 * the real protection — it also covers themes installed by hand, which never pass
 * through this repo. This check stops the known tricks at submission, so a bad
 * drawing never reaches the registry and no reviewer has to spot one by eye.
 *
 * Checks, across EVERY theme and the mascots/ library (cheap, so not just the
 * changed ones):
 *   1. manifest mascot.*, companions[].asset and icons.* are paths inside assets/
 *      — never a web address, data: URI, absolute path or "..". A drawing loaded
 *      from a web address could be swapped for a different one after review.
 *   2. every .svg carries none of the markup those tricks need: processing
 *      instructions (other than one leading <?xml ?>), CDATA, DOCTYPE/ENTITY,
 *      comments shaped to close early when read as HTML (<!--> and <!--->, --!>),
 *      script-capable or animation elements, on* event attributes, links that
 *      are not #references or embedded images, and url() to anything but #refs.
 *
 * Comments themselves are NOT banned: published rigs use them, and some quote
 * tag names in their text.
 *
 * Usage: node scripts/audit-svg-safety.mjs [--self-test]
 *   --self-test  runs known-bad samples first and fails if any slips through, so
 *                a regex loosened by accident cannot pass silently.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Elements the app's cleaner removes anyway; published drawings use none of them
// (checked 2026-09-10 across all 41 published SVGs), so any appearance is a red flag.
const FORBIDDEN_ELEMENTS = [
  'script', 'foreignObject', 'iframe', 'embed', 'object', 'style', 'link', 'meta',
  'animate', 'animateTransform', 'animateMotion', 'set', 'a', 'image', 'use', 'handler', 'listener',
];

export function svgProblems(text) {
  const problems = [];
  const body = text.replace(/^﻿?\s*<\?xml\b[^>]*\?>/, '');
  if (body.includes('<?')) problems.push('processing instruction (<?…?>)');
  if (/<!\[CDATA\[/i.test(body)) problems.push('CDATA section');
  if (/<!DOCTYPE/i.test(body)) problems.push('DOCTYPE declaration');
  if (/<!ENTITY/i.test(body)) problems.push('ENTITY declaration');
  // An HTML reader closes these comments immediately; an XML reader does not.
  // Everything between is invisible to one and live to the other.
  if (/<!---?>/.test(body) || body.includes('--!>')) problems.push('comment shaped to close early (<!--> or --!>)');

  const stripped = body.replace(/<!--[\s\S]*?-->/g, '');
  for (const tag of stripped.matchAll(/<\s*([a-zA-Z][\w:.-]*)([^>]*)>/g)) {
    const [, rawName, attrs] = tag;
    const name = rawName.replace(/^[\w.-]+:/, '');
    if (FORBIDDEN_ELEMENTS.some((f) => f.toLowerCase() === name.toLowerCase())) {
      problems.push(`<${rawName}> element`);
    }
    if (/(^|[\s"'/])on[a-z]+\s*=/i.test(attrs)) problems.push(`event attribute on <${rawName}>`);
    for (const href of attrs.matchAll(/(?:^|\s)(?:[\w-]+:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/gi)) {
      const value = (href[1] ?? href[2] ?? href[3] ?? '').trim();
      if (!value.startsWith('#') && !/^data:image\//i.test(value)) problems.push(`link to ${JSON.stringify(value)} on <${rawName}>`);
    }
  }
  if (/url\(\s*['"]?\s*(?!#)/i.test(stripped)) problems.push('url() to something other than a #reference');
  if (/javascript\s*:/i.test(stripped)) problems.push('javascript: text');
  return [...new Set(problems)];
}

export function manifestProblems(manifest) {
  const problems = [];
  const check = (field, value) => {
    if (typeof value !== 'string') return;
    if (!value.startsWith('assets/') || value.split(/[\\/]/).includes('..')) {
      problems.push(`${field} must be a path inside assets/ (got ${JSON.stringify(value)})`);
    }
  };
  for (const [key, value] of Object.entries(manifest.mascot ?? {})) check(`mascot.${key}`, value);
  (Array.isArray(manifest.companions) ? manifest.companions : [])
    .forEach((c, i) => check(`companions[${i}].asset`, c?.asset));
  for (const [key, value] of Object.entries(manifest.icons ?? {})) check(`icons.${key}`, value);
  return problems;
}

function selfTest() {
  const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
  const mustFail = [
    svg('<!--><img src=x onerror=alert(1)>-->'),
    svg('<!---><img src=x onerror=alert(1)>-->'),
    svg('<?x ><img src=x onerror=alert(1)>?>'),
    svg('<![CDATA[<img src=x onerror=alert(1)>]]>'),
    '<!DOCTYPE svg [<!ENTITY x "y">]>' + svg(''),
    svg('<FOREIGNOBJECT><iframe srcdoc="x"></iframe></FOREIGNOBJECT>'),
    svg('<Script>alert(1)</Script>'),
    svg('<circle ONLOAD="alert(1)"/>'),
    svg('<animate attributeName="href" values="javascript:alert(1)"/>'),
    svg('<a xlink:href="javascript:alert(1)"><circle/></a>'),
    svg('<g filter="url(https://example.com/x.svg#f)"/>'),
    svg('<path style="fill:url(//example.com/p)"/>'),
    svg('<!-- a --!><img src=x onerror=alert(1)>-->'),
  ];
  const mustPass = [
    '<?xml version="1.0" encoding="UTF-8"?>\n' + svg(
      '<!-- the <g id="slot-hat"> slot; an <img> goes nowhere -->' +
      '<defs><linearGradient id="g"/></defs><circle fill="url(#g)" data-pivot="2 9"/>',
    ),
  ];
  let bad = 0;
  mustFail.forEach((s, i) => { if (svgProblems(s).length === 0) { console.error(`self-test: sample ${i} slipped through: ${s}`); bad++; } });
  mustPass.forEach((s, i) => { const p = svgProblems(s); if (p.length) { console.error(`self-test: clean sample ${i} flagged: ${p.join('; ')}`); bad++; } });
  const badManifests = [
    { mascot: { rig: 'https://example.com/rig.svg' } },
    { mascot: { rig: 'data:image/svg+xml,<svg/>' } },
    { mascot: { rig: '/etc/rig.svg' } },
    { companions: [{ asset: 'assets/../../x.svg' }] },
    { icons: { send: 'http://example.com/i.svg' } },
  ];
  badManifests.forEach((m, i) => { if (manifestProblems(m).length === 0) { console.error(`self-test: manifest ${i} slipped through`); bad++; } });
  if (manifestProblems({ mascot: { rig: 'assets/mascot-rig.svg' }, companions: [{ asset: 'assets/companions/a.svg' }] }).length) {
    console.error('self-test: clean manifest flagged'); bad++;
  }
  if (bad) { console.error(`✗ self-test: ${bad} problem(s)`); process.exit(1); }
  console.log(`✓ self-test: ${mustFail.length + badManifests.length} bad samples caught, clean samples pass`);
}

function* svgFiles(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* svgFiles(p);
    else if (name.toLowerCase().endsWith('.svg')) yield p;
  }
}

function main() {
  if (process.argv.includes('--self-test')) selfTest();
  let failures = 0;
  let manifests = 0;
  let drawings = 0;
  const themesDir = join(ROOT, 'themes');
  for (const slug of readdirSync(themesDir)) {
    const manifestPath = join(themesDir, slug, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    manifests++;
    for (const p of manifestProblems(JSON.parse(readFileSync(manifestPath, 'utf8')))) {
      console.error(`::error file=themes/${slug}/manifest.json::${p}`);
      failures++;
    }
  }
  for (const file of [...svgFiles(themesDir), ...svgFiles(join(ROOT, 'mascots'))]) {
    drawings++;
    const rel = relative(ROOT, file);
    for (const p of svgProblems(readFileSync(file, 'utf8'))) {
      console.error(`::error file=${rel}::${p}`);
      failures++;
    }
  }
  if (failures) {
    console.error(`✗ ${failures} drawing-safety problem(s)`);
    process.exit(1);
  }
  console.log(`✓ ${manifests} manifests and ${drawings} drawings pass the drawing-safety audit`);
}

main();

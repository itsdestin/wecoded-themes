#!/usr/bin/env node
/**
 * Rig contract audit — checks every themes/<slug>/assets/mascot-rig.svg (and the
 * mascots/examples/ authoring library) against mascots/README.md "The rig contract".
 *
 * Why this exists: rigs are authored by hand (and by /theme-builder) and the app
 * finds every moving part by `id`. A typo'd or missing id doesn't error — the part
 * just silently never animates, which is invisible until someone drags the buddy
 * to a screen edge and notices the hands aren't there (2026-07-17: exactly that,
 * on strawberry-kitty and kuromi-dreamer). Presence is the only thing standing
 * between an author and a rig that looks fine and is half-dead.
 *
 * ERRORS fail CI (the rig is broken or will animate wrong). WARNINGS are optional
 * parts a theme may legitimately skip — reported so the gap is a choice, not a
 * silent omission.
 *
 * Usage: node scripts/audit-rigs.mjs [--json]
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CANONICAL_VIEWBOX = '-3 -5 30 30';

// The contract, mechanically. Pivots are the canonical capsule-rig hinges from
// mascots/README.md — a limb drawn hanging down from the wrong pivot swings from
// the wrong shoulder, which reads as a broken puppet rather than a missing part.
const LIMBS = [
  { id: 'rig-arm-left', pivot: '2.5 9' },
  { id: 'rig-arm-right', pivot: '21.5 9' },
  { id: 'rig-leg-left', pivot: '8.95 17' },
  { id: 'rig-leg-right', pivot: '15.05 17' },
];
const OPTIONAL_LIMBS = [{ id: 'rig-tail', pivot: '19 14' }];
// The app's POSES table (desktop/src/renderer/components/mascot/mascot-poses.ts)
// names exactly these faces; a rig missing one falls back to whatever is showing,
// so the buddy just never reacts.
const FACES = ['idle', 'welcome', 'curious', 'shocked', 'dizzy', 'blink'];
const HIDDEN_FACES = FACES.filter((f) => f !== 'idle'); // idle is the one that starts visible
const PEEK_HANDS = ['rig-hand-peek-left', 'rig-hand-peek-right'];
const SLOTS = ['slot-hat', 'slot-eyewear', 'slot-item'];

/** Opening tag that carries id="<id>", or null. Rigs are authored SVG, not
 *  arbitrary XML — a targeted tag match beats pulling in a DOM dependency. */
function tagWithId(svg, id) {
  const m = svg.match(new RegExp(`<[a-zA-Z]+\\b[^>]*\\bid="${id}"[^>]*>`));
  return m ? m[0] : null;
}
const isHidden = (tag) => /display\s*:\s*none/.test(tag ?? '');
const pivotOf = (tag) => (tag?.match(/\bdata-pivot="([^"]*)"/) ?? [])[1] ?? null;

export function auditRig(svg, label) {
  const errors = [];
  const warnings = [];
  const E = (m) => errors.push(m);
  const W = (m) => warnings.push(m);

  const viewBox = (svg.match(/<svg\b[^>]*\bviewBox="([^"]*)"/) ?? [])[1];
  if (!viewBox) E('no viewBox on <svg>');
  else if (viewBox.trim().replace(/\s+/g, ' ') !== CANONICAL_VIEWBOX) {
    // Off-box rigs render at the wrong scale inside the buddy window and blow the
    // hat/item headroom the padding exists for.
    E(`viewBox is "${viewBox}" — the contract is "${CANONICAL_VIEWBOX}"`);
  }

  if (!tagWithId(svg, 'rig-root')) E('missing #rig-root (the idle-motion loop attaches here)');
  if (!tagWithId(svg, 'rig-body')) E('missing #rig-body (the one required part)');

  for (const { id, pivot } of LIMBS) {
    const tag = tagWithId(svg, id);
    if (!tag) { E(`missing #${id}`); continue; }
    const got = pivotOf(tag);
    if (!got) W(`#${id} has no data-pivot — the app falls back to the group's top-center`);
    else if (got.trim().replace(/\s+/g, ' ') !== pivot) {
      E(`#${id} pivot is "${got}" — the canonical hinge is "${pivot}"`);
    }
  }
  for (const { id, pivot } of OPTIONAL_LIMBS) {
    const tag = tagWithId(svg, id);
    if (!tag) continue; // genuinely optional — no tail is not a defect
    const got = pivotOf(tag);
    if (!got) W(`#${id} has no data-pivot`);
    else if (got.trim().replace(/\s+/g, ' ') !== pivot) W(`#${id} pivot is "${got}" — canonical is "${pivot}"`);
  }

  for (const face of FACES) {
    const id = `rig-face-${face}`;
    const tag = tagWithId(svg, id);
    if (!tag) { E(`missing #${id}`); continue; }
    // Every face but idle must start hidden, or two faces paint at once.
    if (HIDDEN_FACES.includes(face) && !isHidden(tag)) E(`#${id} must start style="display:none"`);
    if (face === 'idle' && isHidden(tag)) E('#rig-face-idle must NOT start hidden — it is the resting face');
  }

  for (const id of PEEK_HANDS) {
    const tag = tagWithId(svg, id);
    // Optional per the contract (rigs without them sink past the edge bare), but
    // the app stages side-peek expecting them, so a gap is worth saying out loud.
    if (!tag) { W(`no #${id} — side peek at that edge will sink without grip mittens`); continue; }
    if (!isHidden(tag)) E(`#${id} must start style="display:none" (only the app's edge overlay shows it)`);
  }

  for (const id of SLOTS) {
    if (!tagWithId(svg, id)) W(`no #${id} — accessories cannot attach`);
  }

  // The app owns all motion; a rig that animates itself fights the pose engine.
  if (/<animate|<animateTransform|<animateMotion/.test(svg)) E('rig carries SMIL animation — motion is app-side');
  if (/<style\b/.test(svg)) E('rig carries a <style> block — the sanitizer strips it, so it will not render');
  if (/<script\b/.test(svg)) E('rig carries <script> — the sanitizer strips it');

  return { label, errors, warnings, ok: errors.length === 0 };
}

function collect() {
  const targets = [];
  const themesDir = join(ROOT, 'themes');
  for (const slug of readdirSync(themesDir)) {
    const rig = join(themesDir, slug, 'assets', 'mascot-rig.svg');
    const manifestPath = join(themesDir, slug, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const declared = manifest.mascot?.rig;
    if (!existsSync(rig)) {
      // A theme with no rig is fine (flat art / the app's default rig covers it).
      // A theme that DECLARES one and doesn't ship it is a broken install.
      if (declared) targets.push({ label: `themes/${slug}`, missing: declared });
      continue;
    }
    if (!declared) {
      targets.push({ label: `themes/${slug}`, orphan: true, path: rig });
      continue;
    }
    targets.push({ label: `themes/${slug}`, path: rig });
  }
  const examples = join(ROOT, 'mascots', 'examples');
  if (existsSync(examples)) {
    for (const f of readdirSync(examples).filter((f) => f.endsWith('.svg'))) {
      targets.push({ label: `mascots/examples/${basename(f)}`, path: join(examples, f) });
    }
  }
  return targets;
}

const asJson = process.argv.includes('--json');
const results = [];
for (const t of collect()) {
  if (t.missing) {
    results.push({ label: t.label, errors: [`manifest declares mascot.rig "${t.missing}" but the file is not there`], warnings: [], ok: false });
    continue;
  }
  const r = auditRig(readFileSync(t.path, 'utf8'), t.label);
  if (t.orphan) r.warnings.unshift('ships a mascot-rig.svg but the manifest has no mascot.rig key — the app will never load it');
  results.push(r);
}

if (asJson) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const r of results) {
    const status = r.errors.length ? 'FAIL' : r.warnings.length ? 'warn' : 'ok';
    console.log(`\n${status.padEnd(4)} ${r.label}`);
    for (const e of r.errors) console.log(`  ERROR   ${e}`);
    for (const w of r.warnings) console.log(`  warn    ${w}`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length} rig(s) audited — ${failed.length} failing, ` +
    `${results.filter((r) => r.ok && r.warnings.length).length} with warnings.`);
}
process.exit(results.some((r) => !r.ok) ? 1 : 0);

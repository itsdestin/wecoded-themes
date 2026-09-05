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
// Added with the warm face set (2026-09-05). The app falls back to a near face when one of
// these is absent, so it warns rather than fails — but every rig we ship should have both.
const EXTRA_FACES = ['happy', 'shutdown'];
// The eyes only follow the cursor inside a <g class="pupil">, and there must be one per eye.
// A face without them is a rig whose gaze is nailed straight ahead.
const TRACKING_FACES = ['welcome', 'curious', 'shocked'];
const HIDDEN_FACES = [...FACES, ...EXTRA_FACES].filter((f) => f !== 'idle'); // idle is the one that starts visible
const PEEK_HANDS = ['rig-hand-peek-left', 'rig-hand-peek-right'];
const SLOTS = ['slot-hat', 'slot-eyewear', 'slot-item'];

/** Everything between a group's opening tag and its matching close, by depth count. */
function groupBody(svg, id) {
  const open = svg.search(new RegExp(`<g\\b[^>]*\\bid="${id}"`));
  if (open < 0) return '';
  let i = svg.indexOf('>', open) + 1, depth = 1;
  const start = i;
  while (i < svg.length && depth > 0) {
    const nextOpen = svg.indexOf('<g', i), nextClose = svg.indexOf('</g>', i);
    if (nextClose < 0) break;
    if (nextOpen >= 0 && nextOpen < nextClose) { depth++; i = nextOpen + 2; }
    else { depth--; if (depth === 0) return svg.slice(start, nextClose); i = nextClose + 4; }
  }
  return svg.slice(start, i);
}

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

  for (const face of [...FACES, ...EXTRA_FACES]) {
    const id = `rig-face-${face}`;
    const tag = tagWithId(svg, id);
    if (!tag) {
      if (EXTRA_FACES.includes(face)) W(`missing #${id} — the app will substitute a near face, but this one never plays`);
      else E(`missing #${id}`);
      continue;
    }
    // Every face but idle must start hidden, or two faces paint at once.
    if (HIDDEN_FACES.includes(face) && !isHidden(tag)) E(`#${id} must start style="display:none"`);
    // #rig-face-idle is the group that paints before any script runs — it is NOT the face
    // shown at rest (the resting pose asks for `welcome`). Draw it as eyes-closed-content.
    if (face === 'idle' && isHidden(tag)) E('#rig-face-idle must NOT start hidden — it paints before the app takes over');
    if (TRACKING_FACES.includes(face)) {
      const body = groupBody(svg, id);
      const pupils = (body.match(/class="pupil"/g) ?? []).length;
      if (pupils < 2) W(`#${id} has ${pupils} <g class="pupil"> of 2 — the eyes will not follow the cursor on this face`);
    }
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
  // skins/ AND examples/ are both "start from this and recolour" material, so an
  // out-of-date face set there leaks into every theme built afterwards — audit both.
  for (const dir of ['examples', 'skins']) {
    const d = join(ROOT, 'mascots', dir);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d).filter((f) => f.endsWith('.svg'))) {
      targets.push({ label: `mascots/${dir}/${basename(f)}`, path: join(d, f) });
    }
  }
  return targets;
}

// mascots/examples/<slug>.rig.svg is a copy of the theme's shipped rig, kept so the library
// reads as a complete set. Copies drift silently: check them instead of trusting them.
function copyDrift() {
  const out = [];
  const dir = join(ROOT, 'mascots', 'examples');
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.rig.svg'))) {
    const slug = basename(f, '.rig.svg');
    const shipped = join(ROOT, 'themes', slug, 'assets', 'mascot-rig.svg');
    if (!existsSync(shipped)) continue;
    if (readFileSync(join(dir, f), 'utf8') !== readFileSync(shipped, 'utf8')) {
      out.push({ label: `mascots/examples/${f}`, ok: false, warnings: [],
        errors: [`differs from themes/${slug}/assets/mascot-rig.svg — the example is a copy, so update both`] });
    }
  }
  return out;
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

results.push(...copyDrift());

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

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'themes', 'morning-rounds', 'assets');
const rig = readFileSync(join(root, 'mascot-rig.svg'), 'utf8');

// WHY: The wallpaper dog's cream head and red scrubs must not quietly regress to a solid-colour capsule.
test('the dog has a tan head, distinct red scrub hem and short sleeves', () => {
  assert.match(rig, /<path id="scrub-hem"[^>]+fill="#A7122D"/);
  assert.doesNotMatch(rig, /id="scrub-neckline"/, 'no beige triangle below the muzzle');
  assert.match(rig, /<path id="scrub-seam" d="M11\.5 14\.8 L12\.2 15\.8"[^>]+stroke="#79172B"/);
  assert.match(rig, /<path id="scrub-cross"[^>]+stroke="#FFF0D3"/);
  assert.match(rig, /<path id="scrub-sleeve-left" d="[^"]*V11\.4[^"]*" fill="#A7122D"/);
  assert.match(rig, /<path id="scrub-sleeve-right" d="[^"]*V11\.4[^"]*" fill="#A7122D"/);
  assert.match(rig, /<g id="rig-body">[\s\S]*?fill="#E5BF8E"/);
});

// WHY: The board must stay visible at 45 degrees above the hand, without the pasted-on square finger.
test('the right arm carries a visible raised clipboard without an extra finger', () => {
  const arm = rig.match(/<g id="rig-arm-right"[\s\S]*?<g id="rig-leg-left"/u)?.[0] ?? '';
  assert.match(arm, /id="clipboard-board" transform="rotate\(45 21\.5 10\.9\)"/);
  assert.match(arm, /<rect x="21\.2" y="6\.7" width="3" height="4\.2"/);
  assert.doesNotMatch(arm, /id="clipboard-grip"/);
  assert.ok(arm.indexOf('id="clipboard-board"') > arm.indexOf('d="M20.8 9'), 'raised board must remain visible above the arm');
});

// WHY: The short red cuffs connect the dog's leg tops to the scrub shirt without turning the paws red.
test('both legs have red scrub cuffs over tan paws', () => {
  assert.match(rig, /<g id="rig-leg-left"[^>]*>[\s\S]*?<path id="scrub-leg-left"[^>]+fill="#A7122D"/);
  assert.match(rig, /<g id="rig-leg-right"[^>]*>[\s\S]*?<path id="scrub-leg-right"[^>]+fill="#A7122D"/);
});

// WHY: Ears must frame rather than float above the head; keep both inside the hat slot contract.
test('ears are balanced drooping lobes placed inside the hat slot', () => {
  const hat = rig.match(/<g id="slot-hat">([\s\S]*?)<\/g>/u)?.[1] ?? '';
  assert.match(hat, /id="ear-left" d="M8\.5 3\.5[^>]+fill="#C69A5F"/);
  assert.match(hat, /id="ear-right" d="M15\.5 3\.5[^>]+fill="#C69A5F"/);
});

// WHY: Android and browser users see flattened art; all poses must carry the same costume and held item.
test('all flat poses carry the costume, ears and held board from the rig', () => {
  for (const pose of ['idle', 'welcome', 'inquisitive', 'shocked']) {
    const svg = readFileSync(join(root, `mascot-${pose}.svg`), 'utf8');
    for (const id of ['scrub-hem', 'scrub-seam', 'scrub-cross', 'scrub-sleeve-left', 'scrub-sleeve-right', 'scrub-leg-left', 'scrub-leg-right', 'clipboard-board', 'slot-hat']) {
      assert.match(svg, new RegExp(`id="${id}"`), `${pose}: ${id}`);
    }
    assert.doesNotMatch(svg, /id="scrub-neckline"|id="clipboard-grip"/, `${pose}: no beige add-ons`);
  }
});

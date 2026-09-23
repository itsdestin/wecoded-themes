#!/usr/bin/env node
// WHY: Rebuild the wallpaper dog's rig and four flat poses together; decorating only the
// rig would leave Android and browser users with a different character.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const theme = resolve(repo, 'themes/morning-rounds');
const assets = resolve(theme, 'assets');
const rigPath = resolve(assets, 'mascot-rig.svg');
const builder = process.env.THEME_BUILDER_SCRIPT ?? resolve(process.env.HOME, '.claude/plugins/marketplaces/youcoded/plugins/wecoded-themes-plugin/skills/theme-builder/scripts/build-mascot.mjs');
const run = (...args) => execFileSync(process.execPath, [builder, '--out', assets, ...args], { stdio: 'inherit' });
const replaceOnce = (source, before, after) => {
  if (!source.includes(before)) throw new Error(`Missing rig anchor: ${before.slice(0, 70)}`);
  return source.replace(before, after);
};

run('--config', resolve(theme, 'mascot-config.json'));
let rig = readFileSync(rigPath, 'utf8');

// The scrub shape paints BEFORE every face group: red shoulders rise along the
// sides, while the cream muzzle masks its middle so the dog's face stays tan.
rig = replaceOnce(rig, '<g id="rig-body">', `<g id="rig-body">
      <clipPath id="rounds-body-clip"><path d="M9 4 L15 4 A4 4 0 0 1 19 8 L19 12 A4 4 0 0 1 15 16 L9 16 A4 4 0 0 1 5 12 L5 8 A4 4 0 0 1 9 4 Z"/></clipPath>`);
rig = replaceOnce(rig, '      <g id="rig-face-idle">', `      <path id="scrub-hem" d="M5 11.85 Q8.5 12.3 12 13.8 Q15.5 12.3 19 11.85 L19 16 H5 Z" fill="#A7122D" clip-path="url(#rounds-body-clip)"/>
      <path id="scrub-seam" d="M11.5 14.8 L12.2 15.8" fill="none" stroke="#79172B" stroke-width="0.3" stroke-linecap="round"/>
      <path id="scrub-cross" d="M17.15 13.35 V14.45 M16.6 13.9 H17.7" fill="none" stroke="#FFF0D3" stroke-width="0.36" stroke-linecap="round"/>
      <g id="rig-face-idle">`);

// The ear lobes straddle the top corners, tipped out and downward; they stay
// inside the slot's x=5..19, y=-4..6 footprint and clear brows on every face.
rig = replaceOnce(rig, '<g id="slot-hat"/>', `<g id="slot-hat">
      <path id="ear-left" d="M8.5 3.5 Q7.9 2.9 6.9 3.1 Q5.1 3.4 5.05 5.7 Q5.1 6 5.5 6 Q7 5.7 8.5 3.5 Z" fill="#C69A5F"/>
      <path id="ear-right" d="M15.5 3.5 Q16.1 2.9 17.1 3.1 Q18.9 3.4 18.95 5.7 Q18.9 6 18.5 6 Q17 5.7 15.5 3.5 Z" fill="#C69A5F"/>
    </g>`);

// WHY: Keep the raised clipboard in the animated item's slot but paint it AFTER
// the arm. With a 45-degree tilt most of the board was hidden by the limb when
// painted behind it; its bottom corner meets the hand without a fake square finger.
// Colour more of each limb red without reshaping its pivot or peek mitten.
rig = replaceOnce(rig, '</g>\n    <g id="rig-arm-right"', '  <path id="scrub-sleeve-left" d="M1 11.4 V9.8 Q1 9 1.8 9 H3.2 Q4 9 4 9.8 V11.4 Z" fill="#A7122D"/>\n    </g>\n    <g id="rig-arm-right"');
rig = replaceOnce(rig, '      <g id="slot-item"/>', `      <path id="scrub-sleeve-right" d="M20 11.4 V9.8 Q20 9 20.8 9 H22.2 Q23 9 23 9.8 V11.4 Z" fill="#A7122D"/>
      <g id="slot-item">
        <g id="clipboard-board" transform="rotate(45 21.5 10.9)">
          <rect x="21.2" y="6.7" width="3" height="4.2" rx="0.36" fill="#F6AE2D"/>
          <rect x="21.95" y="6.42" width="1.5" height="0.52" rx="0.22" fill="#B77823"/>
          <path d="M21.85 8.3 H23.55 M21.85 9.15 H23.55 M21.85 10 H22.95" stroke="#8A5A0B" stroke-width="0.22" stroke-linecap="round"/>
        </g>
      </g>`);
// WHY: Red caps sit on top of each springing leg, leaving the lower paws tan.
// They are inside each leg group so they stay attached during every pose.
rig = replaceOnce(rig, '<rect x="7.2" y="17" width="3.5" height="4" rx="1.2" fill="url(#cvm-limb)"/>', '<rect x="7.2" y="17" width="3.5" height="4" rx="1.2" fill="url(#cvm-limb)"/><path id="scrub-leg-left" d="M8.4 17 H9.5 Q10.7 17 10.7 18.2 V18.5 H7.2 V18.2 Q7.2 17 8.4 17 Z" fill="#A7122D"/>');
rig = replaceOnce(rig, '<rect x="13.3" y="17" width="3.5" height="4" rx="1.2" fill="url(#cvm-limb)"/>', '<rect x="13.3" y="17" width="3.5" height="4" rx="1.2" fill="url(#cvm-limb)"/><path id="scrub-leg-right" d="M14.5 17 H15.6 Q16.8 17 16.8 18.2 V18.5 H13.3 V18.2 Q13.3 17 14.5 17 Z" fill="#A7122D"/>');

// The same cream muzzle sits beneath every generated face: eyes, tracking pupils,
// mouths and blink grammar remain generated and therefore animate as designed.
const muzzle = '<ellipse cx="12" cy="13.25" rx="3.8" ry="1.52" fill="#FFF0D3"/>\n        <ellipse cx="12" cy="12.45" rx="0.6" ry="0.43" fill="#47372D"/>';
const faces = [...rig.matchAll(/<g id="rig-face-[a-z]+"[^>]*>/g)];
if (faces.length !== 8) throw new Error(`Expected eight generated faces, got ${faces.length}`);
for (const [open] of faces) rig = replaceOnce(rig, open, `${open}\n        ${muzzle}`);
writeFileSync(rigPath, rig);
// WHY: The registry auditor compares against its own canonical projection, not the
// theme-builder generator's alternate --from-rig output.
execFileSync(process.execPath, [resolve(repo, 'scripts/flatten-rig.mjs'), 'morning-rounds'], { stdio: 'inherit' });

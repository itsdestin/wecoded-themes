# Mascot Rig Library

Reference material for building YouCoded buddy mascots as **rigs** — a single SVG whose named
groups the app animates (poses, limb-trailing drag physics, blinking, breathing). This folder is
the mix-and-match source for theme authors and for `/theme-builder` when it generates a mascot
from scratch.

> **Status:** the app's rig renderer is designed but not yet shipped (see
> `youcoded-dev/docs/active/specs/2026-07-10-buddy-floater-upgrades-design.md` §3). This folder is
> the authoring source of truth so mascots built now conform when it lands. Nothing here is
> scanned by the registry CI.

## What's in this folder

| Path | What it is |
|---|---|
| `skins/` | The six approved art treatments, each as a complete reference rig on a demo palette. Swap the demo colors for your theme's. |
| `examples/` | Complete per-theme rigs rebuilt to the rig contract, signature components included: Golden Sunbreak and Halftone Dimension (solid/tinted bodies), Kuromi Dreamer and Strawberry Kitty (outline/white bodies). |
| `components/` | Drop-in hats, eyewear, and held items. Paste the file's inner markup into the matching slot group. |

Three ways to make a mascot, in ascending effort:

1. **Mix and match** — pick a skin from `skins/`, recolor it to your theme's palette, drop
   components from `components/` into the slots.
2. **Adapt an example** — start from `examples/golden-sunbreak.rig.svg` or
   `halftone-dimension.rig.svg` for solid/tinted bodies, `examples/kuromi-dreamer.rig.svg`
   or `strawberry-kitty.rig.svg` for outline/white-body style.
3. **Generate from scratch** — follow the constraints in the last section; everything the app
   animates comes free as long as the contract is respected.

## The rig contract

One SVG per theme. The app finds parts by `id`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3 -5 30 30">
  <g id="rig-root">                                  <!-- the idle-motion loop is applied here -->
    <g id="rig-tail"      data-pivot="19 14" >…</g>  <!-- optional; springs like a limb -->
    <g id="rig-arm-left"  data-pivot="2.5 9">…</g>
    <g id="rig-arm-right" data-pivot="21.5 9">… <g id="slot-item"/> </g>
    <g id="rig-leg-left"  data-pivot="8.95 17">…</g>
    <g id="rig-leg-right" data-pivot="15.05 17">…</g>
    <g id="rig-body">
      …body art…
      <g id="rig-face-idle">…</g>
      <g id="rig-face-welcome" style="display:none">…</g>
      <g id="rig-face-curious" style="display:none">…</g>
      <g id="rig-face-shocked" style="display:none">…</g>
      <g id="rig-face-dizzy"   style="display:none">…</g>
      <g id="rig-face-blink"   style="display:none">…</g>
      <g id="slot-eyewear"/>
    </g>
    <g id="slot-hat"/>
    <g id="rig-hand-peek-right" style="display:none">…</g>  <!-- optional grip mittens, see below -->
    <g id="rig-hand-peek-left"  style="display:none">…</g>
  </g>
</svg>
```

- Only `rig-body` is required; missing parts simply don't animate.
- **Limbs hang down from their pivot** — the app's pose data (wave, shocked arms-up, peek grip)
  assumes it. `data-pivot="x y"` is the hinge in viewBox coordinates; omitted, the app uses the
  group's top-center.
- The `viewBox="-3 -5 30 30"` padding leaves headroom for hats (above y 0) and held items
  (right of x 24) while the character itself stays in the classic **24×24 art box**.
- Every face group except `rig-face-idle` starts `style="display:none"`.
- `rig-tail` is optional and springs like a limb during drag (Kuromi's tail wags). Pivot where
  it meets the body.
- Don't draw a ground shadow, and don't add your own animation — poses, drag physics, the
  motion-style idle loops (chill/bouncy/floaty/hyper/sleepy), blinking, greet/drop bounces,
  peek staging, and reduced-effects handling are all app-side and apply to every conforming
  rig automatically.

### Grip hands for the side-edge peek

When the buddy docks to a side screen edge and dozes off, the app stages him hanging over the
frame: two hands planted on the edge, body sagging between them at 75° (approved 2026-07-16).
The hand art comes from the `rig-hand-peek-right` / `rig-hand-peek-left` groups — the app
clones them out of the rig and pins them to the screen edge, so draw each as a single
**fingerless mitten** (a vertical rounded knuckle bump, matching the limb language — NO fingers)
in the same coordinate space as the limbs. Give it a rim stroke darker than the body (body color
mixed ~40% toward black, or your line color on outline skins) so it reads against the
same-colored body behind it.

**Every skin in `skins/` already ships both groups** — start from one and recolor, and you get
them for free. They're the easiest parts to lose, because nothing looks wrong until someone
drags the buddy to a *side* edge: strawberry-kitty and kuromi-dreamer shipped without them and
peeked bare-armed for a day before anyone noticed (2026-07-17). `scripts/audit-rigs.mjs` now
warns on a rig that has no mittens and CI fails a rig that gets them wrong; the geometry is
fixed at `x="0.7"` / `x="20.7"`, `y="8.3"`, `2.6 × 3.4`, `rx="1.17"` — only the paint changes.
Technically the app degrades (a rig without them sinks past the edge bare) but that's a fallback,
not a design.

### Scene companions (flourishes that follow the buddy)

Don't bake scenery (suns, sparkles, speed-lines) statically into the rig — static backdrops
are retired. Flourishes ship as **companions**: small standalone SVGs with a preferred offset
that the app spring-follows behind the buddy (they trail on drag, bob idly, lean while catching
up; reduced-effects pins them in place). Ghost-type companions (Halftone's chromatic after-image)
stay invisible at rest and materialize with lag distance. Keep to a small handful per theme.

Declare them as a TOP-LEVEL `companions` array in `manifest.json` (top-level — NOT inside
`mascot` — so app versions that predate companions ignore them instead of failing to resolve
the theme):

```json
"companions": [
  { "asset": "assets/companions/sun.svg", "size": 0.435, "dx": -0.6, "dy": -0.452,
    "stiffness": 65, "damping": 9, "float": 0.026, "floatMs": 2600 }
]
```

- **All lengths are fractions of the mascot's rendered size** (`size` = width; optional
  `height` for non-square art like Halftone's bars; `dx`/`dy` = offset of the companion's
  center from the mascot's center; `float` = idle-bob amplitude, `floatMs` its period).
- `stiffness`/`damping` tune the follow spring (springier = higher stiffness, lower damping).
- `"ghost": true` marks a lag-distance after-image: invisible at rest, fades in while trailing.
- Companion SVGs go through the same sanitizer as rigs (no scripts/styles/external URLs), and
  the app animates these class names if you use them: `comp-twinkle` (scale+fade shimmer),
  `comp-spin` (slow rotation), `comp-pulse` (soft breathing scale), `comp-bob` (rocking tilt).
  Keep gradient/filter `id`s unique per theme — companions are inlined into the same document.
- Where they render today: the welcome screen mascot scene. The buddy floater's follow physics
  is pending its window-padding redesign (the 80×80 buddy window would clip satellites).

Reference: the four published mascot themes each ship a companions block (`themes/*/manifest.json`).

### Faces are paint, not holes

The legacy flat mascots cut eyes out of the body with `fill-rule="evenodd"`. Rigs keep the body
**solid** and paint eyes on top in a dark socket color (Golden Sunbreak uses `#2a1004`, Halftone
`#1e2636`) — a swappable face has to be its own group. Blink is the idle face with the eyes drawn
as closed curves; the app flashes it for ~120 ms every 6–12 s. Anything shared by all expressions
(whiskers, a nose) is repeated inside each face group so nothing lingers on swap.

The **curious** face convention: welcome-style eye sockets with a bright sparkle cluster as the
pupil, wrapped in `<g class="pupil">` — the app translates those groups up to ±0.55 units to make
the eyes track the cursor. One raised brow + a small "o" mouth. (Dark disc-in-disc pupils were
tried and rejected as creepy.)

### Component slots

| slot | anchor (x y) | art stays within | moves with |
|---|---|---|---|
| `slot-hat` | 12 4 | x 5–19 · y −4 to 6 | body |
| `slot-eyewear` | 12 9.9 | x 4–20 · y 7–13 | body |
| `slot-item` | 21.5 12.8 | ≈4×8 around the hand | the right arm (waves + trails) |

Components are authored around their anchor in the same coordinate space, so any component fits
any capsule mascot. Theme signatures ship *as* components — the dimensional visor is eyewear,
Kuromi's jester hat and Strawberry Kitty's ears-and-bow are hats — which means themes can borrow
each other's.

### Tinting

Rigs are inlined into the app (after sanitizing), so CSS variables resolve — unlike the legacy
`<img>` path, where `currentColor` silently renders black.

- `var(--rig-accent, <fallback>)` — theme accent; default body tint for generated mascots.
- `var(--rig-on-accent, <fallback>)` — face color on accent-tinted bodies.
- `var(--rig-line, <fallback>)` — outline color for white-body mascots (theme `fg`).
- Hardcoded colors are encouraged where they ARE the identity (Golden Sunbreak's `#f0a828`
  amber, Kuromi's `#FF4FB8` pink). Always include a fallback so the file previews standalone.

### Sanitizer rules (the app strips these — don't use them)

`<script>`, `<style>`, `<foreignObject>`, SMIL animation tags (`<animate>`…), any `on*=`
attribute, and external URLs. Only same-document `#refs` and `data:image/*` URLs survive.
Filters, gradients, patterns, and clip paths defined in your own `<defs>` are fine.

## The six approved skins

Approved 2026-07-16 after prototyping (`youcoded-dev` buddy-rig-workbench artifact). Each
reference file documents its color-substitution table in a comment at the top.

| skin | file | treatment |
|---|---|---|
| 2.5D soft | `skins/2-5d-soft.svg` | radial highlight + shade gradient + rim light + specular. The default. |
| Clay | `skins/clay.svg` | matte, broad light, heavy contact shading pooled at the bottom — stop-motion figurine. |
| Comic pop | `skins/comic-pop.svg` | ink outline, hard cel-shade crescent filled with halftone dots, action spark. |
| Comic burst | `skins/comic-burst.svg` | comic pop turned up: speed-line burst behind the body, CMYK misregistration ghost outlines, fat ink, bigger dots. |
| Newsprint | `skins/newsprint.svg` | paper-tint body printed in Ben-Day dots, plates slightly off-register, faces re-inked in press black. |
| Sticker | `skins/sticker.svg` | thin white die-cut border on every part + light shading; the app pairs it with a hard offset drop-shadow. |

For white-body (outline) themes, highlights are invisible — carry the depth in the shade
gradient and contact shadow instead; see the examples.

## Generating a new mascot from scratch

Constraints for `/theme-builder` (or anyone) generating an original buddy. The goal: **a new
character that is still unmistakably the YouCoded buddy.**

**Keep (non-negotiable):**
- The body capsule: `M9 4 L15 4 A4 4 0 0 1 19 8 L19 12 A4 4 0 0 1 15 16 L9 16 A4 4 0 0 1 5 12 L5 8 A4 4 0 0 1 9 4 Z`
  (spans x 5–19, y 4–16, corner radius ≈4). Decorate it, texture it, re-light it — don't reshape it.
- Stubby limbs at the canonical spots: arms ≈ x 1–4 and x 20–23, y 9–13; legs ≈ x 7.2–10.7 and
  x 13.3–16.8, y 17–21. Small shape liberties (rounded ends, mitten hands) are fine; positions and
  proportions are not.
- The full rig contract above: group ids, pivots, all six faces, slots present (empty is fine).
- Eye grammar per expression: idle = `><` squint · welcome = tall sockets with sparkles ·
  curious = sockets with tracking sparkle-pupils + raised brow · shocked = wide rounds + O mouth ·
  dizzy = X X + zigzag mouth · blink = closed curves.

**Choose freely:**
- One of the six approved skins, or an original treatment in their spirit.
- Palette: derive from the theme's tokens (`accent` body / `on-accent` face is the default), or
  hardcode a signature color the way Golden Sunbreak does.
- One or two per-theme flourishes: a scene companion (sun + dust motes — see the companions
  section above; never static scenery), body texture (halftone dots, chromatic ghost lines),
  or a signature component pre-filled into a slot (ears, jester peaks, visor). More than two
  reads as noise.

**Quality bar:**
- Must read at 24 px (the buddy renders around 80 px; details under ~0.3 units vanish).
- Face must contrast with the body ≥ roughly `on-accent`-on-`accent` levels; body must be
  visible against both the theme's `canvas` and arbitrary desktop wallpapers.
- Every face group looks intentional standing still — reduced-effects users never see motion.

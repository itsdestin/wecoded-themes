#!/usr/bin/env node
/**
 * Generates preview.png for each theme using Playwright (headless Chromium).
 *
 * Renders a mock YouCoded UI with the theme's tokens, wallpaper, pattern,
 * glassmorphism, custom CSS, and layout styles applied. Saves to
 * themes/<slug>/preview.png.
 *
 * Usage:
 *   npx playwright install chromium
 *   node scripts/generate-previews.js [slug]                    # specific theme, or all if omitted
 *   node scripts/generate-previews.js [slug] --themes-dir <path>  # override themes directory
 *   node scripts/generate-previews.js [slug] --themes-dir=<path>  # equals-sign form also accepted
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Default themes directory — used by CI and bare local invocations.
// Override with --themes-dir <path> for local theme builders pointing at
// ~/.claude/wecoded-themes or any other out-of-repo location.
const DEFAULT_THEMES_DIR = path.join(__dirname, '..', 'themes');

/**
 * Expand a leading ~ to the user's home directory.
 * The shell expands ~ in the space-separated form (--themes-dir ~/...)
 * but NOT in the equals-sign form (--themes-dir=~/...), so we handle
 * both cases here.
 */
function expandTilde(p) {
  if (p === '~' || p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

/**
 * Parse CLI arguments into { slug, themesDir }.
 * Supports:
 *   node generate-previews.js
 *   node generate-previews.js <slug>
 *   node generate-previews.js [<slug>] --themes-dir <path>
 *   node generate-previews.js [<slug>] --themes-dir=<path>
 */
function parseArgs(argv) {
  const args = argv.slice(2);
  let slug = undefined;
  let themesDir = DEFAULT_THEMES_DIR;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--themes-dir') {
      // Space-separated form: consume the next argument as the path
      themesDir = path.resolve(expandTilde(args[++i]));
    } else if (a.startsWith('--themes-dir=')) {
      // Equals-sign form: extract the path after the '='
      themesDir = path.resolve(expandTilde(a.slice('--themes-dir='.length)));
    } else if (!a.startsWith('--')) {
      // Positional argument: treat as the target slug
      slug = a;
    }
  }
  return { slug, themesDir };
}

const WIDTH = 800;
const HEIGHT = 500;

/**
 * Read a file from the theme directory and return as a base64 data URI.
 * Returns null if the file doesn't exist.
 */
function assetToDataUri(themeDir, relativePath) {
  const absPath = path.join(themeDir, relativePath);
  if (!fs.existsSync(absPath)) return null;

  const ext = path.extname(absPath).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.gif': 'image/gif',
  };
  const mime = mimeTypes[ext] || 'application/octet-stream';
  const data = fs.readFileSync(absPath);
  return `data:${mime};base64,${data.toString('base64')}`;
}

/**
 * Build the preview HTML for a theme.
 */
function buildPreviewHTML(manifest, themeDir) {
  const tokens = manifest.tokens || {};
  const dark = manifest.dark ?? true;
  const name = manifest.name || 'Theme';
  const bubbleStyle = manifest.layout?.['bubble-style'] || 'default';
  const inputStyle = manifest.layout?.['input-style'] || 'default';

  // Build CSS variables from all tokens
  const cssVars = Object.entries(tokens)
    .map(([key, val]) => `--${key}: ${val};`)
    .join('\n      ');

  // Shape variables
  const shape = manifest.shape || {};
  const shapeVars = Object.entries(shape)
    .map(([key, val]) => `--${key}: ${val};`)
    .join('\n      ');

  const isPill = bubbleStyle === 'pill';
  const isFloating = inputStyle === 'floating';

  // Resolve background
  let bgCSS = '';
  const bg = manifest.background;
  if (bg) {
    if (bg.type === 'image' && bg.value) {
      const uri = assetToDataUri(themeDir, bg.value);
      if (uri) {
        bgCSS = `background-image: url("${uri}"); background-size: cover; background-position: center;`;
      }
    } else if (bg.type === 'gradient' && bg.value) {
      bgCSS = `background: ${bg.value};`;
    }
  }

  // Resolve pattern overlay
  let patternCSS = '';
  if (bg?.pattern) {
    const uri = assetToDataUri(themeDir, bg.pattern);
    if (uri) {
      patternCSS = `
      body::before {
        content: '';
        position: fixed;
        inset: 0;
        background-image: url("${uri}");
        background-repeat: repeat;
        background-size: auto;
        opacity: ${bg['pattern-opacity'] ?? 0.06};
        pointer-events: none;
        z-index: 0;
      }`;
    }
  }

  // Glassmorphism
  const blur = bg?.['panels-blur'] || 0;
  const panelsOpacity = bg?.['panels-opacity'] ?? 1;
  let glassCSS = '';
  if (blur > 0) {
    // Compute semi-transparent panel color
    const panelHex = (tokens.panel || '#191919').replace('#', '');
    const r = parseInt(panelHex.slice(0, 2), 16);
    const g = parseInt(panelHex.slice(2, 4), 16);
    const b = parseInt(panelHex.slice(4, 6), 16);
    const panelGlass = `rgba(${r}, ${g}, ${b}, ${panelsOpacity})`;
    glassCSS = `
      .header, .input-bar-bg, .status-bar {
        backdrop-filter: blur(${blur}px) saturate(1.2);
        -webkit-backdrop-filter: blur(${blur}px) saturate(1.2);
        background-color: ${panelGlass} !important;
      }`;
  }

  // Custom CSS (sanitized — but we trust repo content after review)
  const customCSS = manifest.custom_css || '';

  // Google font
  let fontLink = '';
  let fontFamily = 'system-ui, -apple-system, sans-serif';
  if (manifest.font) {
    if (manifest.font['google-font-url']) {
      fontLink = `<link rel="stylesheet" href="${manifest.font['google-font-url']}">`;
    }
    if (manifest.font.family) {
      fontFamily = manifest.font.family;
    }
  }

  return `<!DOCTYPE html>
<html data-theme="${manifest.slug}">
<head>
  <meta charset="utf-8">
  ${fontLink}
  <style>
    :root {
      ${cssVars}
      ${shapeVars}
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: ${WIDTH}px;
      height: ${HEIGHT}px;
      background: var(--canvas);
      ${bgCSS}
      font-family: ${fontFamily};
      overflow: hidden;
      display: flex;
      flex-direction: column;
      position: relative;
    }

    ${patternCSS}
    ${glassCSS}
    ${customCSS}

    .header {
      height: 44px;
      background: var(--panel);
      border-bottom: 1px solid var(--edge);
      display: flex;
      align-items: center;
      padding: 0 16px;
      gap: 10px;
      flex-shrink: 0;
      position: relative;
      z-index: 10;
    }
    .header-dot { width: 8px; height: 8px; border-radius: 50%; }
    .header-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--fg);
      flex: 1;
    }
    .header-badge {
      font-size: 9px;
      padding: 2px 8px;
      border-radius: 9999px;
      background: var(--accent);
      color: var(--on-accent);
      font-weight: 600;
    }

    .chat {
      flex: 1;
      padding: 20px 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      overflow: hidden;
      position: relative;
      z-index: 1;
    }

    .bubble {
      max-width: 70%;
      padding: ${isPill ? '10px 18px' : '12px 16px'};
      font-size: 12px;
      line-height: 1.6;
      border-radius: ${isPill ? '20px' : 'var(--radius-lg, 12px)'};
    }
    .bubble.user {
      align-self: flex-end;
      background: var(--accent);
      color: var(--on-accent);
    }
    .bubble.assistant {
      align-self: flex-start;
      background: var(--panel);
      color: var(--fg);
      border: 1px solid var(--edge-dim, var(--edge));
    }
    .bubble .meta {
      font-size: 9px;
      color: var(--fg-muted);
      margin-bottom: 4px;
    }
    .bubble.user .meta {
      color: var(--on-accent);
      opacity: 0.7;
    }

    .tool-card {
      align-self: flex-start;
      background: var(--inset);
      border: 1px solid var(--edge-dim, var(--edge));
      border-radius: var(--radius-md, 8px);
      padding: 10px 14px;
      max-width: 60%;
    }
    .tool-card .tool-name {
      font-size: 10px;
      font-weight: 600;
      color: var(--accent);
      margin-bottom: 4px;
    }
    .tool-card .tool-body {
      font-size: 11px;
      color: var(--fg-dim);
      font-family: 'Cascadia Mono', 'Fira Code', monospace;
    }

    .input-bar {
      padding: 12px 16px;
      flex-shrink: 0;
      position: relative;
      z-index: 10;
    }
    .input-bar-bg {
      background: ${isFloating ? 'transparent' : 'var(--panel)'};
      ${isFloating ? '' : 'border-top: 1px solid var(--edge);'}
      padding: ${isFloating ? '0' : '0'};
    }
    .input-inner {
      display: flex;
      align-items: center;
      gap: 8px;
      background: ${isFloating ? 'var(--panel)' : 'var(--well)'};
      border: 1px solid var(--edge-dim, var(--edge));
      border-radius: ${isFloating ? 'var(--radius-xl, 16px)' : 'var(--radius-md, 8px)'};
      padding: 10px 14px;
      ${isFloating ? 'box-shadow: 0 2px 12px rgba(0,0,0,0.15);' : ''}
    }
    .input-placeholder {
      font-size: 12px;
      color: var(--fg-faint);
      flex: 1;
    }
    .send-btn {
      width: 28px; height: 28px;
      border-radius: 50%;
      background: var(--accent);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .send-btn svg { width: 14px; height: 14px; }

    .status-bar {
      height: 28px;
      background: var(--panel);
      border-top: 1px solid var(--edge);
      display: flex;
      align-items: center;
      padding: 0 12px;
      gap: 8px;
      flex-shrink: 0;
      position: relative;
      z-index: 10;
    }
    .status-pill {
      font-size: 9px;
      padding: 2px 8px;
      border-radius: 9999px;
      background: var(--well);
      color: var(--fg-dim);
    }
    .status-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: #34c759;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-dot" style="background: var(--accent)"></div>
    <div class="header-title">${escapeHtml(name)}</div>
    <div class="header-badge">Theme Preview</div>
  </div>

  <div class="chat">
    <div class="bubble user">
      <div class="meta">You</div>
      Can you help me build a new feature?
    </div>
    <div class="bubble assistant">
      <div class="meta">Claude</div>
      Of course! I'd be happy to help. Let me take a look at the codebase first to understand the architecture.
    </div>
    <div class="tool-card">
      <div class="tool-name">Read src/main/app.ts</div>
      <div class="tool-body">export function createApp() { ... }</div>
    </div>
    <div class="bubble assistant">
      <div class="meta">Claude</div>
      I can see the entry point. Here's what I'd recommend for the implementation...
    </div>
  </div>

  <div class="input-bar">
    <div class="input-bar-bg">
      <div class="input-inner">
        <span class="input-placeholder">Message Claude...</span>
        <div class="send-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--on-accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </div>
      </div>
    </div>
  </div>

  <div class="status-bar">
    <div class="status-dot"></div>
    <span class="status-pill">sonnet</span>
    <span class="status-pill">42% context</span>
    <span style="flex:1"></span>
    <span class="status-pill">${dark ? 'Dark' : 'Light'}</span>
  </div>
</body>
</html>`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function generatePreview(browser, slug, themesDir) {
  const themeDir = path.join(themesDir, slug);
  const manifestPath = path.join(themeDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    console.log(`  skip: ${slug} (no manifest.json)`);
    return false;
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const outputPath = path.join(themeDir, 'preview.png');

  // Skip themes whose preview.png is already newer than manifest.json.
  // The publisher PR ships a preview generated by this same script at
  // finalize, and regenerating here in CI would just churn the file.
  // FORCE_REGENERATE_PREVIEWS=1 (or the workflow_dispatch input) is the
  // escape hatch when the mockup template changes and a full sweep is needed.
  // CAUTION (2026-09-24): the committed previews are now screenshots of the REAL
  // app, taken by youcoded-dev's scripts/ui-review/theme-previews.py. A forced
  // sweep here replaces them with this script's mock page — re-run that script
  // instead when previews need refreshing. This script still makes the preview
  // for a NEW theme that arrives without one.
  const force = process.env.FORCE_REGENERATE_PREVIEWS === '1';
  if (!force && fs.existsSync(outputPath)) {
    const previewMtime = fs.statSync(outputPath).mtimeMs;
    const manifestMtime = fs.statSync(manifestPath).mtimeMs;
    if (previewMtime >= manifestMtime) {
      const size = fs.statSync(outputPath).size;
      console.log(`  skip: ${slug} -> preview.png exists (${(size / 1024).toFixed(1)} KB, fresh)`);
      return false;
    }
  }

  const html = buildPreviewHTML(manifest, themeDir);

  const page = await browser.newPage();
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.setContent(html, { waitUntil: 'networkidle' });

  // Extra wait for fonts and rendering
  await page.waitForTimeout(500);

  await page.screenshot({ path: outputPath, type: 'png' });
  await page.close();

  const size = fs.statSync(outputPath).size;
  console.log(`  done: ${slug} -> preview.png (${(size / 1024).toFixed(1)} KB)`);
  return true;
}

async function main() {
  const { slug: targetSlug, themesDir } = parseArgs(process.argv);

  // Validate the themes directory up front so callers get a clear error
  // instead of a cryptic ENOENT stack trace from readdirSync.
  if (!fs.existsSync(themesDir)) {
    console.error(`themes-dir not found: ${themesDir}`);
    process.exit(1);
  }

  const slugs = targetSlug
    ? [targetSlug]
    : fs.readdirSync(themesDir).filter(entry => {
        const p = path.join(themesDir, entry);
        return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'manifest.json'));
      });

  console.log(`Generating previews for ${slugs.length} theme(s)...`);

  const browser = await chromium.launch();
  let generated = 0;

  for (const slug of slugs) {
    const ok = await generatePreview(browser, slug, themesDir);
    if (ok) generated++;
  }

  await browser.close();
  console.log(`Done: ${generated}/${slugs.length} preview(s) generated`);
}

main().catch(err => {
  console.error('Preview generation failed:', err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Stylesheet and font safety audit (2026-10-30 security audit SC-1 / SC-2).
 *
 * Why this exists: a theme's custom_css styles the WHOLE app, and font.google-font-url
 * becomes a <link rel=stylesheet>. Anything that can fetch from the web lets a theme
 * (a) track every user who opens it (address, time) and (b) change what it serves after
 * review. The old CI check was three regexes, which these beat:
 *   - CSS escapes:       url(\68ttps://x)   u\72l(https://x)   @\69mport "https://x"
 *   - plain-string forms: image-set("https://x" 1x)   src("https://x")
 *   - split keywords:    @imp@import a;ort "https://x"
 * So the scanner below reads the stylesheet the way a browser does: it decodes escapes
 * in names and addresses first, then judges the decoded text. It is a PORT of the app's
 * own sanitizer (youcoded desktop/src/renderer/themes/theme-validator.ts, sanitizeCSS) -
 * keep the two in step. The app cleans stylesheets at install time (the real protection,
 * also covering hand-installed themes); this check stops them at submission.
 *
 * A stylesheet is accepted only if the sanitizer would return it UNCHANGED (a clean
 * stylesheet comes back byte-for-byte identical), so the rule is simply "nothing to remove".
 * theme-asset:, data:, blob:, #fragment and relative addresses are fine.
 *
 * Also: font.google-font-url must be https://fonts.googleapis.com/css2?... and nothing else.
 *
 * Usage: node scripts/audit-css-safety.mjs [--self-test] [slug ...]
 *   no slugs      audits EVERY theme (cheap)
 *   --self-test   runs known-bad samples first and fails if any slips through
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---- scanner (ported from the app; do not "improve" it here without changing the app too) ----
// WHY a scanner instead of regexes (2026-10-30 security audit F3/SC-2): the old regex filter was beaten three ways
// — `@imp@import a;ort "https://x"` (removing the inner rule glued the outer keyword back together), `image-set("https://x" 1x)`
// (a web address in a plain string, no url()), and CSS escapes (`u\72l(`, `url(\68ttps://x)`). A browser reads escapes
// as the real characters, so this reads the stylesheet the way a browser does: it decodes escapes in names and addresses
// first, then checks what the decoded text is. Anything that could fetch from the network is blocked; theme-asset:, data:,
// blob:, #fragment and plain relative addresses stay.
/** Schemes a theme stylesheet may point at — none of these leave the computer. */
const SAFE_URL_SCHEMES = new Set(['theme-asset:', 'data:', 'blob:']);
/** CSS functions whose string arguments are addresses (besides url() itself). */
const URL_STRING_FUNCTIONS = new Set(['url', 'src', 'image', 'image-set', '-webkit-image-set', 'cross-fade', '-webkit-cross-fade']);
const isHex = (c) => /[0-9a-fA-F]/.test(c);
const isNameChar = (c) => /[A-Za-z0-9_\-]/.test(c) || c.charCodeAt(0) > 0x7f;
/** Reads one CSS escape starting at the backslash at css[i]; returns the character it stands for and the next index. */
function readEscape(css, i) {
    let j = i + 1;
    if (j >= css.length)
        return { ch: '\uFFFD', next: j };
    if (isHex(css[j])) {
        let hex = '';
        while (j < css.length && hex.length < 6 && isHex(css[j]))
            hex += css[j++];
        if (/[ \t\n\r\f]/.test(css[j] ?? ''))
            j++; // one whitespace after a hex escape belongs to it
        const cp = parseInt(hex, 16);
        return { ch: cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? '\uFFFD' : String.fromCodePoint(cp), next: j };
    }
    return { ch: css[j], next: j + 1 };
}
/** Reads an identifier (escapes decoded) starting at i. */
function readIdent(css, i) {
    let name = '';
    let j = i;
    while (j < css.length) {
        if (css[j] === '\\') {
            const e = readEscape(css, j);
            name += e.ch;
            j = e.next;
        }
        else if (isNameChar(css[j]))
            name += css[j++];
        else
            break;
    }
    return { name, next: j };
}
/** Reads a quoted string at css[i] (the opening quote); returns its decoded text and the index after the closing quote. */
function readString(css, i) {
    const quote = css[i];
    let value = '';
    let j = i + 1;
    while (j < css.length && css[j] !== quote) {
        if (css[j] === '\\') {
            if (css[j + 1] === '\n') {
                j += 2;
                continue;
            } // escaped newline continues the string
            const e = readEscape(css, j);
            value += e.ch;
            j = e.next;
        }
        else if (css[j] === '\n')
            break; // unescaped newline ends a bad string
        else
            value += css[j++];
    }
    return { value, next: j < css.length && css[j] === quote ? j + 1 : j };
}
/** True when a decoded address cannot reach the network. */
function isSafeCssUrl(decoded) {
    // Browsers drop tabs/newlines/control characters and leading spaces inside an address before reading it.
    const u = decoded.replace(/[\u0000-\u0020\u007f]/g, '');
    if (u === '')
        return true;
    if (u.startsWith('#'))
        return true;
    // `//host`, `\\host` and `/\host` all mean "another computer" to a browser.
    if (/^[\\/]{2}/.test(u))
        return false;
    const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*:)/.exec(u);
    if (scheme)
        return SAFE_URL_SCHEMES.has(scheme[1].toLowerCase());
    return true; // plain relative address: resolves inside the app's own folder
}
/** Index just past the ")" that closes the "(" at css[open], skipping strings and escapes. */
function closeParen(css, open) {
    let depth = 0;
    for (let j = open; j < css.length; j++) {
        const c = css[j];
        if (c === '"' || c === "'") {
            j = readString(css, j).next - 1;
        }
        else if (c === '\\') {
            j = readEscape(css, j).next - 1;
        }
        else if (c === '(')
            depth++;
        else if (c === ')') {
            depth--;
            if (depth === 0)
                return j + 1;
        }
    }
    return css.length;
}
/** Index just past the end of an at-rule that starts at i: through its ";" or its {...} block. */
function endOfAtRule(css, i) {
    for (let j = i; j < css.length; j++) {
        const c = css[j];
        if (c === '"' || c === "'")
            j = readString(css, j).next - 1;
        else if (c === '\\')
            j = readEscape(css, j).next - 1;
        else if (c === '(')
            j = closeParen(css, j) - 1;
        else if (c === ';')
            return j + 1;
        else if (c === '{') {
            let depth = 0;
            for (let k = j; k < css.length; k++) {
                if (css[k] === '{')
                    depth++;
                else if (css[k] === '}' && --depth === 0)
                    return k + 1;
            }
            return css.length;
        }
    }
    return css.length;
}
/** One scan: returns the stylesheet with every network-capable construct removed. */
function sanitizeOnce(css) {
    let out = '';
    let i = 0;
    // Depth of "(" inside a function whose strings are addresses; 0 = not inside one.
    let urlFnDepth = 0;
    const parenStack = []; // true for each open "(" that belongs to an address function
    while (i < css.length) {
        const c = css[i];
        if (c === '/' && css[i + 1] === '*') { // comment: copy untouched
            const close = css.indexOf('*/', i + 2);
            const end = close === -1 ? css.length : close + 2;
            out += css.slice(i, end);
            i = end;
            continue;
        }
        if (c === '"' || c === "'") {
            const s = readString(css, i);
            if (urlFnDepth > 0 && !isSafeCssUrl(s.value))
                out += '""'; // address inside image-set()/src()/…
            else
                out += css.slice(i, s.next);
            i = s.next;
            continue;
        }
        if (c === '@') {
            const id = readIdent(css, i + 1);
            const name = id.name.toLowerCase();
            if (name === 'import') {
                i = endOfAtRule(css, i);
                continue;
            } // could pull in a stylesheet that changes later
            out += css.slice(i, id.next || i + 1);
            i = id.next || i + 1;
            continue;
        }
        if (c === '\\' || isNameChar(c)) {
            const start = i;
            const id = readIdent(css, i);
            const name = id.name.toLowerCase();
            if (css[id.next] === '(') {
                if (name === 'expression') {
                    out += '/* blocked */';
                    i = closeParen(css, id.next);
                    continue;
                }
                if (name === 'url') {
                    // Unquoted url(...) is one token; quoted is a function holding a string (handled by the string branch).
                    let j = id.next + 1;
                    while (j < css.length && /[ \t\n\r\f]/.test(css[j]))
                        j++;
                    if (css[j] === '"' || css[j] === "'") {
                        // Quoted url("..."): judge the string; a blocked one takes the whole call with it.
                        const str = readString(css, j);
                        if (!isSafeCssUrl(str.value)) {
                            let k = str.next;
                            while (k < css.length && css[k] !== ')')
                                k++;
                            out += 'url(/* blocked */)';
                            i = k < css.length ? k + 1 : k;
                            continue;
                        }
                    }
                    else {
                        let value = '';
                        while (j < css.length && css[j] !== ')') {
                            if (css[j] === '\\') {
                                const e = readEscape(css, j);
                                value += e.ch;
                                j = e.next;
                            }
                            else
                                value += css[j++];
                        }
                        const end = j < css.length ? j + 1 : j;
                        out += isSafeCssUrl(value) ? css.slice(start, end) : 'url(/* blocked */)';
                        i = end;
                        continue;
                    }
                }
                out += css.slice(start, id.next + 1);
                const isAddressFn = URL_STRING_FUNCTIONS.has(name);
                parenStack.push(isAddressFn);
                if (isAddressFn)
                    urlFnDepth++;
                i = id.next + 1;
                continue;
            }
            if (name === '-moz-binding') { // old Firefox script-binding property
                let j = id.next;
                while (j < css.length && /[ \t\n\r\f]/.test(css[j]))
                    j++;
                if (css[j] === ':') {
                    let k = j;
                    while (k < css.length && css[k] !== ';' && css[k] !== '}')
                        k++;
                    out += '/* blocked */';
                    i = css[k] === ';' ? k + 1 : k;
                    continue;
                }
            }
            out += css.slice(start, Math.max(id.next, start + 1));
            i = Math.max(id.next, start + 1);
            continue;
        }
        if (c === '(') {
            parenStack.push(false);
        }
        if (c === ')') {
            if (parenStack.pop())
                urlFnDepth--;
        }
        out += c;
        i++;
    }
    return out;
}
/**
 * Sanitizes a CSS string by stripping dangerous patterns that could
 * load external resources or execute code. Safe patterns like
 * theme-asset:// and data: URIs are preserved, and a stylesheet with nothing
 * dangerous in it comes back byte-for-byte unchanged.
 */
export function sanitizeCSS(css) {
    let result = css;
    // Removing a rule can glue the text on either side into a new one (`@imp` + `ort "x"`), so go again until nothing changes.
    for (let pass = 0; pass < 8; pass++) {
        const next = sanitizeOnce(result)
            // javascript: has no business anywhere in a stylesheet.
            .replace(/javascript\s*:/gi, '/* blocked */');
        if (next === result)
            return result;
        result = next;
    }
    return '/* blocked: stylesheet kept changing under sanitising */';
}

/** Only Google's stylesheet host may supply a theme font. css2 only, no credentials, no odd characters. */
const GOOGLE_FONT_URL = /^https:\/\/fonts\.googleapis\.com\/css2\?[A-Za-z0-9:;,@=&+%._~!*'()\-\/]*$/;
export function isAllowedGoogleFontUrl(url) {
  return typeof url === 'string' && url.length <= 2048 && GOOGLE_FONT_URL.test(url);
}

/** Returns a list of human-readable problems for one parsed manifest. */
export function auditManifest(manifest) {
  const problems = [];
  const css = manifest.custom_css;
  if (css !== undefined && typeof css !== 'string') problems.push('custom_css must be text');
  else if (typeof css === 'string' && sanitizeCSS(css) !== css) {
    problems.push('custom_css contains something that could load from the web or run code (remote url()/@import/image-set()/src(), expression(), -moz-binding, javascript:), including escaped spellings');
  }
  const url = manifest.font?.['google-font-url'];
  if (url !== undefined && !isAllowedGoogleFontUrl(url)) {
    problems.push('font.google-font-url must be https://fonts.googleapis.com/css2?... (nothing else is allowed)');
  }
  return problems;
}

const BAD_CSS = [
  'a{background:url(https://evil.example/p.png)}',
  'a{background:url("//evil.example/p.png")}',
  '@import "https://evil.example/x.css";',
  '@import url(https://evil.example/x.css);',
  '@\\69mport "https://evil.example/x.css";',
  '@imp@import a;ort "https://evil.example/x.css"; body{color:red}',
  'a{background:image-set("https://evil.example/b.png" 1x)}',
  'a{background:-webkit-image-set(url(https://evil.example/b.png) 1x)}',
  'a{background:src("https://evil.example/b.png")}',
  'a{background:url(\\68ttps://evil.example/b.png)}',
  'a{background:u\\72l(https://evil.example/b.png)}',
  'a{background:url("\\68 ttps://evil.example/b.png")}',
  'a{background:url("ht\ttps://evil.example/b.png")}',
  'a{background:url("\\\\\\\\evil.example/b.png")}',
  'a{background:url(ftp://evil.example/b)}',
  'a{background:url(file:///etc/passwd)}',
  'a{width:expression(alert(1))}',
  'a{-moz-binding:url(x)}',
  'a{background:url(javascript:alert(1))}',
];
const GOOD_CSS = [
  'a{background:url(theme-asset://s/a.png)} b{background:image-set("theme-asset://s/b.png" 1x)} c{filter:url(#f)} d{background:url(img/x.png)}',
  'e{background:url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\'/>")}',
  '/* a comment about https://example.com */ body{color:red}',
];
const BAD_FONTS = [
  'http://fonts.googleapis.com/css2?family=A', 'https://evil.example/css2?family=A',
  'https://fonts.googleapis.com.evil.example/css2?family=A', 'https://fonts.googleapis.com/css?family=A',
  'https://fonts.googleapis.com/css2?family=A\\evil', 'https://user@fonts.googleapis.com/css2?family=A',
  '//fonts.googleapis.com/css2?family=A', '', 42, null,
];

function selfTest() {
  const slipped = [];
  for (const css of BAD_CSS) if (auditManifest({ custom_css: css }).length === 0) slipped.push(`css: ${css}`);
  for (const css of GOOD_CSS) if (auditManifest({ custom_css: css }).length !== 0) slipped.push(`wrongly rejected css: ${css}`);
  for (const url of BAD_FONTS) if (auditManifest({ font: { 'google-font-url': url } }).length === 0) slipped.push(`font: ${String(url)}`);
  if (auditManifest({ font: { 'google-font-url': 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap' } }).length) slipped.push('wrongly rejected a normal Google Fonts address');
  if (slipped.length) {
    console.error('::error::audit-css-safety self-test failed. These were not handled correctly:');
    for (const s of slipped) console.error('  ' + s);
    process.exit(1);
  }
  console.log(`✓ self-test: ${BAD_CSS.length} bad stylesheets and ${BAD_FONTS.length} bad font addresses rejected, ${GOOD_CSS.length} good stylesheets accepted`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) selfTest();
  const themesDir = join(ROOT, 'themes');
  let slugs = args.filter((a) => !a.startsWith('--'));
  if (!slugs.length) slugs = readdirSync(themesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  let failed = false;
  for (const slug of slugs) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) { console.error(`::error::Invalid theme directory name: ${slug}`); failed = true; continue; }
    const file = join(themesDir, slug, 'manifest.json');
    if (!existsSync(file)) continue;
    let manifest;
    try { manifest = JSON.parse(readFileSync(file, 'utf8')); } catch { console.error(`::error file=${file}::Invalid JSON`); failed = true; continue; }
    for (const p of auditManifest(manifest)) { console.error(`::error file=themes/${slug}/manifest.json::${slug}: ${p}`); failed = true; }
  }
  if (failed) process.exit(1);
  console.log(`✓ stylesheet and font safety: ${slugs.length} theme(s) clean`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();

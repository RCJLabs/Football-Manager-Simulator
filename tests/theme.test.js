// The light theme and text size (styles.css, src/ui/theme.js, index.html).
//
// A theme is only as good as the rules that remember to use it: one colour
// written into a rule is a spot the other theme silently misses. So the first
// tests here are about where colour may be named at all, and the contrast
// tests read the tokens themselves, so a token edited later is measured again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { applyAppearance, resolveTheme, BAR_COLOURS, THEMES, TEXT_SIZES } from '../src/ui/theme.js';

const ROOT = new URL('..', import.meta.url).pathname;
const CSS = readFileSync(join(ROOT, 'src/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
// The dark theme is the :root block that declares the dark colour scheme.
const DARK_HEAD = /:root \{\s*color-scheme: dark;/;
const LIGHT_HEAD = ':root[data-theme="light"] {';

function block(css, head) {
  const i = typeof head === 'string' ? css.indexOf(head) : css.search(head);
  assert.ok(i >= 0, `no block ${head}`);
  return css.slice(i, css.indexOf('\n}', i) + 2);
}
function tokens(text) {
  const out = {};
  for (const m of text.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const DARK = tokens(block(CSS, DARK_HEAD));
const LIGHT = { ...DARK, ...tokens(block(CSS, LIGHT_HEAD)) };
// Every :root block that is not a theme (the tab bar height, the gutter).
const OTHER_ROOT = tokens([...CSS.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1]).join('\n'));

const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\b(?:white|black|red|green|blue|yellow|orange|gr[ae]y|purple|pink|brown|gold|silver)\b/;

test('no rule names a colour: every one comes from a theme token', () => {
  const rest = CSS.replace(block(CSS, DARK_HEAD), '').replace(block(CSS, LIGHT_HEAD), '');
  const found = [];
  for (const m of rest.matchAll(/\{([^{}]*)\}/g)) {
    for (const decl of m[1].split(';')) {
      const k = decl.indexOf(':');
      if (k < 0) continue;
      // A token's name (var(--t-green)) is not a colour; what is left is.
      const prop = decl.slice(0, k).trim(), val = decl.slice(k + 1).replace(/var\([^)]*\)/g, '');
      if (COLOUR.test(val)) found.push(`${prop}:${decl.slice(k + 1).trim()}`);
    }
  }
  assert.deepEqual(found, [], 'colours named outside the theme blocks');
});

test('every token a rule or a module asks for is defined, and the light theme overrides only tokens that exist', () => {
  const defined = { ...OTHER_ROOT, ...DARK };
  const asked = new Set([...CSS.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)].filter((m) => m[2] === ')').map((m) => m[1]));
  const js = [];
  const walk = (dir) => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) js.push(p); } };
  walk(join(ROOT, 'src/ui'));
  js.push(join(ROOT, 'src/main.js'));
  for (const f of js) for (const m of readFileSync(f, 'utf8').matchAll(/var\(\s*(--[\w-]+)(\$\{)?/g)) asked.add(m[2] ? `${m[1]}1` : m[1]);
  const missing = [...asked].filter((t) => !(t in defined));
  assert.deepEqual(missing, [], 'tokens used and never defined');
  const stray = Object.keys(tokens(block(CSS, LIGHT_HEAD))).filter((t) => !(t in DARK));
  assert.deepEqual(stray, [], 'light tokens with no dark counterpart');
});

const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function rgba(v) {
  v = v.trim();
  if (v.startsWith('#')) {
    let h = v.slice(1);
    if (h.length <= 4) h = h.split('').map((c) => c + c).join('');
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1);
  }
  const m = v.match(/rgba?\(([^)]+)\)/);
  assert.ok(m, `not a colour: ${v}`);
  const p = m[1].split(',').map(Number);
  return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
}
const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
function ratio(theme, fg, bg) {
  const b = rgba(theme[bg]);
  let f = rgba(theme[fg]);
  if (f[3] < 1) f = f.slice(0, 3).map((c, i) => c * f[3] + b[i] * (1 - f[3])).concat(1);
  const A = lum(f), B = lum(b);
  return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05);
}

test('every text pair the screens draw holds 4.5:1, and every line that marks a state 3:1, in both themes', () => {
  const bad = [];
  const need = (name, theme, fg, bg, min) => { const r = ratio(theme, fg, bg); if (r < min - 0.005) bad.push(`${name}: ${fg} on ${bg} ${r.toFixed(2)} < ${min}`); };
  for (const [name, theme] of [['dark', DARK], ['light', LIGHT]]) {
    for (const bg of ['--bg', '--bg-2', '--bg-3', '--card', '--deep']) {
      need(name, theme, '--text', bg, 4.5);
      need(name, theme, '--muted', bg, 4.5);
      need(name, theme, '--accent-ink', bg, 4.5);
    }
    for (const bg of ['--bg', '--bg-2', '--card']) for (const fg of ['--good', '--bad', '--info']) need(name, theme, fg, bg, 4.5);
    for (const t of Object.keys(theme).filter((k) => /^--t-[a-z]+$/.test(k))) need(name, theme, `${t}-ink`, t, 4.5);
    for (let n = 1; n <= 5; n++) need(name, theme, `--series-${n}`, '--bg-2', 4.5);
    need(name, theme, '--on-accent', '--accent', 4.5);
    need(name, theme, '--on-accent', '--accent-hover', 4.5);
    need(name, theme, '--clock-ink', '--clock-cell', 4.5);
    need(name, theme, '--clock-head-ink', '--t-green', 4.5);
    need(name, theme, '--notice-ink', '--notice-bg', 4.5);
    need(name, theme, '--toast-ink', '--toast-bg', 4.5);
    need(name, theme, '--alarm-ink', '--alarm-bg', 4.5);
    for (const o of ['--ovr', '--ovr-90', '--ovr-85', '--ovr-80', '--ovr-0']) need(name, theme, '--ovr-ink', o, 4.5);
    need(name, theme, '--ovr-95-ink', '--ovr-95', 4.5);
    // Lines: the focus ring and the borders that say "yours" or "chosen".
    for (const bg of ['--bg', '--bg-2']) need(name, theme, '--accent-ink', bg, 3);
    need(name, theme, '--dot', '--bg-2', 3);
    need(name, theme, '--dot-on-accent', '--accent', 3);
  }
  // A form field's edge is the only thing that marks it out on the light page.
  for (const bg of ['--bg', '--bg-2']) need('light', LIGHT, '--input-line', bg, 3);
  assert.deepEqual(bad, []);
});

test('the bar colours a meta tag has to name are the pages\' own grounds', () => {
  assert.equal(BAR_COLOURS.dark, DARK['--bg']);
  assert.equal(BAR_COLOURS.light, LIGHT['--bg']);
});

// A document and a window, just enough of each for the two appliers.
function page({ stored, systemLight, storageThrows = false }) {
  const attrs = {};
  const meta = { content: '#0f1a12', setAttribute(k, v) { this[k] = v; } };
  const documentElement = { setAttribute: (k, v) => { attrs[k] = String(v); }, removeAttribute: (k) => { delete attrs[k]; } };
  const doc = { documentElement, querySelector: (q) => (q === 'meta[name="theme-color"]' ? meta : null) };
  const win = { matchMedia: (q) => ({ matches: q === '(prefers-color-scheme: light)' && systemLight }) };
  const localStorage = { getItem: (k) => { if (storageThrows) throw new Error('blocked'); return k === 'gridiron-eras:prefs:v1' ? stored : null; } };
  return { attrs, meta, doc, win, localStorage };
}

test('the script that runs before the first paint agrees with theme.js for every setting', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(inline.length, 1, 'one inline script');
  let cases = 0;
  const prefsCases = [];
  for (const theme of [undefined, ...THEMES, 'purple']) for (const textSize of [undefined, ...TEXT_SIZES, 'huge']) prefsCases.push({ theme, textSize });
  for (const prefs of prefsCases) for (const systemLight of [false, true]) for (const shape of ['json', 'missing', 'garbage', 'throws']) {
    const stored = shape === 'json' ? JSON.stringify(prefs) : shape === 'garbage' ? '{not json' : null;
    const a = page({ stored, systemLight, storageThrows: shape === 'throws' });
    const ctx = { localStorage: a.localStorage, document: a.doc, JSON };
    ctx.window = { ...a.win, localStorage: a.localStorage };
    vm.runInNewContext(inline[0], ctx);
    const b = page({ stored, systemLight });
    const used = shape === 'json' ? prefs : {};
    const theme = applyAppearance(used, b.doc, b.win);
    assert.deepEqual(a.attrs, b.attrs, `${JSON.stringify(prefs)} ${shape} system ${systemLight ? 'light' : 'dark'}`);
    assert.equal(a.meta.content, b.meta.content);
    assert.equal(theme, resolveTheme(used.theme, systemLight));
    cases++;
  }
  assert.equal(cases, prefsCases.length * 8);
});

test('the theme follows the choice, or the system when left to it; text size only takes the sizes it has', () => {
  assert.equal(resolveTheme('light', false), 'light');
  assert.equal(resolveTheme('dark', true), 'dark');
  assert.equal(resolveTheme('system', true), 'light');
  assert.equal(resolveTheme(undefined, false), 'dark');
  const p = page({ systemLight: false });
  p.attrs['data-text'] = 'xl';
  applyAppearance({ textSize: 'm' }, p.doc, p.win);
  assert.equal(p.attrs['data-text'], undefined, 'Default takes the size back off');
  applyAppearance({ textSize: 'xl', theme: 'light' }, p.doc, p.win);
  assert.deepEqual(p.attrs, { 'data-theme': 'light', 'data-text': 'xl' });
  assert.equal(p.meta.content, BAR_COLOURS.light);
  for (const size of ['l', 'xl']) assert.match(CSS, new RegExp(`:root\\[data-text="${size}"\\]\\s*\\{\\s*font-size:\\s*1[0-9]{2}%`));
});

test('colours written into modules stay where a theme cannot reach and does not need to', () => {
  // Each of these draws on a ground of its own: the turf, a club's colours, a
  // picture that is always dark, a club's colour picker, and a meta tag.
  const ALLOWED = {
    'src/ui/field.js': 'drawn on its own turf, the same in both themes',
    'src/ui/crest.js': "a club's own colours, and the rim of the always-dark share cards",
    'src/ui/share-card.js': 'a picture with its own dark ground',
    'src/ui/views/setup.js': "the colour picker's default club colour",
    'src/ui/theme.js': 'the browser bar colours, which a meta tag cannot read from CSS',
  };
  const hits = [];
  const walk = (dir) => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) {
    const rel = p.slice(ROOT.length);
    if (ALLOWED[rel]) continue;
    for (const m of readFileSync(p, 'utf8').matchAll(/(['"`(:=\s])(#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b|rgba?\([\d\s.,]+\))/g)) hits.push(`${rel}: ${m[2]}`);
  } } };
  walk(join(ROOT, 'src/ui'));
  assert.deepEqual(hits, []);
});

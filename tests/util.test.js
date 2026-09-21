import { test } from 'node:test';
import assert from 'node:assert/strict';
import { html, raw, esc, isRaw, textOn, ordinal, pct } from '../src/util.js';
import { AI_TEAMS } from '../src/data/teams.js';
import { PRO_TEAMS } from '../src/data/pro.js';

test('interpolated values are escaped', () => {
  assert.equal(html`<p>${'Ed "Too Tall" Jones & <b>'}</p>`.__raw, '<p>Ed &quot;Too Tall&quot; Jones &amp; &lt;b&gt;</p>');
  assert.equal(esc("Le'Veon"), 'Le&#39;Veon');
});

test('raw markup passes through, including an empty one', () => {
  assert.equal(html`<p>${raw('<b>x</b>')}</p>`.__raw, '<p><b>x</b></p>');
  // An empty raw value must render as nothing. It used to stringify to
  // "[object Object]" and leak into every empty list in the app.
  assert.equal(html`<p>${raw('')}</p>`.__raw, '<p></p>');
  assert.equal(html`<p>${html``}</p>`.__raw, '<p></p>');
});

test('nullish and false render as nothing, zero renders as zero', () => {
  assert.equal(html`a${null}b${undefined}c${false}d${0}`.__raw, 'abcd0');
});

test('arrays join, escaping strings and keeping raw parts', () => {
  assert.equal(html`${[raw('<i>a</i>'), 'b&c']}`.__raw, '<i>a</i>b&amp;c');
  assert.equal(html`${[]}`.__raw, '');
});

test('isRaw recognises html and raw values only', () => {
  assert.ok(isRaw(raw('')));
  assert.ok(isRaw(html`x`));
  assert.ok(!isRaw('x'));
  assert.ok(!isRaw(null));
  assert.ok(!isRaw({ __raw: 5 }));
});

test('small helpers behave', () => {
  assert.equal(textOn('#ffffff'), '#111');
  assert.equal(textOn('#000000'), '#fff');
  assert.equal(ordinal(1), '1st');
  assert.equal(ordinal(12), '12th');
  assert.equal(ordinal(23), '23rd');
  assert.equal(pct(1, 4), '25%');
  assert.equal(pct(1, 0), '—');
});

// Ink on a club colour. The old version weighted the RAW 0..255 channels and
// switched at 150, which is the usual shortcut and is wrong near the boundary
// because sRGB is gamma-encoded. It put white on #e63946 for 4.17:1 where black
// gives 4.53, and white on #2a9d8f for 3.32:1 where black gives 5.68 — below AA
// on a label that names a team.
const relLum = ([r, g, b]) => {
  const ch = [r, g, b].map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
const rgb = (hex) => {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const contrast = (a, b) => {
  const x = relLum(rgb(a)), y = relLum(rgb(b));
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

test('textOn picks the ink that actually contrasts better', () => {
  // The two the shortcut got wrong, pinned by name so a regression is obvious.
  assert.equal(textOn('#e63946'), '#111', 'a mid red wants dark ink');
  assert.equal(textOn('#2a9d8f'), '#111', 'a mid teal wants dark ink');
  assert.equal(textOn('#0b2a4a'), '#fff', 'a navy still wants white');
  assert.equal(textOn('#ffb703'), '#111', 'a bright yellow still wants dark');
  // Shorthand and junk must not throw or return something unusable.
  assert.equal(textOn('#fff'), '#111');
  assert.equal(textOn('not a colour'), '#fff');
  assert.equal(textOn(undefined), '#fff');
  // Whichever it picks must be the better of the two, always.
  for (let n = 0; n < 4096; n += 7) {
    const hex = '#' + n.toString(16).padStart(3, '0');
    const got = textOn(hex);
    const other = got === '#111' ? '#fff' : '#111';
    assert.ok(contrast(got, hex) >= contrast(other, hex) - 1e-9, `${hex}: chose ${got} over ${other}`);
  }
});

test('every club colour in the game carries a legible label', () => {
  // Against the real lists, not a sample: a colour added later cannot quietly
  // ship below AA. #c8531f was the one that could not be rescued by either ink
  // (4.46 at best) and was darkened one per cent in the data instead.
  const colours = [...AI_TEAMS, ...PRO_TEAMS].map((t) => t.color).filter(Boolean);
  assert.ok(colours.length >= 30, `only ${colours.length} club colours found`);
  const bad = colours
    .map((c) => ({ c, ink: textOn(c), ratio: contrast(textOn(c), c) }))
    .filter((x) => x.ratio < 4.5)
    .map((x) => `${x.c} with ${x.ink} is ${x.ratio.toFixed(2)}:1`);
  assert.deepEqual(bad, [], 'club colours whose label falls below WCAG AA');
});

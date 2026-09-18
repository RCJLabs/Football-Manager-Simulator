import { test } from 'node:test';
import assert from 'node:assert/strict';
import { html, raw, esc, isRaw, textOn, ordinal, pct } from '../src/util.js';

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

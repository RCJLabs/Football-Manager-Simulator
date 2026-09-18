import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RNG, hashSeed, edge, clamp } from '../src/engine/rng.js';

test('same seed produces the same sequence', () => {
  const a = new RNG(123), b = new RNG(123);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
});

test('string seeds hash deterministically and differ', () => {
  assert.equal(hashSeed('abc'), hashSeed('abc'));
  assert.notEqual(hashSeed('abc'), hashSeed('abd'));
});

test('int stays within bounds and covers the range', () => {
  const r = new RNG(9);
  const seen = new Set();
  for (let i = 0; i < 2000; i++) { const v = r.int(1, 6); assert.ok(v >= 1 && v <= 6); seen.add(v); }
  assert.equal(seen.size, 6);
});

test('weighted picks respect weights roughly', () => {
  const r = new RNG(42);
  const counts = { a: 0, b: 0 };
  for (let i = 0; i < 5000; i++) counts[r.weighted(['a', 'b'], [3, 1])]++;
  assert.ok(counts.a / counts.b > 2.4 && counts.a / counts.b < 3.6, `ratio ${counts.a / counts.b}`);
});

test('normal has the requested mean', () => {
  const r = new RNG(5);
  let s = 0; const n = 20000;
  for (let i = 0; i < n; i++) s += r.normal(10, 2);
  assert.ok(Math.abs(s / n - 10) < 0.1);
});

test('edge and clamp helpers', () => {
  assert.equal(edge(80, 80), 0.5);
  assert.ok(edge(90, 80) > 0.7);
  assert.equal(clamp(5, 0, 3), 3);
});

test('state round-trips for pause/resume', () => {
  const a = new RNG(77);
  a.next(); a.next();
  const b = new RNG(a.state);
  assert.equal(a.next(), b.next());
});

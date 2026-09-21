import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS } from '../src/data/db.js';
import { POSITIONS } from '../src/data/positions.js';
import { alignAttrs, edgeLine, MIN_SHARED, compareButton, setPendingCompare, clearPendingCompare, pendingCompare } from '../src/ui/compare.js';

const find = (name) => PLAYERS.find((p) => p.name === name);

test('two players at one position line up attribute for attribute', () => {
  const a = find('Walter Payton'), b = find('Jim Brown');
  const rows = alignAttrs(a, b, null);
  assert.deepEqual(rows.map((r) => r.attr), POSITIONS.RB.attrs, 'in the position’s own order');
  assert.ok(rows.every((r) => r.delta != null), 'every row is shared');
  for (const r of rows) assert.equal(r.delta, a.r[r.attr] - b.r[r.attr]);
});

test('across positions the union is taken and a missing attribute is absent, not zero', () => {
  const rb = find('Walter Payton'), qb = find('Joe Montana');
  const rows = alignAttrs(rb, qb, null);
  const byAttr = new Map(rows.map((r) => [r.attr, r]));
  // Awareness is the one thing a back and a quarterback both carry.
  assert.equal(byAttr.get('awr').delta, rb.r.awr - qb.r.awr);
  assert.equal(byAttr.get('spd').b, null, 'a quarterback has no speed rating here');
  assert.equal(byAttr.get('spd').delta, null, 'and so no delta, rather than a delta against zero');
  assert.equal(byAttr.get('thp').a, null);
  // The back's attributes come first, then whatever the quarterback adds.
  assert.deepEqual(rows.slice(0, POSITIONS.RB.attrs.length).map((r) => r.attr), POSITIONS.RB.attrs);
});

test('the verdict counts rows, and refuses to call one on too little overlap', () => {
  const a = find('Walter Payton'), b = find('Jim Brown');
  assert.match(edgeLine(alignAttrs(a, b, null)), /leads \d+–\d+ of 6\.$/);
  // A back against a quarterback shares only awareness: one row is not a verdict.
  assert.equal(edgeLine(alignAttrs(a, find('Joe Montana'), null)), '');
  assert.equal(edgeLine([]), '');
  const level = [{ delta: 1 }, { delta: -1 }, { delta: 2 }, { delta: -2 }];
  assert.match(edgeLine(level), /^Level on 4 shared attributes\.$/);
  assert.ok(MIN_SHARED >= 2, 'a single shared attribute can never be a verdict');
});

test('an unscouted rookie is no easier to read through a comparison than beside one', () => {
  // The fog exists so a precise rating is not knowable before he plays. A
  // comparison that subtracted true ratings would hand back exactly that, so
  // the view is fed here and every number has to come through it.
  const a = find('Walter Payton'), b = find('Jim Brown');
  const coarse = { league: { seed: 7, settings: { scouting: true } }, observer: 0 };
  const exactRows = alignAttrs(a, b, null);
  assert.ok(exactRows.every((r) => r.exact), 'with no league nothing is a guess');
  // Same call with a league present must route through the scouting path,
  // which is the same one the player list uses.
  const fogged = alignAttrs(a, b, coarse);
  assert.equal(fogged.length, exactRows.length);
  for (const r of fogged) assert.ok(r.a != null && r.b != null);
});

test('the compare button states the gesture it is in the middle of', () => {
  clearPendingCompare();
  const a = find('Walter Payton'), b = find('Jim Brown');
  assert.match(compareButton(a), /data-cmp-start/);
  setPendingCompare(a);
  assert.equal(pendingCompare().id, a.id);
  assert.match(compareButton(b), /data-cmp-with/);
  assert.match(compareButton(b), /Walter Payton/);
  assert.match(compareButton(a), /data-cmp-cancel/, 'nobody compares with himself');
  clearPendingCompare();
  assert.equal(pendingCompare(), null);
});

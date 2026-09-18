import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { buildFictionalNames, fictionalNameFor, applyNameMode } from '../src/data/names.js';
import { applyOverrides, clearOverrides, setOverride, overridesFile } from '../src/data/tuning.js';
import { overall } from '../src/engine/ratings.js';
import { poolFingerprint } from '../src/engine/share.js';

test('fictional names are one to one, deterministic, and never a real name', () => {
  const a = buildFictionalNames(PLAYERS), b = buildFictionalNames(PLAYERS);
  assert.equal(a.size, PLAYERS.length);
  assert.equal(new Set(a.values()).size, PLAYERS.length, 'unique');
  for (const p of PLAYERS) assert.equal(a.get(p.id), b.get(p.id), 'stable');
  const real = new Set(PLAYERS.map((p) => p.name));
  for (const name of a.values()) assert.ok(!real.has(name), `${name} is a real name in the pool`);
  assert.equal(fictionalNameFor('tom-brady-2007'), fictionalNameFor('tom-brady-2007'));
  assert.notEqual(fictionalNameFor('tom-brady-2007'), fictionalNameFor('tom-brady-2017'));
  // Appending to the pool leaves earlier names alone.
  const more = buildFictionalNames([...PLAYERS, { id: 'new-guy-2030' }]);
  for (const p of PLAYERS) assert.equal(more.get(p.id), a.get(p.id));
});

test('switching name modes is reversible and leaves ids and ratings alone', () => {
  const brady = byId.get('tom-brady-2007');
  const before = brady.name, ovr = overall(brady);
  applyNameMode(PLAYERS, 'fictional');
  assert.notEqual(brady.name, before);
  assert.equal(brady.realName, before);
  assert.equal(brady.id, 'tom-brady-2007');
  assert.equal(overall(brady), ovr);
  applyNameMode(PLAYERS, 'real');
  assert.equal(brady.name, before);
});

test('rating overrides apply, change the overall, export as a diff, and can be discarded', () => {
  const p = byId.get('otto-graham-1953');
  const base = { ...p.r }, ovr = overall(p);
  const n = applyOverrides(PLAYERS, byId, { 'otto-graham-1953': { tha: 99, thp: 99, awr: 99, mob: 99 }, 'nobody-1900': { thp: 50 }, 'otto-graham-1953-x': null });
  assert.equal(n, 4);
  assert.ok(overall(p) > ovr, 'overall follows the edit');
  assert.deepEqual(p.baseR, base);
  let overrides = {};
  overrides = setOverride(overrides, p, 'mob', 60);
  assert.equal(p.r.mob, 60);
  assert.equal(overrides['otto-graham-1953'].mob, 60);
  overrides = setOverride(overrides, p, 'mob', base.mob);
  assert.ok(!overrides['otto-graham-1953'], 'back to base drops the entry');
  overrides = setOverride(overrides, p, 'tha', 120);
  assert.equal(p.r.tha, 99, 'clamped');
  const file = overridesFile(overrides, byId, poolFingerprint(PLAYERS));
  assert.equal(file.version, 1);
  assert.equal(file.changes.length, 1);
  assert.equal(file.changes[0].name, 'Otto Graham');
  assert.equal(file.changes[0].from.tha, base.tha);
  clearOverrides(PLAYERS);
  assert.deepEqual(p.r, base);
  assert.equal(overall(p), ovr);
  assert.equal(p.baseR, undefined);
});

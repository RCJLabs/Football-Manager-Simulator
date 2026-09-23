import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as rawById } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers, userTeamIndex } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { enterOffseason } from '../src/engine/offseason.js';
import { stepCareer, startCareer, expectedChange, primeAge, careerIndex } from '../src/engine/careers.js';
import { leaguePool, leagueIndex } from '../src/engine/rookies.js';
import { teamContractIds } from '../src/engine/cap.js';
import {
  focusOn, focusOf, namedFocus, staffFocus, toggleFocus, resetFocus, focusPlan, focusValue,
  FOCUS_SLOTS, FOCUS_CLIMB, FOCUS_EASE, FOCUS_COST,
} from '../src/engine/focus.js';

registerPlayers(rawById);

/** A capped league at its first offseason, careers seeded for everybody rostered. */
function league(seed, settings = {}) {
  const lg = createLeague({ name: 'D', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 12, seed, mode: 'pro', draftType: 'snake' });
  Object.assign(lg.settings, settings);
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, rawById);
  lg.phase = 'complete';
  lg.dev = {};
  for (const t of lg.teams) for (const s of ROSTER_SLOTS) {
    const id = t.slots[s.id];
    if (id) lg.dev[id] = { ...startCareer(lg, rawById.get(id)), from: lg.season };
  }
  const byId = careerIndex(lg, leagueIndex(lg, rawById));
  return { lg, byId, u: userTeamIndex(lg) };
}

/** A man whose career is set `t` years from his position's peak. */
function at(lg, id, t) {
  const p = rawById.get(id);
  lg.dev[id] = { ...lg.dev[id], age: primeAge(p.pos) + t - 1 };
  return p;
}

test('a season steps the same with or without focus, apart from what focus scales', () => {
  const { lg } = league(51);
  const id = lg.teams[0].slots[ROSTER_SLOTS[0].id];
  const src = at(lg, id, -3);
  const plain = stepCareer(lg, src, lg.dev[id], lg.season, 0, null);
  const again = stepCareer(lg, src, lg.dev[id], lg.season, 0, null);
  assert.deepEqual(again.career, plain.career, 'a step is not deterministic, so no counterfactual can be exact');
  const none = stepCareer(lg, src, lg.dev[id], lg.season, 0, { climb: 1, decline: 1 });
  assert.deepEqual(none.career, plain.career, 'a neutral plan changed the season');
  const hurried = stepCareer(lg, src, lg.dev[id], lg.season, 0, { climb: 1 + FOCUS_CLIMB, decline: 1 });
  assert.ok(hurried.after >= plain.after, `a focused climber came out ${hurried.after} against ${plain.after}`);
});

test('focus hurries the young, holds the old, and bills everybody else', () => {
  const { lg } = league(52);
  const ids = ROSTER_SLOTS.map((s) => lg.teams[0].slots[s.id]).filter(Boolean);
  // Summed over a whole roster at both ends, so the ceiling clamp and the
  // noise cannot hide the direction.
  let young = 0, old = 0, youngPaid = 0, oldPaid = 0;
  for (const id of ids) {
    const src = at(lg, id, -4);
    const base = stepCareer(lg, src, lg.dev[id], lg.season, 0, null).after;
    young += stepCareer(lg, src, lg.dev[id], lg.season, 0, { climb: 1 + FOCUS_CLIMB, decline: 1 - FOCUS_EASE }).after - base;
    youngPaid += stepCareer(lg, src, lg.dev[id], lg.season, 0, { climb: 1 - 3 * FOCUS_COST, decline: 1 + 3 * FOCUS_COST }).after - base;
  }
  for (const id of ids) {
    const src = at(lg, id, 7);
    const base = stepCareer(lg, src, lg.dev[id], lg.season, 0, null).after;
    old += stepCareer(lg, src, lg.dev[id], lg.season, 0, { climb: 1 + FOCUS_CLIMB, decline: 1 - FOCUS_EASE }).after - base;
    oldPaid += stepCareer(lg, src, lg.dev[id], lg.season, 0, { climb: 1 - 3 * FOCUS_COST, decline: 1 + 3 * FOCUS_COST }).after - base;
  }
  assert.ok(young > ids.length * 0.5, `focus added only ${young} to ${ids.length} young men`);
  assert.ok(old > ids.length * 0.3, `focus held back only ${old} of ${ids.length} old men's decline`);
  assert.ok(youngPaid <= 0 && oldPaid <= 0, `a teammate's bill came out positive: ${youngPaid}, ${oldPaid}`);
  assert.ok(youngPaid + oldPaid < 0, 'three focused men cost their teammates nothing');
});

test('three at most, only your own men, and the staff picks until you choose', () => {
  const { lg, byId, u } = league(53);
  const staff = staffFocus(lg, u, byId);
  assert.equal(staff.length, FOCUS_SLOTS);
  assert.equal(namedFocus(lg, u), null);
  assert.deepEqual(focusOf(lg, u, byId), staff, 'leaving it alone does not get the staff\'s picks');
  const mine = teamContractIds(lg, u);
  const other = teamContractIds(lg, (u + 1) % lg.teams.length)[0];
  // Taking one off keeps the other two: the first change starts from the staff's list.
  assert.equal(toggleFocus(lg, u, staff[0], byId).ok, true);
  assert.deepEqual(namedFocus(lg, u), staff.slice(1));
  // With a place free, so the refusal can only be about whose man he is.
  const stranger = toggleFocus(lg, u, other, byId);
  assert.equal(stranger.ok, false, 'focused a man on another club');
  assert.match(stranger.reason, /not on your club/);
  const extra = mine.find((id) => !staff.includes(id));
  assert.equal(toggleFocus(lg, u, extra, byId).ok, true);
  const full = toggleFocus(lg, u, mine.find((id) => !namedFocus(lg, u).includes(id)), byId);
  assert.equal(full.ok, false, 'a fourth man was focused');
  assert.match(full.reason, /at most/);
  resetFocus(lg, u);
  assert.deepEqual(focusOf(lg, u, byId), staff);
});

test('the plan: focused men boosted, their teammates billed per man, other clubs untouched', () => {
  const { lg, byId, u } = league(54);
  lg.focus = { [u]: [teamContractIds(lg, u)[0], teamContractIds(lg, u)[1]] };
  const plan = focusPlan(lg, byId);
  const [a, b] = lg.focus[u];
  assert.deepEqual([plan.get(a).climb, plan.get(a).decline], [1 + FOCUS_CLIMB, 1 - FOCUS_EASE]);
  const mate = teamContractIds(lg, u).find((id) => id !== a && id !== b);
  assert.deepEqual([plan.get(mate).climb, plan.get(mate).decline], [1 - 2 * FOCUS_COST, 1 + 2 * FOCUS_COST], 'the bill is not per man focused');
  // An explicit empty list is a club choosing nobody: no boost and no bill.
  lg.focus[u] = [];
  assert.equal(focusPlan(lg, byId).has(mate), false, 'a club that chose nobody was still billed');
});

test('switched off, or without careers, nobody is focused and nothing changes', () => {
  const off = league(55, { focus: false });
  assert.equal(focusOn(off.lg), false);
  assert.equal(focusPlan(off.lg, off.byId).size, 0);
  assert.deepEqual(focusOf(off.lg, off.u, off.byId), []);
  assert.equal(toggleFocus(off.lg, off.u, teamContractIds(off.lg, off.u)[0], off.byId).ok, false);
  const frozen = league(55, { careers: false });
  assert.equal(focusOn(frozen.lg), false, 'a league where nobody develops offered focus');
  // A save from before focus existed has no setting at all: absent is off.
  const old = league(55);
  delete old.lg.settings.focus;
  assert.equal(focusOn(old.lg), false);
});

test('the offseason applies focus once, reports what it did, and starts the next season fresh', () => {
  const { lg, byId, u } = league(56);
  const picks = teamContractIds(lg, u).slice(0, 3);
  lg.focus = { [u]: picks };
  const was = Object.fromEntries(picks.map((id) => [id, { ...lg.dev[id], d: { ...lg.dev[id].d } }]));
  const plan = focusPlan(lg, byId);
  enterOffseason(lg, leaguePool(lg, PLAYERS), byId);
  assert.equal(lg.focus, undefined, 'last season\'s picks carried into the next');
  const mine = lg.offseason.focused.filter((f) => f.team === u);
  assert.equal(mine.length, picks.length);
  // The reported gain is exactly the season with focus against the same season
  // without it — recomputed here from the career as it stood before.
  for (const id of picks) {
    const src = rawById.get(id);
    const f = mine.find((x) => x.name === src.name);
    const withIt = stepCareer(lg, src, was[id], lg.season, 0, plan.get(id)).after;
    const without = stepCareer(lg, src, was[id], lg.season, 0, null).after;
    assert.deepEqual(f && [f.to, f.gain], [withIt, withIt - without], `${src.name}'s report is not his season`);
  }
  // AI clubs focused too, by the staff's rule.
  assert.ok(lg.offseason.focused.some((f) => f.team !== u), 'no AI club focused on anybody');
});

test('before any career has started, the staff still picks, by the age each career will start at', () => {
  const lg = createLeague({ name: 'N', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 12, seed: 58, mode: 'pro', draftType: 'snake' });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(58));
  startSeason(lg, rawById);
  assert.ok(!lg.dev || !Object.keys(lg.dev).length, 'careers had already started');
  const u = userTeamIndex(lg);
  const picks = staffFocus(lg, u, rawById);
  assert.equal(picks.length, FOCUS_SLOTS, 'in a first season the staff picked nobody');
  // The age read is the one the first offseason then writes.
  lg.phase = 'complete';
  enterOffseason(lg, leaguePool(lg, PLAYERS), rawById);
  for (const id of picks) {
    const p = rawById.get(id);
    assert.equal(lg.dev[id]?.age, startCareer(lg, p).age + 1, `${p.name} started his career at a different age`);
  }
});

test('the staff reads only what a club can see: age, position, role and a rookie\'s range', () => {
  assert.ok(expectedChange('QB', -4).climb > 0 && expectedChange('QB', -4).decline === 0);
  assert.ok(expectedChange('RB', 8).climb === 0 && expectedChange('RB', 8).decline < 0);
  const { lg, u } = league(57);
  const young = { id: 'y', pos: 'QB', age: primeAge('QB') - 5, r: {} };
  const bench = { ...young, id: 'b' };
  assert.ok(focusValue(lg, young, u, true) > focusValue(lg, bench, u, false), 'a starter is worth no more than a backup');
  const kicker = { id: 'k', pos: 'K', age: primeAge('K') - 5, r: {} };
  assert.ok(focusValue(lg, young, u, true) > focusValue(lg, kicker, u, true), 'leverage does not enter the staff\'s pick');
});

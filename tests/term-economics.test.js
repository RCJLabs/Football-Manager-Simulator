import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { enterOffseason, TAG_PREMIUM } from '../src/engine/offseason.js';
import { TERM_PRICE, FA_TERM, TERMS, priceOf } from '../src/engine/terms.js';
import { deadHit } from '../src/engine/cap.js';
import { startCareer, careerIndex } from '../src/engine/careers.js';
import { leaguePool, leagueIndex } from '../src/engine/rookies.js';

registerPlayers(byId);

test('a length is priced to the dollar, with no float error on the ceiling', () => {
  // 25 × 1.12 is 28 and evaluates to 28.000000000000004; a bare Math.ceil
  // charged 29. Checked against integer arithmetic at every market value the
  // game produces, for every length, both markets, and the tag.
  const exact = (m, num, den) => Math.floor((m * num + den - 1) / den);
  const hundredths = (f) => Math.round(f * 100);
  for (let m = 1; m <= 50; m++) {
    for (const t of TERMS) {
      const num = hundredths(TERM_PRICE[t]);
      assert.equal(priceOf(m, TERM_PRICE[t]), exact(m, num, 100), `re-signing ${t}y at $${m}`);
      assert.equal(priceOf(m, FA_TERM[t]), exact(m, num, 104), `the market ${t}y at $${m}`);
    }
    assert.equal(priceOf(m, TAG_PREMIUM), exact(m, hundredths(TAG_PREMIUM), 100), `the tag at $${m}`);
  }
  assert.equal(priceOf(25, TERM_PRICE[2]), 28, 'the case that started it');
});

/**
 * A capped league at its first offseason, with chosen men set to retire in
 * it. The season itself is not what is under test, and a retirement is years
 * away for anybody the draft produced, so their careers are seeded to end now.
 */
function retireAtFirstOffseason(seed, choose) {
  const lg = createLeague({ name: 'R', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 12, seed, mode: 'pro', draftType: 'snake' });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, byId);
  lg.phase = 'complete';
  const rostered = lg.teams.flatMap((t, team) => ROSTER_SLOTS.map((s) => t.slots[s.id]).filter(Boolean).map((id) => ({ id, team })));
  const picks = choose(rostered.map((r) => ({ ...r, c: { ...lg.contracts[r.id] } })));
  lg.dev ??= {};
  for (const { id } of picks) {
    const career = startCareer(lg, byId.get(id));
    lg.dev[id] = { ...career, from: lg.season, retireAt: career.age + 1 };
  }
  const deadBefore = lg.teams.map((_, i) => deadHit(lg, i));
  enterOffseason(lg, leaguePool(lg, PLAYERS), careerIndex(lg, leagueIndex(lg, byId)));
  return { lg, picks, deadBefore };
}

test('a man who retires under contract leaves half of what is left owed, as a cut does', () => {
  const { lg, picks, deadBefore } = retireAtFirstOffseason(31, (men) => {
    // From the last club, not the first: a charge booked to club 0 by mistake
    // would look right for any man who happened to play there.
    const long = men.filter((m) => m.c.years >= 3 && m.c.salary >= 4).at(-1);
    assert.ok(long, 'no man with years and money left to retire from');
    return [long];
  });
  const [{ id, team, c }] = picks;
  assert.equal(lg.contracts[id], undefined, 'his contract is still live');
  const left = c.years - 1;   // this offseason's year has already come off
  const due = Math.floor(c.salary / 2);
  const entry = (lg.dead[team] || []).find((d) => d.id === id);
  assert.deepEqual(entry && [entry.amount, entry.years], [due, left], 'the wrong bill was booked');
  assert.equal(deadHit(lg, team), deadBefore[team] + due);
  const line = lg.offseason.retired.find((r) => r.name === byId.get(id).name);
  assert.deepEqual(line && [line.team, line.owed, line.owedYears], [team, due, left], 'the offseason summary does not say what is owed');
});

test('a man whose deal has just run out, or who is on the minimum, retires owing nothing', () => {
  const { lg, picks, deadBefore } = retireAtFirstOffseason(32, (men) => {
    const done = men.find((m) => m.c.years === 1 && m.c.salary >= 4);
    const cheap = men.find((m) => m.c.years >= 3 && m.c.salary === 1);
    assert.ok(done && cheap, 'the league has no expiring man or no minimum deal to test with');
    return [done, cheap];
  });
  for (const { id, team } of picks) {
    assert.ok(!(lg.dead?.[team] || []).some((d) => d.id === id), `${byId.get(id).name} left a bill`);
    assert.equal(lg.contracts[id], undefined);
    const line = lg.offseason.retired.find((r) => r.name === byId.get(id).name);
    assert.ok(line && line.owed == null, 'the summary reports a debt that was never booked');
  }
  for (const { team } of picks) assert.equal(deadHit(lg, team), deadBefore[team]);
});

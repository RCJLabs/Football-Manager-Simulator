// Is a contract's length a decision, or does one length always win?
//
// A long deal is cheaper a year. What it is supposed to cost is being stuck
// with a man after he stops being worth it. This measures whether that cost
// ever arrives, using what really happened rather than a model of it: every
// free-agent signing in a run of real leagues, followed for five seasons —
// his actual rating each year, knocks included, and whether he retired.
//
// For each man it prices all four lengths at the same distance over his asking
// price (so each would have won him equally) and adds up, over five seasons,
// what he was worth that year minus what he was paid. A deal that has ended
// is worth zero: the slot is refilled at market, which is generous to short
// deals, since in practice winning a man back costs a premium. A club may cut
// him in any year, paying half of what is left, if that beats keeping him.
//
// Two rules for retirement: the game's, where the years a man retires out of
// are booked as they would be for a cut; and the rule it replaced, where he
// took his contract with him — kept as a comparison, because that one rule is
// what made five years the right answer at every age.
//
// Usage: node scripts/term-value.mjs [signing seasons] [leagues] [first seed]
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { simulateAhead } from '../src/engine/autosim.js';
import { marketSalary, DEAD_SHARE } from '../src/engine/cap.js';
import { primeAge, applyCareers, careerIndex } from '../src/engine/careers.js';
import { leaguePool, leagueIndex } from '../src/engine/rookies.js';
import { FA_TERM, TERM_PRICE, TERMS } from '../src/engine/terms.js';

registerPlayers(PLAYERS_BY_ID);
const SIGNING = Number(process.argv[2] || 5);
const LEAGUES = Number(process.argv[3] || 3);
const SEED0 = Number(process.argv[4] || 4000);
const HORIZON = Math.max(...TERMS);
const index = (lg) => careerIndex(lg, leagueIndex(lg, PLAYERS_BY_ID));
const pool = (lg) => applyCareers(lg, leaguePool(lg, PLAYERS));
const mean = (x) => (x.length ? x.reduce((s, v) => s + v, 0) / x.length : NaN);

const signings = [];
for (let L = 0; L < LEAGUES; L++) {
  const seed = SEED0 + L * 37;
  const lg = createLeague({ name: 'T', mode: 'pro', numTeams: 32, franchise: 12, seed, draftType: 'snake', user: {}, injuries: 'normal' });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, PLAYERS_BY_ID);
  // One entry per signing, not per man: a man can be signed in two offseasons.
  const followed = new Map();   // key -> { id, line: [{ worth, retired }] }, a season each from signing
  const mine = [];
  for (let yr = 1; yr <= SIGNING + HORIZON; yr++) {
    simulateAhead(lg, index(lg), pool(lg), new RNG(seed * 13 + yr), 'nextSeason');
    if (lg.phase !== 'season') break;
    const idx = index(lg);
    const retired = new Set(lg.retired || []);
    if (yr <= SIGNING) {
      for (const r of lg.freeAgency?.results || []) {
        const p = idx.get(r.id);
        if (!p || p.age == null) continue;
        const key = `${r.id}@${yr}`;
        mine.push({ key, id: r.id, pos: p.pos, past: p.age - primeAge(p.pos), market: r.market ?? r.ask, over: r.salary / r.ask });
        followed.set(key, { id: r.id, line: [] });
      }
    }
    for (const { id, line } of followed.values()) {
      if (line.length >= HORIZON) continue;
      const gone = retired.has(id) || line.some((e) => e.retired);
      line.push({ worth: gone ? 0 : marketSalary(idx.get(id)), retired: gone });
    }
  }
  for (const s of mine) {
    const line = followed.get(s.key)?.line;
    if (line && line.length >= HORIZON) signings.push({ ...s, line });
  }
}

/**
 * Five seasons of worth minus pay under one length and one retirement rule.
 * `over` is how far past the asking price he was bought: what the winner
 * actually paid, or 1 for a man nobody else wanted.
 */
function surplus(s, t, curve, deadOnRetire, over) {
  const salary = Math.round(Math.ceil(s.market * curve[t]) * over);
  const deadYear = Math.floor(salary * DEAD_SHARE);
  // Keeping him to the end, or cutting after `cut` seasons — whichever is best.
  let best = -Infinity;
  for (let cut = 1; cut <= t; cut++) {
    let v = 0;
    let y = 0;
    for (; y < cut; y++) {
      const e = s.line[y];
      if (e.retired) { if (deadOnRetire) v -= deadYear * (t - y); break; }
      v += e.worth - salary;
    }
    if (y === cut && cut < t) v -= deadYear * (t - cut);
    best = Math.max(best, v);
  }
  return best;
}

// Keep the trajectories, so another price curve or retirement rule can be
// scored against the same men without running the leagues again.
if (process.env.TERM_VALUE_DUMP) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.env.TERM_VALUE_DUMP, JSON.stringify(signings));
}

const BANDS = [[-99, -3, 'climbing (3+ before peak)'], [-2, 0, 'at peak (2 before to peak)'], [1, 2, 'just past (1-2 after)'], [3, 4, 'past (3-4 after)'], [5, 99, 'well past (5+ after)']];
console.log(`${signings.length} free-agent signings followed for ${HORIZON} seasons (${LEAGUES} leagues, 32 clubs), bought ${mean(signings.map((s) => s.over)).toFixed(2)}x over the asking price on average`);
const SCENARIOS = [
  ['free agency at the asking price', FA_TERM, true, () => 1],
  ['re-signing (premium curve)', TERM_PRICE, true, () => 1],
  ['free agency at the price the winner paid', FA_TERM, true, (s) => s.over],
  ['free agency at the asking price, if retirement still took the contract with him', FA_TERM, false, () => 1],
];
for (const [label, curve, deadOnRetire, overOf] of SCENARIOS) {
  {
    console.log(`\n${label} — mean surplus over five seasons, and how often each length is best`);
    console.log(`  ${'band'.padEnd(28)} ${'n'.padStart(4)}  ${TERMS.map((t) => `${t}y`.padStart(7)).join('')}   best: ${TERMS.map((t) => `${t}y`).join(' / ')}`);
    for (const [lo, hi, name] of BANDS) {
      const inBand = signings.filter((s) => s.past >= lo && s.past <= hi);
      if (!inBand.length) continue;
      const vals = inBand.map((s) => TERMS.map((t) => surplus(s, t, curve, deadOnRetire, overOf(s))));
      const means = TERMS.map((_, i) => mean(vals.map((v) => v[i])));
      const wins = TERMS.map(() => 0);
      for (const v of vals) wins[v.indexOf(Math.max(...v))]++;
      console.log(`  ${name.padEnd(28)} ${String(inBand.length).padStart(4)}  ${means.map((m) => m.toFixed(1).padStart(7)).join('')}   ${wins.map((w) => `${Math.round(100 * w / inBand.length)}%`).join(' / ')}`);
    }
  }
}

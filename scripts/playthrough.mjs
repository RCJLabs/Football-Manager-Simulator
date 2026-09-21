// Play a dynasty and look at it.
//
//   node scripts/playthrough.mjs [seasons] [seed]
//
// Everything else in scripts/ measures one thing on synthetic rosters. This
// runs a real pro league for a decade and checks the invariants a measurement
// never looks at — every roster legal and full, nobody on two of them, no
// negative cap, no NaN anywhere, awards that name somebody, records that are
// possible — and then prints the story so a person can see whether it reads
// like football or like a spreadsheet that has come loose.
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers, standings, userTeamIndex } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { simulateAhead } from '../src/engine/autosim.js';
import { leaguePool, leagueIndex } from '../src/engine/rookies.js';
import { applyCareers, careerIndex } from '../src/engine/careers.js';
import { rostersValid, ownerMap, lineupStrength } from '../src/engine/transactions.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { overall } from '../src/engine/ratings.js';

registerPlayers(PLAYERS_BY_ID);
const SEASONS = Number(process.argv[2] || 10);
const SEED = Number(process.argv[3] || 2026);
const index = (lg) => careerIndex(lg, leagueIndex(lg, PLAYERS_BY_ID));
const pool = (lg) => applyCareers(lg, leaguePool(lg, PLAYERS));
const problems = [];
const mvpPos = {};
const rookieHigh = {};
const note = (season, msg) => problems.push(`season ${season}: ${msg}`);

function deepFinite(obj, path, season, seen = new Set()) {
  if (obj == null || typeof obj !== 'object' || seen.has(obj)) return;
  seen.add(obj);
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) note(season, `${path}.${k} is ${v}`);
    } else if (typeof v === 'object') deepFinite(v, `${path}.${k}`, season, seen);
  }
}

const lg = createLeague({ name: 'Dynasty', mode: 'pro', numTeams: 32, franchise: 12, seed: SEED, draftType: 'snake', user: {}, injuries: 'normal' });
autoDraftAll(lg, lg.draft, PLAYERS, new RNG(SEED));
startSeason(lg, PLAYERS_BY_ID);
const story = [];

for (let yr = 1; yr <= SEASONS; yr++) {
  if (lg.jobs?.status === 'retired') { story.push(`season ${yr}: nobody would hire you; the career is over`); break; }
  const season = lg.season;
  simulateAhead(lg, index(lg), pool(lg), new RNG(SEED * 7 + yr), 'nextSeason');
  const byId = index(lg);

  // --- invariants a measurement never looks at -----------------------------
  const v = rostersValid(lg, byId);
  if (!v.ok) note(season, `rosters invalid — ${v.reason}`);
  const owners = ownerMap(lg);
  const held = lg.teams.flatMap((t) => ROSTER_SLOTS.map((s) => t.slots[s.id]).filter(Boolean));
  if (new Set(held).size !== held.length) note(season, 'somebody is on two rosters');
  for (const [i, t] of lg.teams.entries()) {
    const filled = ROSTER_SLOTS.filter((s) => t.slots[s.id]).length;
    if (filled !== ROSTER_SLOTS.length) note(season, `${t.abbr} fields ${filled} of ${ROSTER_SLOTS.length}`);
    for (const s of ROSTER_SLOTS) {
      const p = byId.get(t.slots[s.id]);
      if (p && p.pos !== s.pos) note(season, `${t.abbr} has a ${p.pos} in ${s.id}`);
      if (p && lg.retired?.includes(p.id)) note(season, `${t.abbr} is starting ${p.name}, who has retired`);
    }
  }
  // Records are read out of history, not off the clubs: `nextSeason` finishes
  // the year AND rolls into the following one, so by the time this runs the
  // table has already been wiped for the new season. Checking it in place said
  // every club had played nothing, which was this script being wrong.
  const hist = (lg.history || []).find((h) => h.season === season);
  if (!hist) note(season, 'the season left no history entry');
  const rec = hist?.record;
  if (rec && rec.w + rec.l + rec.t !== 17) note(season, `the champion played ${rec.w + rec.l + rec.t} games`);
  if (hist?.finish && new Set(hist.finish).size !== lg.teams.length) note(season, 'the final table does not list every club once');
  if (lg.cap) for (const [i, room] of Object.entries(lg.capRoom || {})) if (room < 0) note(season, `club ${i} is ${room} over the cap`);
  deepFinite(lg.teams, 'teams', season);

  const champ = hist && hist.champion != null ? lg.teams[hist.champion] : null;
  const awards = hist?.awards || lg.awards;
  if (!champ) note(season, 'the season produced no champion');
  if (awards && !awards.mvp) note(season, 'no MVP was named');
  const best = { team: lg.teams[hist?.finish?.[0] ?? 0] };
  const worst = { team: lg.teams[hist?.finish?.[lg.teams.length - 1] ?? 0] };
  const mvpId = awards?.mvp?.id;
  const mvp = mvpId ? byId.get(mvpId) : null;
  if (mvp) mvpPos[mvp.pos] = (mvpPos[mvp.pos] || 0) + 1;
  // The premise of the game is all-time greats. A generated rookie who outrates
  // them is the premise leaking, so watch the top of each position.
  for (const p of pool(lg)) {
    if (!p.generated) continue;
    const o = overall(p);
    if (!rookieHigh[p.pos] || o > rookieHigh[p.pos].ovr) rookieHigh[p.pos] = { ovr: o, name: p.name, season };
  }
  story.push(`season ${season}: ${champ ? champ.abbr : '—'} champion (${rec ? `${rec.w}-${rec.l}` : '?'})`
    + ` · top ${best.team.abbr} · bottom ${worst.team.abbr}`
    + ` · MVP ${mvp ? `${mvp.name} (${mvp.pos}, ${overall(mvp)})` : '—'}`
    + ` · ${(lg.retired || []).length} retired so far`
    + ` · ${Object.values(lg.dev || {}).filter((c) => c.knocks).length} carrying a knock`);
}

console.log(`${SEASONS} seasons, 32 clubs, seed ${SEED}\n`);
for (const line of story) console.log('  ' + line);
console.log('\nMVP by position (real voting is overwhelmingly quarterbacks)');
const mvpTotal = Object.values(mvpPos).reduce((a, b) => a + b, 0) || 1;
for (const [pos, n] of Object.entries(mvpPos).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${pos.padEnd(3)} ${String(n).padStart(3)}  ${(100 * n / mvpTotal).toFixed(0)}%`);
}
console.log('\nbest generated rookie against the best man who ever played there');
const bestReal = {};
for (const p of PLAYERS) { const o = overall(p); if (!bestReal[p.pos] || o > bestReal[p.pos].ovr) bestReal[p.pos] = { ovr: o, name: p.name }; }
for (const [pos, r] of Object.entries(rookieHigh).sort((a, b) => b[1].ovr - a[1].ovr)) {
  const real = bestReal[pos];
  // Equalling the best is allowed — `positionPeak` is a ceiling, not a reservation.
  // Exceeding it is the defect this line exists to catch, so the two read differently.
  const flag = r.ovr > real.ovr ? '  <-- BEATS the all-time best' : r.ovr === real.ovr ? '  (equals it)' : '';
  console.log(`  ${pos.padEnd(3)} ${String(r.ovr).padStart(3)} ${r.name.padEnd(20)} against ${real.ovr} ${real.name}${flag}`);
}
console.log(`\n${problems.length ? `${problems.length} PROBLEM(S):` : 'no invariant broke'}`);
for (const p of problems.slice(0, 30)) console.log('  ! ' + p);

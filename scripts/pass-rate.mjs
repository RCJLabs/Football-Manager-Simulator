// What the pass/run balance is worth, to the AI and to you.
//
//   node scripts/pass-rate.mjs ai   [leagues] [games per club] [kickoff|halfway] [first seed]
//   node scripts/pass-rate.mjs read [leagues] [games per club] [pro|8|10|12]      [first seed]
//
// Started from something found by accident while testing weather: in one set
// of founding lineups, a club that ran fifteen points more than its own pass
// rate gained about a point and a half of margin, indoors and out. That was one
// league with fixed pairings, and the "indoors and out" was the same games
// replayed under five skies, which is one sample seen five times.
//
//   ai    Every club in each league plays its own league's clubs with its pass
//         rate moved, each game against the same game from the same seed
//         unmoved, home and away in turn, with game plans and home advantage as
//         a real week has them. Also: moving it to what the pass/run read would
//         say, and to a flat 0.55. By personality and by how the roster is
//         built. Defences here call from their own sliders and the down and
//         distance, never from what the offence has been doing, so a gain from
//         running more is a gain against defences that do not notice.
//
//   read  The question the read in strategy.js answers: what should YOU set?
//         Every club in turn is played as the human's is — no game plan, the
//         default sliders — at each setting the dial allows and at the read's,
//         each paired against 0.55 on the same seed, against the league's AI
//         clubs. By run edge, the read's own measure of the roster. Then every
//         ramp of the read's shape scored on the margin it would have won.
//
// Switches for `read`, each a check DESIGN.md quotes: OPP_PLANS=off takes the
// opponents' game plans away; OPPONENT=clone replays how the first read was
// validated, each club against its own clone; READ_POLICIES="-5.25:0.15,..."
// scores ramps fitted on other seeds, which is how they were checked out of
// sample.
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { RNG, hashSeed } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers, teamForGame } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { simulateAhead } from '../src/engine/autosim.js';
import { leaguePool, leagueIndex } from '../src/engine/rookies.js';
import { applyCareers, careerIndex } from '../src/engine/careers.js';
import { createGame, simulateGame } from '../src/engine/game.js';
import { strategyRead } from '../src/engine/strategy.js';
import { DEFAULT_STRATEGY } from '../src/engine/playcall.js';
import { GM_PERSONALITIES } from '../src/data/teams.js';

registerPlayers(PLAYERS_BY_ID);
const [MODE = 'ai', ...rest] = process.argv.slice(2);
const LEAGUES = Number(rest[0] || 4);
const GAMES = Number(rest[1] || 100);
const KIND = rest[2] || (MODE === 'read' ? 'pro' : 'kickoff');
const SEED0 = Number(rest[3] || 3301);
const index = (lg) => careerIndex(lg, leagueIndex(lg, PLAYERS_BY_ID));
const pool = (lg) => applyCareers(lg, leaguePool(lg, PLAYERS));
const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;
const se = (xs) => { const m = mean(xs); return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1) / xs.length); };
const pm = (xs) => (xs.length > 1 ? `${mean(xs) >= 0 ? '+' : ''}${mean(xs).toFixed(2)} ± ${se(xs).toFixed(2)}` : '—');

function league(L) {
  const seed = SEED0 + 97 * L;
  const pro = MODE === 'ai' || KIND === 'pro';
  const lg = createLeague({ name: 'P', mode: pro ? 'pro' : 'fantasy', numTeams: pro ? 32 : Number(KIND), franchise: 5, seed, draftType: 'snake', user: { name: 'Me', abbr: 'ME', color: '#fff' }, injuries: 'normal' });
  lg.settings.jobs = false;
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, PLAYERS_BY_ID);
  if (MODE === 'ai' && KIND === 'halfway') simulateAhead(lg, index(lg), pool(lg), new RNG(seed * 5), 'halfway');
  const byId = index(lg);
  return { lg, seed, byId, teams: lg.teams.map((_, i) => teamForGame(lg, i, byId)) };
}

/** One game, club `c` given as `mine`; its margin, passes and runs. */
function play(mine, opp, cHome, seed, neutral = false) {
  const g = createGame(cHome ? mine : opp, cHome ? opp : mine, { seed, injuryLevel: 0, homeAdvantage: !neutral });
  simulateGame(g);
  const side = cHome ? 0 : 1;
  const st = g.stats[side].team;
  return { margin: g.score[side] - g.score[1 - side], pass: st.passAtt + st.sacksAllowed, run: st.rushAtt };
}

/** The k-th opponent of club c: every other club in turn, never itself. */
const opponent = (c, k, L, n) => (c + 1 + ((k * 7 + L * 3) % (n - 1))) % n;

if (MODE === 'ai') {
  const SHIFTS = [-0.2, -0.15, -0.1, -0.05, 0.05, 0.1];
  const rows = [];
  for (let L = 0; L < LEAGUES; L++) {
    const { lg, seed, byId, teams } = league(L);
    for (let c = 0; c < teams.length; c++) {
      const t = lg.teams[c];
      const read = strategyRead(lg, c, byId);
      const who = t.isUser ? 'the user club (on the read)' : (GM_PERSONALITIES.find((p) => p.id === t.gm)?.name ?? t.gm);
      const at = (d) => (Math.abs(d) < 0.005 ? teams[c] : { ...teams[c], strategy: { ...teams[c].strategy, passRate: teams[c].strategy.passRate + d } });
      for (let k = 0; k < GAMES; k++) {
        const o = opponent(c, k, L, teams.length), cHome = k % 2 === 0, gs = hashSeed(`pr:${seed}:${c}:${k}`);
        const base = play(teams[c], teams[o], cHome, gs);
        const gain = {};
        const arm = (key, d) => { gain[key] = Math.abs(d) < 0.005 ? 0 : play(at(d), teams[o], cHome, gs).margin - base.margin; };
        for (const d of SHIFTS) arm(d, d);
        arm('read', read.rate - t.strategy.passRate);
        arm('flat', 0.55 - t.strategy.passRate);
        rows.push({ who, rate: t.strategy.passRate, readRate: read.rate, edge: read.edge, share: base.pass / (base.pass + base.run), gain });
      }
    }
  }
  const groups = new Map();
  for (const r of rows) (groups.get(r.who) ?? groups.set(r.who, []).get(r.who)).push(r);
  console.log(`${LEAGUES} pro leagues from seed ${SEED0} at ${KIND}, every club ${GAMES} games against its own league, paired by seed; margin gained by moving the pass rate`);
  console.log(`  ${'club'.padEnd(28)} ${'n'.padStart(5)}  rate  read  share ` + SHIFTS.map((d) => `${d > 0 ? '+' : ''}${d.toFixed(2)}`.padStart(14)).join('') + '    to the read   read vs 0.55');
  const line = (label, rs) => {
    const cells = SHIFTS.map((d) => pm(rs.map((r) => r.gain[d])).padStart(14)).join('');
    console.log(`  ${label.padEnd(28)} ${String(rs.length).padStart(5)}  ${mean(rs.map((r) => r.rate)).toFixed(2)}  ${mean(rs.map((r) => r.readRate)).toFixed(2)}  ${(100 * mean(rs.map((r) => r.share))).toFixed(0).padStart(4)}% ${cells}   ${pm(rs.map((r) => r.gain.read)).padStart(12)}   ${pm(rs.map((r) => r.gain.read - r.gain.flat)).padStart(12)}`);
  };
  line('every club', rows);
  for (const [who, rs] of [...groups.entries()].sort((a, b) => mean(a[1].map((r) => r.rate)) - mean(b[1].map((r) => r.rate)))) line(who, rs);
  const byEdge = [...rows].sort((a, b) => a.edge - b.edge);
  const third = Math.ceil(byEdge.length / 3);
  line('most pass-built third', byEdge.slice(0, third));
  line('middle third', byEdge.slice(third, 2 * third));
  line('most run-built third', byEdge.slice(2 * third));
} else if (MODE === 'read') {
  const RATES = [0.35, 0.45, 0.65, 0.7];
  const rows = [];
  for (let L = 0; L < LEAGUES; L++) {
    const { lg, seed, byId, teams } = league(L);
    for (let c = 0; c < teams.length; c++) {
      const read = strategyRead(lg, c, byId);
      // Played as the human's club is: no matchup plan, the default sliders.
      const asYou = (rate) => ({ ...teams[c], isUser: true, strategy: { ...DEFAULT_STRATEGY, passRate: rate } });
      // OPP_PLANS=off takes the opponents' plans away too, which is how the
      // reason for all this is tested rather than asserted: if the run pays
      // because every opponent plans a shell over your passer, it should stop
      // paying when nobody plans.
      const opp = (o) => (process.env.OPP_PLANS === 'off' ? { ...teams[o], isUser: true } : teams[o]);
      // OPPONENT=clone replays how the first read was validated: each club
      // against its own clone on the default sliders, nobody planning, no home
      // advantage. If throwing wins there and not against the league, it is the
      // opponent that changed the answer.
      const clone = process.env.OPPONENT === 'clone' ? {
        ...teams[c], id: 'clone', isUser: true, strategy: { ...DEFAULT_STRATEGY },
        lineup: Object.fromEntries(Object.entries(teams[c].lineup).map(([pos, ps]) => [pos, ps.map((p) => ({ ...p, id: `c-${p.id}`, r: { ...p.r } }))])),
      } : null;
      for (let k = 0; k < GAMES; k++) {
        const o = opponent(c, k, L, teams.length), cHome = k % 2 === 0, gs = hashSeed(`rd:${seed}:${c}:${k}`);
        const vs = clone || opp(o), neutral = !!clone;
        const base = play(asYou(0.55), vs, cHome, gs, neutral).margin;
        const gain = { 0.55: 0 };
        for (const r of RATES) gain[r] = play(asYou(r), vs, cHome, gs, neutral).margin - base;
        gain.read = Math.abs(read.rate - 0.55) < 0.005 ? 0 : play(asYou(read.rate), vs, cHome, gs, neutral).margin - base;
        rows.push({ edge: read.edge, readRate: read.rate, gain });
      }
    }
  }
  const cols = [0.35, 0.45, 0.55, 0.65, 0.7];
  const where = KIND === 'pro' ? 'pro leagues of 32' : `fantasy leagues of ${KIND}`;
  console.log(`${LEAGUES} ${where} from seed ${SEED0}; every club played as yours (no game plan, default sliders), ${GAMES} games against its league at each setting, paired against 0.55${process.env.OPP_PLANS === 'off' ? '; the opponents have no plans either' : ''}${process.env.OPPONENT === 'clone' ? '; against its own clone at the default sliders, nobody planning, no home advantage' : ''}`);
  console.log(`  ${'run edge'.padEnd(18)} ${'n'.padStart(5)}  read ` + cols.map((r) => `at ${r.toFixed(2)}`.padStart(14)).join('') + '     at the read   best');
  const line = (label, rs) => {
    const means = cols.map((r) => mean(rs.map((x) => x.gain[r])));
    const best = cols[means.indexOf(Math.max(...means))];
    console.log(`  ${label.padEnd(18)} ${String(rs.length).padStart(5)}  ${mean(rs.map((x) => x.readRate)).toFixed(2)} ` + cols.map((r) => pm(rs.map((x) => x.gain[r])).padStart(14)).join('') + `   ${pm(rs.map((x) => x.gain.read)).padStart(12)}   ${best.toFixed(2)}`);
  };
  line('every club', rows);
  const byEdge = [...rows].sort((a, b) => a.edge - b.edge);
  const fifth = Math.ceil(byEdge.length / 5);
  for (let i = 0; i < 5; i++) {
    const rs = byEdge.slice(i * fifth, (i + 1) * fifth);
    if (rs.length) line(`${rs[0].edge.toFixed(1)} to ${rs[rs.length - 1].edge.toFixed(1)}`, rs);
  }

  // What a read is worth is what following it earns, so a read is fitted by
  // exactly that: every policy of the form below is scored on the margin it
  // would have won here, reading each club-game's gain at the recommended rate
  // off the settings actually played (linear between neighbours). The payoff
  // is two-ended — all-out run for one kind of squad, all-out pass for the
  // other, flat between — so the family is a ramp through a crossover edge
  // `e0`, as steep as the data wants it.
  const policy = (e0, slope) => (edge) => Math.max(0.35, Math.min(0.7, 0.525 - slope * (edge - e0)));
  const gainAt = (row, rate) => {
    if (rate <= cols[0]) return row.gain[cols[0]];
    for (let i = 1; i < cols.length; i++) {
      if (rate <= cols[i] + 1e-9) { const a = cols[i - 1], b = cols[i]; return row.gain[a] + (row.gain[b] - row.gain[a]) * (rate - a) / (b - a); }
    }
    return row.gain[cols[cols.length - 1]];
  };
  const score = (rule) => rows.map((r) => gainAt(r, rule(r.edge)));
  let best = null;
  for (let e0 = -8; e0 <= 2.001; e0 += 0.25) {
    for (const slope of [0.02, 0.035, 0.05, 0.075, 0.1, 0.15, 0.25, 1]) {
      const m = mean(score(policy(e0, slope)));
      if (!best || m > best.m) best = { e0, slope, m };
    }
  }
  // Policies fitted elsewhere, to be scored here out of sample: READ_POLICIES="-3.25:1,-3:0.15".
  const given = (process.env.READ_POLICIES || '').split(',').filter(Boolean).map((x) => { const [e0, slope] = x.split(':').map(Number); return { e0, slope }; });
  console.log('\nWhat each way of setting the dial wins, against 0.55, over the same club-games:');
  const report = (label, rule) => console.log(`  ${label.padEnd(52)} ${pm(rule ? score(rule) : rows.map((r) => r.gain.read))}`);
  report('the read as it was, 0.64 - 0.023 x edge', (e) => Math.max(0.35, Math.min(0.7, 0.64 - 0.023 * e)));
  report('the read as it is (strategy.js)', null);
  report('always 0.35', () => 0.35);
  report('always 0.70', () => 0.7);
  report(`fitted here: crossover ${best.e0.toFixed(2)}, slope ${best.slope}`, policy(best.e0, best.slope));
  for (const g of given) report(`given: crossover ${g.e0}, slope ${g.slope}`, policy(g.e0, g.slope));
  // How sharp the optimum is: the best crossover at each slope.
  const bySlope = [0.05, 0.1, 0.15, 0.25, 1].map((slope) => {
    let top = null;
    for (let e0 = -8; e0 <= 2.001; e0 += 0.25) { const m = mean(score(policy(e0, slope))); if (!top || m > top.m) top = { e0, m }; }
    return `slope ${slope}: ${top.e0.toFixed(2)} (${top.m >= 0 ? '+' : ''}${top.m.toFixed(2)})`;
  });
  console.log(`  best crossover by slope, in sample: ${bySlope.join(' · ')}`);
} else {
  console.error(`unknown mode ${MODE}: ai or read`);
  process.exit(1);
}

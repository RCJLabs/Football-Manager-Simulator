// What makes the human's next game more than the next game on the list.
//
// The matchup card already had the series between the two clubs; what it did
// not say is why this one matters, and a broadcast leads with exactly that.
// The lines here are read out of what the league already keeps: the week's
// odds reading, this season's results, the season stat lines, the record book,
// the career table and the transaction log. Nothing is stored and nothing is
// drawn at random, so the same league tells the same story every time it is
// opened, and an old save tells its own.
//
// Each line has a weight, the most notable first, and the hub shows three.

import { userTeamIndex, userGameThisWeek, isPro } from './season.js';
import { oddsKey, oddsPoints } from './odds.js';
import { overall } from './ratings.js';

/** A split of the odds runs is stated only when both halves have this many finishes. */
export const STAKE_MIN_RUNS = 100;
/** The gap between a win and a loss, in playoff chance, before it is a story. */
export const STAKE_MIN_SWING = 0.05;
/** A run of results worth saying out loud, for the human's club and for the opponent. */
export const STREAK_MIN = 3;

// Round numbers a season total can reach, and how much of one a player could
// add in a single good game: within that, the milestone is in play this week.
const MILESTONES = [
  { stat: (s) => s.pass.yds, label: ['passing yard', 'passing yards'], marks: [3000, 4000, 5000], reach: 320, record: 'passYds' },
  { stat: (s) => s.pass.td, label: ['touchdown pass', 'touchdown passes'], marks: [20, 30, 40, 50], reach: 3, record: 'passTd' },
  { stat: (s) => s.rush.yds, label: ['rushing yard', 'rushing yards'], marks: [1000, 1500, 2000], reach: 130, record: 'rushYds' },
  { stat: (s) => s.rush.td, label: ['rushing touchdown', 'rushing touchdowns'], marks: [10, 15, 20], reach: 2, record: 'rushTd' },
  { stat: (s) => s.rec.yds, label: ['receiving yard', 'receiving yards'], marks: [1000, 1500], reach: 130, record: 'recYds' },
  { stat: (s) => s.rec.rec, label: ['catch', 'catches'], marks: [100], reach: 9, record: 'receptions' },
  { stat: (s) => s.rec.td, label: ['touchdown catch', 'touchdown catches'], marks: [10, 15], reach: 2, record: 'recTd' },
  { stat: (s) => s.def.sck, label: ['sack', 'sacks'], marks: [10, 15, 20], reach: 2, record: 'sacks' },
  { stat: (s) => s.def.int, label: ['interception', 'interceptions'], marks: [5, 10], reach: 1, record: 'interceptions' },
];
const counted = (n, [one, many]) => `${num(n)} ${n === 1 ? one : many}`;

// A share as the hub prints one (race.js, `fmtShare`): never 0% or 100% from
// a count of finishes, because a thousand of them can miss a chance that is
// small without being none.
const pct = (x) => (x >= 0.995 ? '>99%' : x < 0.005 ? '<1%' : `${Math.round(x * 100)}%`);
const num = (x) => x.toLocaleString('en-US');
const score = (a, b) => `${a}–${b}`;

/** This season's results for one club, oldest first: `won` is true, false, or null for a tie. */
function resultsOf(league, idx) {
  const out = [];
  for (const r of league.results || []) {
    if (r.season !== league.season || (r.home !== idx && r.away !== idx)) continue;
    const mine = r.home === idx ? r.score[0] : r.score[1];
    const theirs = r.home === idx ? r.score[1] : r.score[0];
    out.push({ r, opp: r.home === idx ? r.away : r.home, mine, theirs, won: mine === theirs ? null : mine > theirs });
  }
  return out;
}

/** The run a club carries into this game: `{ run, won }`, a tie ending it. */
function streakOf(league, idx) {
  let run = 0, won = null;
  const list = resultsOf(league, idx);
  for (let i = list.length - 1; i >= 0; i--) {
    const w = list[i].won;
    if (w === null) break;
    if (won === null) won = w;
    else if (w !== won) break;
    run++;
  }
  return { run, won };
}

/** What a win and a loss each leave the playoff chance at, from the week's reading. */
function stakes(league, u) {
  if (league.phase !== 'season') return null;
  const point = oddsPoints(league).find((p) => p.key === oddsKey(league));
  const st = point?.stake;
  if (!st || st.team !== u) return null;
  const [wonRuns, lostRuns] = st.runs;
  if (wonRuns < STAKE_MIN_RUNS || lostRuns < STAKE_MIN_RUNS) return null;
  const ifWon = st.playoff[0] / wonRuns, ifLost = st.playoff[1] / lostRuns;
  if (ifWon - ifLost < STAKE_MIN_SWING) return null;
  return {
    kind: 'stakes', weight: 60 + Math.round((ifWon - ifLost) * 100),
    text: `Playoff chance with a win: ${pct(ifWon)}. With a loss: ${pct(ifLost)}.`,
    ifWon, ifLost,
  };
}

/** The last time these two met this season. */
function rematch(league, u, opp) {
  const met = resultsOf(league, u).filter((x) => x.opp === opp);
  const last = met[met.length - 1];
  if (!last) return null;
  const when = last.r.phase === 'season' ? `in week ${last.r.week}` : 'in the playoffs';
  const margin = Math.abs(last.mine - last.theirs);
  const text = last.won === null ? `You tied ${score(last.mine, last.theirs)} ${when}`
    : last.won ? `You beat them ${score(last.mine, last.theirs)} ${when}`
      : `They beat you ${score(last.theirs, last.mine)} ${when}`;
  return { kind: 'rematch', weight: 50 + (margin >= 21 ? 5 : 0), text: `${text}${met.length > 1 ? `; ${seasonSeries(met)}` : ''}.` };
}

/** The season's meetings so far, said from whichever side leads. */
function seasonSeries(met) {
  const w = met.filter((x) => x.won === true).length, l = met.filter((x) => x.won === false).length, t = met.length - w - l;
  const tail = t ? `–${t}` : '';
  if (w === l) return `the season series is level at ${w}–${l}${tail}`;
  return w > l ? `you lead the season series ${w}–${l}${tail}` : `they lead the season series ${l}–${w}${tail}`;
}

function streaks(league, u, opp) {
  const out = [];
  const mine = streakOf(league, u);
  if (mine.run >= STREAK_MIN) out.push({ kind: 'streak', weight: 40 + mine.run * 3, text: mine.won ? `You have won ${mine.run} straight.` : `You have lost ${mine.run} in a row.` });
  const theirs = streakOf(league, opp);
  if (theirs.run >= STREAK_MIN) out.push({ kind: 'streak', weight: 30 + theirs.run * 3, text: theirs.won ? `They have won ${theirs.run} straight.` : `They have lost ${theirs.run} in a row.` });
  return out;
}

/** Men in the human's lineup this week: every filled slot of a man not on the injury ledger. */
function playing(team, league, byId) {
  const hurt = league.injuries || {};
  return Object.values(team.slots || {}).filter((id) => id && !hurt[id] && byId.get(id));
}

/**
 * The best thing a man of the human's could reach in this game: the league's
 * season record where one is on the books and in reach, or else the next round
 * number. A record already broken this season is said as that.
 */
function milestones(league, byId, u) {
  const me = league.teams[u];
  const book = league.records?.players || {};
  let best = null;
  for (const id of playing(me, league, byId)) {
    const s = me.seasonStats?.players?.[id];
    if (!s || !(s.games > 0)) continue;
    const p = byId.get(id);
    for (const m of MILESTONES) {
      const v = m.stat(s);
      const rec = book[m.record];
      if (rec && rec.value > 0) {
        const own = rec.id === id;
        const holder = own ? null : byId.get(rec.id)?.name;
        const by = holder ? ` (${holder}, season ${rec.season})` : ` (season ${rec.season})`;
        const whose = own ? 'his own season record' : "the league's season record";
        if (v > rec.value && rec.season !== league.season) {
          const item = { kind: 'record', weight: 66, text: `${p.name} is past ${whose} for ${m.label[1]}, ${num(rec.value)}${by}, with ${num(v)} and counting.` };
          if (!best || item.weight > best.weight) best = item;
          continue;
        }
        // Every one of these is counted in whole units, so breaking a record
        // takes one more than the gap.
        const need = rec.value - v + 1;
        if (need >= 1 && need <= m.reach) {
          const item = { kind: 'record', weight: 70, text: `${p.name} needs ${counted(need, m.label)} to break ${whose} of ${num(rec.value)}${by}.` };
          if (!best || item.weight > best.weight) best = item;
          continue;
        }
      }
      const at = m.marks.findIndex((mark) => v < mark);
      if (at < 0) continue;
      const need = m.marks[at] - v;
      if (need > m.reach) continue;
      const item = { kind: 'milestone', weight: 38 + at * 4, text: `${p.name} needs ${counted(need, m.label)} for ${num(m.marks[at])} this season.` };
      if (!best || item.weight > best.weight) best = item;
    }
  }
  return best;
}

/** How good a former man of the human's has to be before his lining up for the other side is news. */
export const FORMER_MIN_OVERALL = 85;

/**
 * A man in one lineup who played for the other club. A trade between the two
 * is always worth saying, whichever way it went. Otherwise it is said only of
 * a man who played for the human, now on the other side, rated 85 or more,
 * and only in a pro league: a fantasy league re-drafts most of its rosters
 * every year, so nearly every lineup there holds someone who once played for
 * nearly everybody, and measured over three fantasy seasons it was true every
 * week. "Played for" is this season's stat lines or, for earlier seasons, the
 * career table. The best-rated man is the one mentioned.
 */
function former(league, byId, u, opp) {
  const me = league.teams[u], them = league.teams[opp];
  const careers = league.careers || {};
  const tradedTo = (id, from, to) => (league.transactions || []).find((tx) => tx.type === 'trade'
    && ((tx.team === from && tx.other === to && tx.gives?.includes(id)) || (tx.team === to && tx.other === from && tx.gets?.includes(id))));
  const playedFor = (id, club, clubIdx) => (club.seasonStats?.players?.[id]?.games > 0) || (careers[id]?.teams || []).includes(clubIdx);
  const found = [];
  const pro = isPro(league);
  for (const id of playing(them, league, byId)) {
    // A trade is proof enough on its own: a man dealt before he played a snap
    // for the human has no stat line with them to find.
    const tx = tradedTo(id, u, opp);
    if (tx || (pro && playedFor(id, me, u) && overall(byId.get(id)) >= FORMER_MIN_OVERALL)) found.push({ id, from: u, tx });
  }
  for (const id of playing(me, league, byId)) {
    const tx = tradedTo(id, opp, u);
    if (tx) found.push({ id, from: opp, tx });
  }
  if (!found.length) return null;
  // A trade between the two outranks a man who simply moved on; then the better man.
  found.sort((a, b) => (b.tx ? 1 : 0) - (a.tx ? 1 : 0) || overall(byId.get(b.id)) - overall(byId.get(a.id)) || (a.id < b.id ? -1 : 1));
  const { id, from, tx } = found[0];
  const p = byId.get(id);
  const when = tx ? (tx.season === league.season ? `in week ${tx.week}` : `in season ${tx.season}`) : null;
  const text = from === u
    ? (tx ? `You traded ${p.name} to them ${when}; he lines up against you.` : `${p.name}, who played for you, lines up for them.`)
    : `${p.name} faces the club that traded him to you ${when}.`;
  return { kind: 'former', weight: (tx ? 45 : 40) + (tx && tx.season === league.season ? 8 : 0) + Math.max(0, overall(p) - 85), text };
}

/**
 * The storylines of the human's next game, most notable first, `limit` of
 * them. None once the game has been played, and none on a bye.
 */
export function storylines(league, byId, { limit = 3 } = {}) {
  if (!league || !byId || (league.phase !== 'season' && league.phase !== 'playoffs')) return [];
  const game = userGameThisWeek(league);
  if (!game || game.result) return [];
  const u = userTeamIndex(league);
  const opp = game.home === u ? game.away : game.home;
  const items = [
    stakes(league, u),
    rematch(league, u, opp),
    ...streaks(league, u, opp),
    milestones(league, byId, u),
    former(league, byId, u, opp),
  ].filter(Boolean);
  items.sort((a, b) => b.weight - a.weight);
  return items.slice(0, limit);
}

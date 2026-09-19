// Coaching jobs: an owner who expects something, and a league of rivals who
// can be sacked too.
//
// Until now there was no failure state. You could finish last for twenty
// seasons and nothing happened, which meant no decision ever really cost
// anything. An owner fixes that, but a hard game-over is the wrong shape for
// a dynasty — so being sacked moves you rather than ending you.
//
// That only works as a stake because careers and chemistry already exist.
// Losing your job costs the squad you spent five seasons building, the keepers
// you were compounding, and the continuity your chemistry was made of, and
// hands you somebody else's mess with somebody else's contracts on the books.
// It is a real price without being a wall.
//
// Rival coaches are not decoration. They are the supply. If the computer clubs
// never changed coach there would be no vacancies, so nobody would ever call
// you, and being sacked would be a dead end after all. Every club's coach is
// under the same pressure you are, and when one goes his job is on the market.
// His personality goes with him, so a club that changes coach changes how it
// drafts and how it plays.
//
// Pro mode only. An eight-club league has no job market worth the name.

import { hashSeed, RNG } from './rng.js';
import { GM_PERSONALITIES, SAVVY } from '../data/teams.js';
import { FIRST_NAMES, LAST_NAMES } from '../data/rookie-names.js';
import { buildLineup, teamPower } from './ratings.js';

// Deliberately not importing season.js: startSeason has to stand the carousel
// up, so the dependency runs that way and these three are small enough to keep
// here rather than build a cycle for.
const isPro = (league) => league.mode === 'pro';
const userTeamIndex = (league) => league.teams.findIndex((t) => t.isUser);
function powerRankings(league, byId) {
  return league.teams
    .map((t, i) => ({ idx: i, team: t, power: teamPower(buildLineup(t.slots, byId, league.injuries)) }))
    .sort((a, b) => b.power - a.power);
}

/** Reputation everyone starts from. */
export const BASE_REP = 50;
/** Below this, after being sacked, nobody calls again. */
export const REP_FLOOR = 18;
/** Seasons of patience an owner has, before the club's own temperament. */
export const BASE_PATIENCE = 4;

export function jobsOn(league) {
  return !!(league && league.settings && league.settings.jobs && isPro(league));
}

/**
 * What an owner wants this year, set against the roster rather than against the
 * table. A bar of "make the playoffs" for a club with the worst roster in the
 * league is not an expectation, it is a pretext — and a coach who builds a
 * great squad should be expected to win with it. Power rank does both, and it
 * moves as the roster does, so the bar follows the job.
 */
export function goalFor(league, teamIdx, byId) {
  const ranks = powerRankings(league, byId);
  const rank = ranks.findIndex((r) => r.idx === teamIdx) + 1;
  const n = league.teams.length;
  const q = rank / n;
  if (q <= 0.25) return { key: 'deep', rank, text: 'win a playoff round', short: 'A playoff round' };
  if (q <= 0.5) return { key: 'playoffs', rank, text: 'reach the playoffs', short: 'The playoffs' };
  if (q <= 0.75) return { key: 'winning', rank, text: 'finish with a winning record', short: 'A winning record' };
  return { key: 'progress', rank, text: 'show progress on last year', short: 'Progress' };
}

/** How far a club actually went, from the history entry the final wrote. */
function outcomeOf(league, teamIdx, season) {
  const h = (league.history || []).find((x) => x.season === season);
  const t = league.teams[teamIdx];
  const rec = t.record || { w: 0, l: 0, t: 0 };
  const games = rec.w + rec.l + rec.t;
  const winPct = games ? (rec.w + rec.t * 0.5) / games : 0;
  const champion = h && h.champion === teamIdx;
  const table = h ? h.finish : null;
  const place = table ? table.indexOf(teamIdx) + 1 : null;
  // The playoff field is the top seven per conference in a 32-club league, and
  // the top half everywhere else; the finish order is the honest proxy.
  const madePlayoffs = place != null && place <= Math.max(2, Math.round(league.teams.length * 0.44));
  const wonARound = champion || (place != null && place <= Math.max(1, Math.round(league.teams.length * 0.22)));
  return { rec, winPct, champion, place, madePlayoffs, wonARound };
}

/** Did the season clear the bar, miss it, or miss it badly? */
export function judge(goal, out, prevWins) {
  if (out.champion) return { met: true, margin: 2, text: 'won the title' };
  switch (goal.key) {
    case 'deep':
      if (out.wonARound) return { met: true, margin: 1, text: 'went deep' };
      return { met: false, margin: out.madePlayoffs ? -1 : -2, text: out.madePlayoffs ? 'went out early' : 'missed the playoffs with the roster to make them' };
    case 'playoffs':
      if (out.wonARound) return { met: true, margin: 2, text: 'went further than asked' };
      if (out.madePlayoffs) return { met: true, margin: 1, text: 'made the playoffs' };
      return { met: false, margin: out.winPct >= 0.45 ? -1 : -2, text: 'missed the playoffs' };
    case 'winning':
      if (out.madePlayoffs) return { met: true, margin: 2, text: 'overachieved' };
      if (out.winPct >= 0.5) return { met: true, margin: 1, text: 'finished above .500' };
      return { met: false, margin: out.winPct >= 0.4 ? -1 : -2, text: 'finished under .500' };
    default:
      if (out.madePlayoffs) return { met: true, margin: 2, text: 'far exceeded a rebuilding year' };
      if (prevWins == null || out.rec.w > prevWins) return { met: true, margin: 1, text: 'improved on last year' };
      return { met: false, margin: out.rec.w + 2 < prevWins ? -2 : -1, text: 'went backwards' };
  }
}

function coachName(rng) {
  return `${FIRST_NAMES[rng.int(0, FIRST_NAMES.length - 1)]} ${LAST_NAMES[rng.int(0, LAST_NAMES.length - 1)]}`;
}

function blankCoach(id, name, gm, rep) {
  return { id, name, gm, rep, team: null, seasons: 0, w: 0, l: 0, t: 0, titles: 0, heat: 0, sacked: 0, jobs: [], you: false };
}

/**
 * Stand up the coaching carousel: one coach per club, plus you. Owners get a
 * temperament here and keep it, so a club known for firing people keeps being
 * one — that is a thing you can learn about the league and plan around.
 */
export function initJobs(league, rng = new RNG(hashSeed(`jobs:${league.seed >>> 0}`))) {
  const coaches = {};
  const taken = new Set();
  const u = userTeamIndex(league);
  league.teams.forEach((t, i) => {
    t.patience = BASE_PATIENCE + rng.int(-1, 2);
    if (i === u) {
      const you = blankCoach('you', 'You', null, BASE_REP);
      you.you = true;
      you.team = i;
      you.jobs = [{ team: i, from: league.season }];
      coaches.you = you;
      t.coach = 'you';
      return;
    }
    let name = coachName(rng);
    for (let k = 0; k < 8 && taken.has(name); k++) name = coachName(rng);
    taken.add(name);
    const id = `co-${i}`;
    // A coach's reputation starts near how shrewd he is, so the good ones are
    // the ones the good clubs want, and the carousel has a pecking order.
    const gm = t.gm || GM_PERSONALITIES[rng.int(0, GM_PERSONALITIES.length - 1)].id;
    const c = blankCoach(id, name, gm, Math.round(BASE_REP + (SAVVY[gm] ?? 0.3) * 40 - 12 + rng.normal(0, 7)));
    c.team = i;
    c.jobs = [{ team: i, from: league.season }];
    coaches[id] = c;
    t.coach = id;
  });
  league.jobs = { coaches, status: 'employed', offers: null, log: [], pool: [] };
  return league.jobs;
}

export function coachOf(league, teamIdx) {
  const id = league.teams[teamIdx] && league.teams[teamIdx].coach;
  return (id && league.jobs && league.jobs.coaches[id]) || null;
}

export function yourCoach(league) {
  return (league.jobs && league.jobs.coaches.you) || null;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Score the season just finished for every coach, move reputation and heat, and
 * sack whoever has run out of rope. Returns what happened, for the report.
 */
export function reviewSeason(league, byId, rng) {
  const jobs = league.jobs;
  const season = league.season;
  const results = [];
  const sacked = [];
  for (const [idx, t] of league.teams.entries()) {
    const c = coachOf(league, idx);
    if (!c) continue;
    const goal = goalFor(league, idx, byId);
    // Set at the end of the previous review, so during this one it still holds
    // what the club won last year.
    const prevWins = jobs.lastWins ? jobs.lastWins[idx] : null;
    const out = outcomeOf(league, idx, season);
    const verdict = judge(goal, out, prevWins);

    c.seasons++;
    c.w += out.rec.w; c.l += out.rec.l; c.t += out.rec.t || 0;
    if (out.champion) c.titles++;
    // Heat is the thing that gets you sacked; reputation is the thing that gets
    // you hired again. They move together but not at the same rate, so a good
    // coach at a bad club can lose his job and still be wanted.
    c.heat = Math.max(0, c.heat - verdict.margin);
    if (out.champion) c.heat = 0;
    c.rep = clamp(Math.round(c.rep + verdict.margin * 3.2 + (out.champion ? 9 : 0)), 1, 99);
    const fired = c.heat >= (t.patience || BASE_PATIENCE);
    results.push({ team: idx, coach: c.id, name: c.name, you: !!c.you, goal, verdict, heat: c.heat, patience: t.patience, fired });
    if (fired) sacked.push({ team: idx, coach: c });
  }

  jobs.lastWins = Object.fromEntries(league.teams.map((t, i) => [i, t.record ? t.record.w : 0]));

  for (const { team, coach } of sacked) {
    coach.sacked++;
    coach.heat = 0;
    coach.team = null;
    coach.lastClub = team;
    const job = coach.jobs[coach.jobs.length - 1];
    if (job && job.to == null) job.to = season;
    league.teams[team].coach = null;
    jobs.log.push({ season, text: coach.you ? `${league.teams[team].name} let you go.` : `${league.teams[team].name} sacked ${coach.name}.` });
    if (!coach.you) jobs.pool.push(coach.id);
  }
  // A few fresh faces are always looking, so the market never runs dry.
  const wanted = Math.max(0, sacked.length - jobs.pool.length + 1);
  for (let i = 0; i < wanted; i++) {
    const id = `co-n${season}-${i}`;
    const gm = GM_PERSONALITIES[rng.int(0, GM_PERSONALITIES.length - 1)].id;
    const c = blankCoach(id, coachName(rng), gm, clamp(Math.round(BASE_REP - 6 + rng.normal(0, 9)), 20, 75));
    jobs.coaches[id] = c;
    jobs.pool.push(id);
  }
  jobs.status = yourCoach(league) && yourCoach(league).team == null ? 'seeking' : 'employed';
  // Kept on the league rather than only on the offseason record, because
  // startSeason clears the offseason and the season screen still wants to show
  // who the owners moved on.
  jobs.lastReview = { season, results };
  return { results, sacked: sacked.map((s) => ({ team: s.team, name: s.coach.name, you: !!s.coach.you })) };
}

/** Vacant clubs, best job first. A good roster is a good job. */
export function vacancies(league, byId) {
  const ranks = powerRankings(league, byId);
  return league.teams
    .map((t, i) => ({ idx: i, team: t, power: (ranks.find((r) => r.idx === i) || {}).power || 0 }))
    .filter((v) => !v.team.coach)
    .sort((a, b) => b.power - a.power);
}

/** What a club will settle for. The better the job, the higher the bar. */
export function standardFor(league, teamIdx, byId) {
  const all = powerRankings(league, byId);
  const rank = all.findIndex((r) => r.idx === teamIdx) + 1;
  const q = rank / league.teams.length;
  return Math.round(72 - q * 42);
}

/**
 * The jobs that would have you. Always at least one while your reputation is
 * above the floor, because a limbo season with no club is a dead season rather
 * than a punishment; below the floor, nobody calls and the career is over.
 */
export function makeOffers(league, byId) {
  const you = yourCoach(league);
  if (!you || you.team != null) return [];
  if (you.rep < REP_FLOOR) return [];
  // Not the club that just sacked you. No owner fires a man in February and
  // rehires him in March, and being handed your own job back would make the
  // sacking meaningless.
  const open = vacancies(league, byId).filter((v) => v.idx !== you.lastClub);
  const offer = (v, extra = {}) => ({
    team: v.idx,
    standard: standardFor(league, v.idx, byId),
    goal: goalFor(league, v.idx, byId),
    patience: v.team.patience || BASE_PATIENCE,
    ...extra,
  });
  const offers = [];
  for (const v of open) {
    if (you.rep >= standardFor(league, v.idx, byId)) offers.push(offer(v));
    if (offers.length >= 3) break;
  }
  // Somebody at the bottom will always take a chance on you.
  if (!offers.length && open.length) offers.push(offer(open[open.length - 1], { lastResort: true }));
  // Nothing vacant at all, which happens when you were the only one to go. A
  // coach the league still rates gets a club to make room for him, because that
  // is what clubs do — otherwise a career would end on the luck of being the
  // only sacking that year rather than on anything you did.
  if (!offers.length) {
    const ranks = powerRankings(league, byId);
    const poach = league.teams
      .map((t, i) => ({ idx: i, team: t, coach: coachOf(league, i), power: (ranks.find((r) => r.idx === i) || {}).power || 0 }))
      .filter((x) => x.coach && !x.coach.you && x.coach.rep < you.rep - 10)
      .sort((a, b) => b.power - a.power)[0];
    if (poach) offers.push(offer(poach, { displaces: poach.coach.id, displacesName: poach.coach.name }));
  }
  return offers;
}

/** Take a job. The club becomes yours, with whatever the last man left behind. */
export function acceptOffer(league, teamIdx) {
  const you = yourCoach(league);
  if (!you) throw new Error('No coaching career in this league');
  const sitting = coachOf(league, teamIdx);
  if (sitting && !sitting.you) {
    // Only ever reached through a poaching offer, which is only made when
    // nothing is vacant and this club's coach is rated well below you.
    if (sitting.rep >= you.rep - 10) throw new Error('That job has been filled');
    sitting.team = null;
    sitting.sacked++;
    sitting.lastClub = teamIdx;
    const job = sitting.jobs[sitting.jobs.length - 1];
    if (job && job.to == null) job.to = league.season;
    league.jobs.pool.push(sitting.id);
    league.jobs.log.push({ season: league.season, text: `${league.teams[teamIdx].name} sacked ${sitting.name} to make room for you.` });
  }
  for (const t of league.teams) t.isUser = false;
  const t = league.teams[teamIdx];
  t.isUser = true;
  t.coach = 'you';
  you.team = teamIdx;
  you.jobs.push({ team: teamIdx, from: league.season });
  league.jobs.status = 'employed';
  league.jobs.offers = null;
  league.jobs.log.push({ season: league.season, text: `You took the ${t.name} job.` });
  return t;
}

/** Fill everything you did not take, best club to best available coach. */
export function fillVacancies(league, byId, rng, { hold = [] } = {}) {
  const jobs = league.jobs;
  const held = new Set(hold);
  const hired = [];
  for (const v of vacancies(league, byId)) {
    if (v.team.isUser) continue;
    // A club that has offered you the job keeps it open until you answer.
    // Otherwise the carousel hires over your own offer before you can take it.
    if (held.has(v.idx)) continue;
    const standard = standardFor(league, v.idx, byId);
    const ranked = jobs.pool
      .map((id) => jobs.coaches[id])
      .filter((c) => c && c.team == null && !c.you)
      .sort((a, b) => b.rep - a.rep);
    if (!ranked.length) break;
    // The best club takes the best man who clears its bar; a club nobody wants
    // takes whoever is left, which is how a bad club stays bad.
    const pick = ranked.find((c) => c.rep >= standard) || ranked[0];
    pick.team = v.idx;
    pick.jobs.push({ team: v.idx, from: league.season });
    v.team.coach = pick.id;
    v.team.gm = pick.gm;
    const gm = GM_PERSONALITIES.find((g) => g.id === pick.gm);
    if (gm) v.team.strategy = { ...gm.strategy };
    jobs.pool = jobs.pool.filter((id) => id !== pick.id);
    jobs.log.push({ season: league.season, text: `${v.team.name} hired ${pick.name}.` });
    hired.push({ team: v.idx, name: pick.name });
  }
  return hired;
}

/** Nobody is calling. The career is over; the league stays readable. */
export function retire(league, reason = 'No club will have you.') {
  league.jobs.status = 'retired';
  league.jobs.retiredReason = reason;
  league.jobs.log.push({ season: league.season, text: reason });
}

/** Your coaching record, for the career screen. */
export function careerSummary(league) {
  const you = yourCoach(league);
  if (!you) return null;
  const clubs = you.jobs.map((j) => ({
    name: league.teams[j.team] ? league.teams[j.team].name : 'a club',
    from: j.from,
    to: j.to,
  }));
  const games = you.w + you.l + you.t;
  return {
    seasons: you.seasons,
    w: you.w, l: you.l, t: you.t,
    winPct: games ? (you.w + you.t * 0.5) / games : 0,
    titles: you.titles,
    sacked: you.sacked,
    rep: you.rep,
    clubs,
    status: league.jobs.status,
  };
}

/** How safe you are right now, in words rather than a hidden number. */
export function seatWarmth(league, teamIdx) {
  const c = coachOf(league, teamIdx);
  if (!c) return null;
  const patience = league.teams[teamIdx].patience || BASE_PATIENCE;
  const left = patience - c.heat;
  const band = left <= 1 ? 'hot' : left <= 2 ? 'warm' : 'safe';
  const text = left <= 1 ? 'One more season like the last and you are gone.'
    : left <= 2 ? 'The owner has noticed. Another miss and it gets serious.'
      : 'The owner is patient for now.';
  return { heat: c.heat, patience, left, band, text };
}

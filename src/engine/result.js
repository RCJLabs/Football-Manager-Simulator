// Season result cards. Two people who opened the same league code play the
// same starting rosters; this is how they settle who did better with them.
//
// A card is a small pasteable code carrying one club's finished season: where
// it came, its record, the champion, the MVP and its own best players. It is
// stamped with a fingerprint of the league it was played in, so comparing two
// cards from different leagues is refused rather than quietly meaningless.
//
// Deliberately not a replay. Nothing here depends on the engine's constants,
// so a card stays readable after the simulation is retuned.

import { packCode, unpackCode, poolFingerprint } from './share.js';
// The bracket reading lives with the season engine; re-exported here so a card
// and its comparison come from one module.
export { playoffRun } from './season.js';

export const RESULT_VERSION = 1;

/**
 * What makes two leagues "the same league" for comparison: the seed that
 * built the schedule, the shape of the competition, the season played and the
 * player pool. Two people who opened the same code share all four.
 */
export function leagueFingerprint(league, players, season = league.season) {
  return [league.seed, league.mode || 'fantasy', league.teams.length, season, poolFingerprint(players)].join(':');
}

/** Seasons this league can produce a card for, newest first. */
export function cardSeasons(league) {
  return (league.history || []).filter((h) => h.user).map((h) => h.season).sort((a, b) => b - a);
}

/**
 * Build the card for one finished season. Everything comes from the history
 * entry written when the title was decided, so a card survives into later
 * seasons and does not depend on the current table.
 */
export function seasonResult(league, byId, players, season = cardSeasons(league)[0]) {
  const h = (league.history || []).find((x) => x.season === season && x.user);
  if (!h) throw new Error('That season has not finished yet');
  const champ = league.teams[h.champion];
  const mvp = h.awards?.mvp;
  const u = league.teams.findIndex((t) => t.isUser);
  return {
    v: RESULT_VERSION,
    fp: leagueFingerprint(league, players, season),
    league: league.name,
    season,
    mode: league.mode || 'fantasy',
    teams: league.teams.length,
    club: h.user.club || { name: league.teams[u].name, abbr: league.teams[u].abbr, color: league.teams[u].color },
    record: { ...h.user.record },
    rank: h.user.rank,
    playoff: h.user.playoff || 'unknown',
    champion: champ ? { name: champ.name, abbr: champ.abbr, mine: h.champion === u } : null,
    mvp: mvp && byId.get(mvp.id) ? { name: byId.get(mvp.id).name, pos: byId.get(mvp.id).pos, club: league.teams[mvp.team].abbr, mine: mvp.team === u } : null,
    best: h.user.best || [],
  };
}

export const encodeResultCode = (result) => packCode('GR', result);

export async function decodeResultCode(code) {
  const r = await unpackCode('GR', code, 'season card');
  if (r.v !== RESULT_VERSION) throw new Error(`Season card version ${r.v} is not supported`);
  return r;
}

const pctOf = (r) => { const gp = r.w + r.l + r.t; return gp ? (r.w + r.t * 0.5) / gp : 0; };
const diffOf = (r) => r.pf - r.pa;
export const fmtRecord = (r) => `${r.w}-${r.l}${r.t ? `-${r.t}` : ''}`;

/**
 * Compare two cards. The order that decides it: winning the title beats
 * everything, then how far each club went, then the table, then wins, then
 * point differential. A tie is a tie and says so.
 */
export function compareResults(mine, theirs) {
  if (!mine || !theirs) throw new Error('Two cards are needed');
  if (mine.fp !== theirs.fp) {
    return { ok: false, reason: 'These cards are from different leagues, so the seasons are not comparable. Both of you need to have opened the same league code and played the same season.' };
  }
  const rows = [
    { label: 'Record', mine: fmtRecord(mine.record), theirs: fmtRecord(theirs.record), win: Math.sign(pctOf(mine.record) - pctOf(theirs.record)) },
    { label: 'Finish', mine: `${mine.rank} of ${mine.teams}`, theirs: `${theirs.rank} of ${theirs.teams}`, win: Math.sign(theirs.rank - mine.rank) },
    { label: 'Points for', mine: mine.record.pf, theirs: theirs.record.pf, win: Math.sign(mine.record.pf - theirs.record.pf) },
    { label: 'Points against', mine: mine.record.pa, theirs: theirs.record.pa, win: Math.sign(theirs.record.pa - mine.record.pa) },
    { label: 'Point differential', mine: diffOf(mine.record), theirs: diffOf(theirs.record), win: Math.sign(diffOf(mine.record) - diffOf(theirs.record)) },
    { label: 'Postseason', mine: mine.playoff, theirs: theirs.playoff, win: Math.sign(runScore(mine) - runScore(theirs)) },
    { label: 'Champion', mine: mine.champion ? mine.champion.name : '—', theirs: theirs.champion ? theirs.champion.name : '—', win: 0 },
    { label: 'MVP', mine: mvpText(mine), theirs: mvpText(theirs), win: 0 },
  ];
  const order = [runScore(mine) - runScore(theirs), theirs.rank - mine.rank, mine.record.w - theirs.record.w, diffOf(mine.record) - diffOf(theirs.record)];
  const decider = order.findIndex((d) => d !== 0);
  const better = decider < 0 ? 0 : Math.sign(order[decider]);
  const why = ['the deeper run', 'the higher finish', 'more wins', 'a better point differential'][decider] || '';
  const verdict = better === 0
    ? 'Dead heat. Same rosters, same season, nothing between you.'
    : better > 0 ? `You had the better season, on ${why}.` : `They had the better season, on ${why}.`;
  const sameChampion = !!(mine.champion && theirs.champion && mine.champion.abbr === theirs.champion.abbr);
  return { ok: true, rows, better, verdict, sameChampion, season: mine.season, league: mine.league };
}

function mvpText(r) {
  return r.mvp ? `${r.mvp.name} (${r.mvp.pos}, ${r.mvp.club})` : '—';
}

/** A number for how far a club went, so two postseasons can be ordered. */
function runScore(r) {
  const t = r.playoff || '';
  if (/won the title/.test(t)) return 100;
  if (/reached the/.test(t)) return 60;
  if (/lost in the Conference/.test(t)) return 50;
  if (/lost in the Divisional|lost in the Semifinals/.test(t)) return 40;
  if (/lost in the Championship/.test(t)) return 70;
  if (/lost in the Wild Card/.test(t)) return 30;
  if (/lost in/.test(t)) return 35;
  if (/made the playoffs/.test(t)) return 25;
  return 0;
}



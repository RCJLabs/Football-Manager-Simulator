// The offseason: contracts expire, each club keeps a few players at a raised
// price, everyone else goes back into the pool, and a market (auction or draft)
// fills the open slots under the same $200 cap. Then a new season starts.
//
// Keeper rules, deliberately the common fantasy ones:
//   - keep up to `settings.keepers` players
//   - an auction keeper costs last year's price plus the greater of $3 or 15%
//   - a player can be kept three seasons running, then he must return to the pool
//   - in a draft league keepers simply hold their slots; the draft runs worst to first
// The pool is one snapshot per player, so there is no aging: the churn these
// rules force is what makes one season feel different from the next.

import { ROSTER_SLOTS } from '../data/positions.js';
import { GM_PERSONALITIES } from '../data/teams.js';
import { overall } from './ratings.js';
import { RNG } from './rng.js';
import { emptyTeamStats } from './stats.js';
import { createAuction, priceGuide, DEFAULT_BUDGET, MIN_BID } from './auction.js';
import { capOn, expireContracts, marketSalary, bookDead, tickDead, deadHit, teamContractIds, VET_YEARS, PRO_CAP, MIN_SALARY, SLOT_RESERVE } from './cap.js';
import { openFreeAgency, resolveFreeAgency } from './freeagency.js';
import { createDraft } from './draft.js';
import { standings, syncContracts, userTeamIndex, thinCompletedLogs } from './season.js';
import { drainVeterans } from './proleague.js';
import { clearIr } from './injuries.js';
import { addRookieClass } from './rookies.js';
import { advanceCareers, releaseRetired, primeAge } from './careers.js';
// The price of a contract's length lives in terms.js, because free agency
// needs it and this file imports free agency — importing it back would be a
// cycle over a `const`, which throws rather than resolving by luck. Re-exported
// so everything that has always imported these from here still does.
import { RESIGN_PREMIUM, TERM_PRICE, TERMS, aiTerm, termsOpen, termsFor, priceOf } from './terms.js';
export { RESIGN_PREMIUM, TERM_PRICE, TERMS, aiTerm, termsOpen, termsFor, priceOf };
import { jobsOn, reviewSeason, fillVacancies, makeOffers, acceptOffer, yourCoach, retire, REP_FLOOR } from './jobs.js';

export const MAX_KEEPS = 3;
export const KEEPER_RAISE_MIN = 3;
export const KEEPER_RAISE_PCT = 0.15;
/** How far over market an AI club will go to keep a player rather than bid for him again. */
export const BIRD_IN_HAND = 1.15;

/**
 * The length this club has chosen for this man, defaulting to the old flat
 * three — and always three where `termsOpen` says there is no choice, so a
 * length stored before careers were switched off cannot price a keeper.
 */
export function termFor(league, playerId) {
  if (!termsOpen(league)) return VET_YEARS;
  const t = league.offseason?.terms?.[playerId];
  return TERM_PRICE[t] ? t : VET_YEARS;
}

/** Choose one. Anything not on the menu falls back to the default rather than throwing. */
export function setTerm(league, playerId, years) {
  league.offseason ??= {};
  league.offseason.terms ??= {};
  if (TERM_PRICE[years] && termsFor(league).includes(years)) league.offseason.terms[playerId] = years;
  else delete league.offseason.terms[playerId];
  return league.offseason.terms;
}

/**
 * The franchise tag: one man a year kept on a one-year deal at the going rate
 * for his position.
 *
 * The real league's tag exists because a club CANNOT simply re-sign a player —
 * he has to agree, and the tag is the one tool that overrides him. Nothing like
 * that constraint exists here: re-signing is already unilateral and already
 * certain. A tag that only guaranteed retention would be `RESIGN_PREMIUM` at a
 * worse price, which is no decision at all.
 *
 * So what it buys here is TERM, not certainty. Re-signing an expiring man
 * writes a fresh `VET_YEARS` deal, and `DEAD_SHARE` means walking away from it
 * early costs half of what is left — which is a trap the ageing curve springs
 * on you, because the men worth this money are usually the men about to decline.
 * The tag is one season, at a premium, with nothing owed afterwards.
 */
export const TAG_TOP_N = 5;

/**
 * What the tag costs, as a multiple of the man's own market price.
 *
 * It has to exceed `RESIGN_PREMIUM` or tagging would dominate re-signing and
 * this would be the same defect over again, the other way round. The gap
 * between them — 4% against 20% — is the price of not committing three years.
 */
export const TAG_PREMIUM = 1.6;

/**
 * The going rate at every position: the mean of the dearest `TAG_TOP_N` men
 * playing it anywhere in the league.
 *
 * A floor, not the price. For the best quarterback alive the top-five mean sits
 * BELOW his own market — he is one of the five and drags it up — so charging it
 * flat would make the tag a discount on the players it should cost most for.
 * Taking the larger of the two keeps the tag dearer than re-signing for
 * everybody, while the floor still makes tagging a squad player absurd: he pays
 * what a star earns.
 */
export function positionRates(league, byId) {
  const paid = {};
  for (const t of league.teams || []) {
    for (const s of ROSTER_SLOTS) {
      const id = t.slots[s.id];
      const p = id && byId?.get(id);
      if (p) (paid[p.pos] ??= []).push(marketSalary(p));
    }
  }
  const out = {};
  for (const [pos, xs] of Object.entries(paid)) {
    const top = xs.sort((a, b) => b - a).slice(0, TAG_TOP_N);
    out[pos] = Math.ceil(top.reduce((a, b) => a + b, 0) / top.length);
  }
  return out;
}

/**
 * What tagging this man would cost his club.
 *
 * The rates are cached on the offseason rather than recomputed: this is called
 * once per rostered player by `validateKeepers` and again by every club's
 * `aiKeepers`, and each rate costs a walk of all 864 roster slots. Without the
 * cache a single keeper screen would scan the league twenty-seven times over.
 */
export function tagCost(league, player) {
  if (!player) return MIN_SALARY;
  const rate = league.offseason?.rates?.[player.pos] ?? 0;
  return Math.max(rate, priceOf(marketSalary(player), TAG_PREMIUM));
}

/** Who each club has tagged this offseason, as playerId -> teamIdx. */
export function tagged(league) {
  return league.offseason?.tagged || {};
}

/** The man this club has tagged, if any. */
export function tagOf(league, teamIdx) {
  for (const [id, t] of Object.entries(tagged(league))) if (t === teamIdx) return id;
  return null;
}

/** Whether a club may still tag, and whether this man is a legal target. */
export function canTag(league, teamIdx, playerId) {
  if (!capOn(league)) return { ok: false, reason: 'Only a pro league has the tag' };
  const held = tagOf(league, teamIdx);
  if (held && held !== playerId) return { ok: false, reason: 'A club may tag one man a year' };
  if (!league.contracts?.[playerId]?.expiring) return { ok: false, reason: 'Only a man whose deal is up can be tagged' };
  return { ok: true };
}

/** Put the tag on, or take it off when `playerId` is null. */
export function setTag(league, teamIdx, playerId) {
  league.offseason ??= {};
  league.offseason.tagged ??= {};
  const held = tagOf(league, teamIdx);
  if (held) delete league.offseason.tagged[held];
  if (playerId == null) return league.offseason.tagged;
  const v = canTag(league, teamIdx, playerId);
  if (!v.ok) throw new Error(v.reason);
  league.offseason.tagged[playerId] = teamIdx;
  return league.offseason.tagged;
}

/** What keeping a player costs next season. */
export function keeperCost(contract, player = null, league = null) {
  // Under a cap, a man still under contract costs what he is being paid, and a
  // man whose deal is up costs what he is worth. That second half is the whole
  // squeeze: a cheap rookie deal runs out and the bill arrives at market rate.
  if (league && capOn(league)) {
    if (contract?.expiring) {
      if (player && tagged(league)[player.id] != null) return tagCost(league, player);
      return priceOf(marketSalary(player), TERM_PRICE[termFor(league, player?.id)]);
    }
    return contract?.salary ?? MIN_SALARY;
  }
  const salary = contract?.salary ?? MIN_BID;
  return Math.max(salary + KEEPER_RAISE_MIN, Math.ceil(salary * (1 + KEEPER_RAISE_PCT)));
}

export function keeperLimit(league) {
  // Under a cap the contract decides, not a quota. Two mechanisms of attrition
  // would double-count: four-year rookie deals already turn over about a
  // quarter of a roster a year, which is close to what the eighteen-of-
  // twenty-seven quota was doing on its own.
  if (capOn(league)) return ROSTER_SLOTS.length;
  // Only the fantasy league reaches here — `capOn` is the pro mode test.
  return league.settings?.keepers ?? 6;
}

export function keeperEligible(contract, league = null) {
  // Same reason: a capped league lets a man be re-signed as often as it can
  // afford him, because the affording is the limit.
  if (league && capOn(league)) return true;
  return (contract?.kept ?? 0) < MAX_KEEPS;
}

/**
 * Check a keeper list for one club: count, eligibility, ownership, and in an
 * auction league the cap (keepers plus $1 for every open slot must fit).
 */
export function validateKeepers(league, teamIdx, ids, byId = null) {
  const team = league.teams[teamIdx];
  const limit = keeperLimit(league);
  if (new Set(ids).size !== ids.length) return { ok: false, reason: 'A player is listed twice' };
  if (ids.length > limit) return { ok: false, reason: `At most ${limit} keepers` };
  const owned = new Set(ROSTER_SLOTS.map((s) => team.slots[s.id]).filter(Boolean));
  for (const id of ids) {
    if (!owned.has(id)) return { ok: false, reason: `${id} is not on the roster` };
    if (!keeperEligible(league.contracts[id], league)) return { ok: false, reason: `${id} has been kept ${MAX_KEEPS} years and must return to the pool` };
  }
  if (capOn(league)) {
    // The tag is a commitment, not a label: a club that tags a man and then
    // leaves him off the list has spent its one tag on nobody. Checked here so
    // the screen says so before the round is confirmed rather than after.
    const mine = tagOf(league, teamIdx);
    if (mine && !ids.includes(mine)) {
      return { ok: false, reason: `${byId?.get(mine)?.name ?? 'The tagged player'} is tagged — keep him or take the tag off` };
    }
  }
  if (league.draftType === 'auction' || capOn(league)) {
    // Money already owed to men who are gone is not available to spend. What
    // this round's own releases will add is not counted here — it cannot be,
    // since the list is what decides it — and `cutToCap` settles any overage
    // at kickoff, where it can see the whole roster.
    const money = (capOn(league) ? (league.cap ?? PRO_CAP) : (league.auction?.budget ?? DEFAULT_BUDGET))
      - (capOn(league) ? deadHit(league, teamIdx) : 0);
    const floor = capOn(league) ? SLOT_RESERVE : MIN_BID;
    const committed = ids.reduce((s, id) => s + keeperCost(league.contracts[id], byId?.get(id) || null, league), 0);
    const open = ROSTER_SLOTS.length - ids.length;
    if (committed + open * floor > money) return { ok: false, reason: `Keeping these costs $${committed}; that leaves less than $${floor} a slot for the other ${open}`, committed };
    return { ok: true, committed, budget: money - committed };
  }
  return { ok: true, committed: 0 };
}

/**
 * Open the offseason after a season is complete: contracts are synced (waiver
 * pickups land on $1 deals), and the AI clubs choose their keepers now so the
 * human can see the whole picture before choosing theirs.
 */
/**
 * A man who retires under contract leaves the rest of it behind, the way a cut
 * does: the guaranteed half of every year left, charged to the club that was
 * paying him. Returns what was booked, by player, for the offseason summary.
 *
 * Retirement used to delete the contract outright, and that one rule made a
 * five-year deal the right answer for a man of any age: the years a long deal
 * was supposed to cost were exactly the years a man retires into, and they
 * were never paid. Measured over 951 signings (`scripts/term-value.mjs`), five
 * years had the best return in every age band while it did. Real contracts do
 * not end that way either — the guaranteed money stays on the books.
 *
 * A deal that has just run out owes nothing: `expireContracts` has already run
 * this offseason, so an expiring man has no years left, and `deadCharge`
 * refuses him. Neither does a minimum deal, which halves to nothing.
 */
function bookRetirements(league, ids) {
  const owed = new Map();
  if (!capOn(league)) return owed;
  for (const id of ids) {
    const c = league.contracts?.[id];
    if (!c) continue;
    const team = league.teams.findIndex((t, i) => teamContractIds(league, i).includes(id));
    if (team < 0) continue;
    const charge = bookDead(league, team, id, c);
    if (charge) owed.set(id, { team, owed: charge.amount, owedYears: charge.years });
  }
  return owed;
}

export function enterOffseason(league, pool, byId) {
  if (league.phase !== 'complete') throw new Error('The season is not over');
  // The season just played stops being the one on screen, so its play-by-play
  // comes down to the story. This is the single biggest thing in a pro save —
  // see `thinCompletedLogs`.
  thinCompletedLogs(league);
  // The undrafted all-timers clear out a quarter at a time. Done before the
  // keeper round so the market a club shops in is the one it will actually
  // find, rather than one that shrinks under it between screens.
  const left = drainVeterans(
    league,
    new Set(league.teams.flatMap((t) => ROSTER_SLOTS.map((s) => t.slots[s.id]).filter(Boolean))),
    pool,
  );
  // Injured reserve empties: anyone whose slot was filled behind him is let go.
  const released = clearIr(league, byId);
  syncContracts(league, byId);
  // Contracts run down a year and whoever's deal is up leaves. In a capped
  // league this *is* the attrition — see `keeperLimit`.
  const expired = expireContracts(league);
  // Dead money runs down beside the live deals. A man cut two years ago with
  // one year left has finished being paid and stops counting.
  tickDead(league);
  const rng = new RNG(league.rngState);
  // Careers run first, so the keeper round is decided on who a player is now
  // rather than who he was when you signed him. Retired men leave their slots
  // empty; the market that follows fills them.
  // Absent, not false, is what a league written before careers existed looks
  // like. Those stay frozen until the setting is turned on, because turning a
  // rule on under a league somebody is halfway through is not a kindness.
  const careers = league.settings?.careers
    ? advanceCareers(league, byId)
    : { retired: [], risers: [], fallers: [], aged: 0 };
  const owed = bookRetirements(league, careers.retired.map((r) => r.id));
  releaseRetired(league, careers.retired.map((r) => r.id));
  // A new intake arrives before the market opens, and old unsigned rookies wash out.
  const intake = addRookieClass(league, rng, { pool });
  // The owners have their say before anybody picks a keeper, because a coach
  // who has just been sacked should not be choosing who his old club keeps, and
  // a coach who has just been hired should be choosing for his new one.
  const carousel = jobsOn(league) ? runCarousel(league, byId, rng) : null;
  league.rngState = rng.state;
  league.offseason = {
    season: league.season, step: carousel && carousel.offers ? 'jobs' : 'keepers',
    keepers: {}, user: null, releasedFromIr: released,
    // The going rate at each position, fixed here so every club is quoted the
    // same figure all round and no screen pays to recompute it. After careers,
    // because a rate built on who these men were last season prices the tag
    // off a league that no longer exists.
    rates: capOn(league) ? positionRates(league, byId) : null, tagged: {},
    rookies: intake.arrived.length, washedOut: intake.washed.length, leftTheLeague: left.length,
    expired: expired.length,
    aged: careers.aged,
    retired: careers.retired.filter((r) => r.owned).map((r) => ({ name: r.name, pos: r.pos, age: r.age, ...(owed.get(r.id) || {}) })),
    risers: careers.risers.slice(0, 5),
    fallers: careers.fallers.slice(0, 5),
    carousel,
  };
  league.phase = 'offseason';
  // The keeper round waits for a coach without a club to find one.
  if (league.offseason.step === 'keepers') pickAiKeepers(league, pool, byId);
  return league.offseason;
}

/**
 * Owners review, coaches are sacked, and every vacancy but yours is filled.
 * Returns what happened plus your offers, or null for `offers` when you still
 * have a job — in which case the offseason carries straight on.
 */
export function runCarousel(league, byId, rng) {
  const review = reviewSeason(league, byId, rng);
  const you = yourCoach(league);
  const youSacked = !!(you && you.team == null);
  let offers = null;
  if (youSacked) {
    offers = makeOffers(league, byId);
    if (!offers.length) retire(league, `No club will have you. Your reputation is ${you.rep}, and below ${REP_FLOOR} the phone stops ringing.`);
  }
  // Fill the rest now: the jobs you are not being offered are gone by the time
  // you decide, which is what makes a middling offer worth taking.
  const hired = fillVacancies(league, byId, rng, { hold: (offers || []).map((o) => o.team) });
  return { results: review.results, sacked: review.sacked, hired, offers: offers && offers.length ? offers : null };
}

/**
 * Take one of the offers: the club becomes yours, the ones you turned down are
 * filled by somebody else on the spot, and the keeper round can begin.
 */
export function takeJob(league, teamIdx, pool, byId) {
  const club = acceptOffer(league, teamIdx);
  const rng = new RNG(league.rngState);
  const alsoHired = fillVacancies(league, byId, rng);
  league.rngState = rng.state;
  if (league.offseason) {
    league.offseason.carousel = { ...(league.offseason.carousel || {}), offers: null, hired: [...((league.offseason.carousel || {}).hired || []), ...alsoHired] };
  }
  pickAiKeepers(league, pool, byId);
  return club;
}

/** AI keepers, deferred until it is settled which club is yours. */
export function pickAiKeepers(league, pool, byId) {
  const rng = new RNG(league.rngState);
  const keepers = {};
  league.teams.forEach((t, i) => { if (!t.isUser) keepers[i] = aiKeepers(league, i, pool, byId, rng); });
  league.rngState = rng.state;
  league.offseason.keepers = keepers;
  league.offseason.step = 'keepers';
  return keepers;
}

/**
 * What the market would say a player is worth at a fresh auction, before
 * anyone has bought anything: the same price guide the auction uses, run over
 * empty rosters. `worth` is real value; `prices` is reputation.
 */
export function freshGuide(league, pool) {
  const blankLeague = { teams: league.teams.map(() => ({ slots: {} })) };
  const blankAuction = { taken: {}, budgets: league.teams.map(() => league.auction?.budget ?? DEFAULT_BUDGET) };
  return priceGuide(blankAuction, blankLeague, pool);
}

/**
 * AI keepers: rank the roster by surplus (what the player is worth minus what
 * keeping him costs), through the GM's taste and savvy, and keep the best
 * bargains that fit under the cap. In a draft league it is simply the best
 * players by overall, with the same taste.
 */
/**
 * Which man an AI club puts the tag on, or null.
 *
 * The tag buys one year instead of three, so it is worth spending on the man
 * whose next three years look worst — someone already past the peak for his
 * position, where re-signing buys two years of decline and a dead-money bill to
 * get out of them. Weighted by what he earns, because a year of decline on a
 * cheap man costs nothing worth protecting against.
 *
 * Needs an age, so a league with careers switched off never tags. That is the
 * honest answer rather than a guess: with no ageing there IS no decline to
 * avoid, and the tag would be a pure overpay.
 */
export function aiTagChoice(league, teamIdx, roster, byId) {
  if (!capOn(league) || !league.offseason) return null;
  let best = null;
  for (const p of roster) {
    if (!league.contracts?.[p.id]?.expiring || p.age == null) continue;
    const past = p.age - primeAge(p.pos);
    if (past < 1) continue;
    const worth = marketSalary(p) * past;
    if (!best || worth > best.worth) best = { id: p.id, worth };
  }
  void byId;
  return best?.id ?? null;
}

export function aiKeepers(league, teamIdx, pool, byId, rng = null) {
  const team = league.teams[teamIdx];
  const gm = GM_PERSONALITIES.find((g) => g.id === team.gm) || GM_PERSONALITIES[0];
  const limit = keeperLimit(league);
  const roster = ROSTER_SLOTS.map((s) => team.slots[s.id]).filter((id) => id && keeperEligible(league.contracts[id], league)).map((id) => byId.get(id)).filter(Boolean);
  const taste = (p) => (gm.pos[p.pos] ?? 1) * (gm.era ? gm.era(p.season) : 1);
  if (league.draftType !== 'auction' && !capOn(league)) {
    return roster.map((p) => ({ p, v: overall(p) * taste(p) + (rng ? rng.normal(0, 1) : 0) })).sort((a, b) => b.v - a.v).slice(0, limit).map((x) => x.p.id);
  }
  const guide = freshGuide(league, pool);
  const savvy = { modern: 0.7, trenches: 0.62, defense: 0.5, balanced: 0.34, gambler: 0.26, ground: 0.16, oldschool: 0.18, airraid: 0.1 }[team.gm] ?? 0.3;
  const cap = (capOn(league) ? (league.cap ?? PRO_CAP) : (league.auction?.budget ?? DEFAULT_BUDGET))
    - (capOn(league) ? deadHit(league, teamIdx) : 0);
  const floor = capOn(league) ? SLOT_RESERVE : MIN_BID;
  // Terms are chosen before anything is priced, because the term IS the price.
  // The tag learned this the hard way: deciding after the cap test let a club
  // commit to something its own arithmetic then rejected.
  if (capOn(league) && league.offseason) {
    for (const p of roster) if (league.contracts[p.id]?.expiring) setTerm(league, p.id, aiTerm(league, p));
  }
  const scored = roster.map((p) => {
    const c = league.contracts[p.id];
    const cost = keeperCost(c, p, league);
    const market = (guide.worth.get(p.id) ?? 1) * savvy + (guide.prices.get(p.id) ?? 1) * (1 - savvy);
    // A bird in hand: a club pays a little over market to skip the auction's risk.
    const surplus = market * taste(p) * BIRD_IN_HAND - cost + (rng ? rng.normal(0, 1.5) : 0);
    // A man with years left on his deal is not a decision, and this is the one
    // place that was not true. `keeperLimit` has said since the cap shipped
    // that under a cap the contract decides rather than a quota — four-year
    // rookie deals turning over about a quarter of a roster a year — but the
    // keeper round then re-ran every player through the surplus test each
    // offseason, so a contract meant nothing after the year it was signed in.
    //
    // It fell hardest on the draft, which is priced above market on purpose: a
    // first-round rookie costs 15 to 20 against an auction guide that says he
    // is worth about 5, so his surplus is negative from the day he is picked
    // and his own club let him go every time. Measured over twelve seasons, a
    // class drafted 155 strong came back the next year 17 strong with three
    // years still to run.
    //
    // He is still droppable — the cap test below is applied to him exactly as
    // to anyone else, and a club that cannot fit its own contracts sheds the
    // ones it values least. That is a cut, which is what the real thing does.
    // What he no longer has to do is prove himself a bargain every August.
    const bound = capOn(league) && !!c && !c.expiring && (c.years ?? 0) > 0;
    return { id: p.id, cost, surplus, bound };
  }).filter((x) => x.bound || x.surplus > 0)
    .sort((a, b) => (Number(b.bound) - Number(a.bound)) || (b.surplus - a.surplus));
  const keep = [];
  let committed = 0;
  for (const x of scored) {
    if (keep.length >= limit) break;
    const open = ROSTER_SLOTS.length - keep.length - 1;
    if (committed + x.cost + open * floor > cap) continue;
    keep.push(x.id);
    committed += x.cost;
  }
  // The tag comes last, and only from men already being kept.
  //
  // Choosing it first was the obvious order and it is wrong: the tag IS what a
  // man costs, so tagging before the cap test let a club tag somebody its own
  // surplus test then declined, and `validateKeepers` threw on a list that had
  // spent a tag on a player who was not on it. Decide the list, tag inside it,
  // then re-price — and if the premium no longer fits, the tag comes off rather
  // than the player.
  if (capOn(league) && league.offseason) {
    setTag(league, teamIdx, null);
    const pick = aiTagChoice(league, teamIdx, keep.map((id) => byId.get(id)).filter(Boolean), byId);
    if (pick) {
      setTag(league, teamIdx, pick);
      const total = keep.reduce((sum, id) => sum + keeperCost(league.contracts[id], byId.get(id), league), 0);
      if (total + (ROSTER_SLOTS.length - keep.length) * floor > cap) setTag(league, teamIdx, null);
    }
  }
  return keep;
}

/**
 * Lock in the human's keepers and open the market. Keepers move to the front
 * of their position groups; everyone else goes back to the pool; contracts
 * of kept players are raised and their keep count ticks; the auction gets
 * each club's leftover cap and the draft runs worst to first. The league is
 * left in the draft phase with a new season number, exactly where the auction
 * and draft screens expect to find it.
 */
export function confirmKeepers(league, userIds, pool, byId) {
  if (league.phase !== 'offseason' || !league.offseason) throw new Error('Not in the offseason');
  const u = userTeamIndex(league);
  const v = validateKeepers(league, u, userIds, byId);
  if (!v.ok) throw new Error(v.reason);
  const keepers = { ...league.offseason.keepers, [u]: userIds.slice() };
  const table = standings(league).map((r) => r.idx);

  const contracts = {};
  const taken = {};
  const budgets = [];
  league.teams.forEach((t, i) => {
    const ids = keepers[i] || [];
    // Whoever was on the roster with years still to run and is not on the
    // keeper list has been released, and a release is a cut: the club goes on
    // paying its share. A deal that simply ran out costs nothing, which is
    // what `deadCharge` checks.
    const kept = new Set(ids);
    for (const s of ROSTER_SLOTS) {
      const id = t.slots[s.id];
      if (id && !kept.has(id)) bookDead(league, i, id, league.contracts[id]);
    }
    const byPos = {};
    for (const id of ids) (byPos[byId.get(id).pos] ??= []).push(id);
    const slots = {};
    for (const s of ROSTER_SLOTS) slots[s.id] = (byPos[s.pos] || []).shift() || null;
    t.slots = slots;
    let committed = 0;
    for (const id of ids) {
      const c = league.contracts[id] || {};
      if (league.draftType === 'auction') {
        const cost = keeperCost(c);
        committed += cost;
        contracts[id] = { salary: cost, kept: (c.kept ?? 0) + 1, since: c.since ?? league.season };
      } else if (capOn(league)) {
        // Carry the deal forward, or write a new one at market for a man whose
        // old one is up. Rebuilding this table used to drop `salary` and
        // `years` on the floor, which quietly turned every contract into a
        // minimum one — a whole league read 27 of 200 by its second season and
        // nothing ever expired, because the countdown reset every offseason
        // before it could reach zero.
        const cost = keeperCost(c, byId.get(id), league);
        committed += cost;
        contracts[id] = {
          salary: cost,
          // One year on the tag. Re-signing writes a fresh VET_YEARS deal and
          // `DEAD_SHARE` makes leaving it early expensive, which is exactly
          // what a club pays the tag premium to avoid.
          years: tagged(league)[id] != null ? 1 : (c.expiring ? termFor(league, id) : (c.years ?? VET_YEARS)),
          round: c.round ?? ROSTER_SLOTS.length,
          kept: (c.kept ?? 0) + 1,
          since: c.since ?? league.season,
        };
      } else {
        contracts[id] = { round: c.round ?? ROSTER_SLOTS.length, kept: (c.kept ?? 0) + 1, since: c.since ?? league.season };
      }
      taken[id] = i;
    }
    budgets.push((league.auction?.budget ?? DEFAULT_BUDGET) - committed);
    t.record = { w: 0, l: 0, t: 0, pf: 0, pa: 0 };
    t.seasonStats = { team: emptyTeamStats(), players: {} };
    t.depthSorted = false;
  });
  league.contracts = contracts;
  league.offseason = { ...league.offseason, step: 'market', user: userIds.slice(), keepers, budgets, fromSeason: league.season };
  league.season++;
  league.playoffs = null;
  league.champion = null;
  league.results = [];
  league.injuries = {};
  league.claims = [];
  league.lapsedClaims = [];
  league.week = 1;

  // Worst club nominates or picks first.
  const order = table.slice().reverse();
  // A capped league shops before it drafts, because that is the decision: the
  // men in free agency are the same men who will be in the draft, so paying
  // market for one now is buying certainty — and it costs a pick, since a club
  // that has no open slot left never makes one.
  if (capOn(league)) {
    league.offseason = { ...league.offseason, step: 'freeagency', order, taken, budgets };
    const rngFa = new RNG(league.rngState);
    openFreeAgency(league, pool, byId, rngFa);
    league.rngState = rngFa.state;
    return league;
  }
  return openMarket(league, order, taken, budgets);
}

/**
 * Settle free agency and hand what is left to the draft.
 *
 * Separate from `confirmKeepers` because a capped league stops in between, and
 * the draft has to be built from whoever is still unsigned rather than from
 * whoever was unsigned an hour ago.
 */
export function closeFreeAgency(league, pool, byId, rng = null) {
  if (!league.freeAgency || league.freeAgency.closed) {
    if (league.phase === 'draft') return league;
  }
  const faRng = rng || new RNG(league.rngState);
  const signed = resolveFreeAgency(league, pool, byId, faRng);
  league.rngState = faRng.state;
  const off = league.offseason || {};
  const taken = { ...(off.taken || {}) };
  for (const s of signed) taken[s.id] = s.team;
  league.offseason = { ...off, step: 'market', signed };
  return openMarket(league, off.order || league.teams.map((_, i) => i), taken, off.budgets || []);
}

/** Open whichever market this league drafts through, and hand the league over to it. */
function openMarket(league, order, taken, budgets) {
  const rng = new RNG(league.rngState);
  if (league.draftType === 'auction') {
    league.auction = createAuction(league, rng, { budget: league.auction?.budget ?? DEFAULT_BUDGET, budgets, order, taken });
    league.draft = null;
  } else {
    league.draft = createDraft(league, rng, { order, taken });
    league.auction = null;
  }
  league.rngState = rng.state;
  league.phase = 'draft';
  return league;
}

/** Skip contracts entirely: same rosters, next season. Kept for people who just want to run it back. */
export function skipOffseason(league) {
  league.offseason = null;
  league.phase = 'complete';
  return league;
}

/** Summary lines for the offseason screen: who won, where the human finished. */
export function seasonSummary(league) {
  const last = (league.history || []).find((h) => h.season === (league.offseason?.season ?? league.season)) || league.history?.[league.history.length - 1];
  if (!last) return null;
  const champ = league.teams[last.champion];
  return { season: last.season, champion: champ, user: last.user, teams: league.teams.length };
}

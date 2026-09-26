// A man off a roster for good takes no deal with him.
//
// A release left the contract behind on every path but the kickoff cut, and
// whoever claimed the man next took it over — the old salary and the old term,
// while the club that let him go went on being charged for it. Over four kinds
// of league and three seasons each, 172 of 1,342 waiver claims landed a man on
// the deal of the club that dropped him. Ending the deal where he leaves
// exposed the second half: a man with no deal was signed at the season's end
// on the draft's or the auction's terms, whichever club had drafted or bought
// him.
//
// Then what leaving costs. Only a cut and a claim's drop charged dead money;
// every other way off a roster but a trade does now. And reserve emptying at
// the season's end lets the weakest man at the position go, not the man coming
// back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers, syncContracts, newSeasonSameRosters, userTeamIndex } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { overall } from '../src/engine/ratings.js';
import { freeAgents, fileClaim, processWaivers, validateTrade, executeTrade } from '../src/engine/transactions.js';
import { placeOnIr, activateFromIr, releaseFromIr, clearIr } from '../src/engine/injuries.js';
import { promote, releaseFromSquad } from '../src/engine/squad.js';
import { deadHit, rookieSalary, draftSize, MIN_SALARY, VET_YEARS } from '../src/engine/cap.js';

registerPlayers(byId);

const ME = { name: 'Me', abbr: 'ME', color: '#fff' };

function pro(seed) {
  const lg = createLeague({ name: 'P', user: ME, seed, mode: 'pro', franchise: 1, draftType: 'snake', injuries: 'off' });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, byId);
  return lg;
}

const bestFree = (lg, pos) => freeAgents(lg, PLAYERS).filter((p) => p.pos === pos).sort((a, b) => overall(b) - overall(a))[0];
const slotOf = (team, id) => ROSTER_SLOTS.find((s) => team.slots[s.id] === id)?.id;
const other = (lg, ...not) => lg.teams.findIndex((t, i) => !t.isUser && !not.includes(i));

test('a man dropped for a claim leaves his deal behind, and the next club to claim him is on the minimum', () => {
  const lg = pro(81);
  const u = userTeamIndex(lg);
  const me = lg.teams[u];
  const gone = me.slots.WR4;
  // A real deal, so a club taking it over would show.
  lg.contracts[gone] = { ...lg.contracts[gone], salary: 12, years: 3 };
  const owed = deadHit(lg, u);
  const wr = bestFree(lg, 'WR');
  fileClaim(lg, u, wr.id, gone, byId);
  processWaivers(lg, byId);
  assert.equal(me.slots.WR4, wr.id, 'the claim did not go through');
  assert.equal(lg.contracts[gone], undefined, 'his deal stayed behind when he left');
  assert.ok(deadHit(lg, u) > owed, 'the club that let him go should still be paying for him');

  const a = other(lg);
  const theirs = lg.teams[a].slots.WR4;
  fileClaim(lg, a, gone, theirs, byId);
  processWaivers(lg, byId);
  assert.equal(lg.teams[a].slots.WR4, gone, 'the second claim did not go through');
  assert.equal(lg.contracts[gone], undefined, 'the claim took over the deal of the club that dropped him');
  // Signed at the season's end off the street.
  syncContracts(lg, byId);
  assert.equal(lg.contracts[gone].salary, MIN_SALARY);
  assert.equal(lg.contracts[gone].years, VET_YEARS);
});

test('every other way a man leaves a roster for good ends his deal, and all but a trade charge for it as a cut does', () => {
  const lg = pro(82);
  const u = userTeamIndex(lg);
  const me = lg.teams[u];
  const hurt = (id) => { lg.injuries[id] = { weeks: 6, kind: 'knee sprain', since: null, season: lg.season, team: u }; };
  // Three years left at 10: letting him go owes half of that, 5 a year.
  const onDeal = (id) => { lg.contracts[id] = { ...lg.contracts[id], salary: 10, years: 3, expiring: false }; return id; };
  const owedFor = (fn, team = u) => { const before = deadHit(lg, team); fn(); return deadHit(lg, team) - before; };

  // Released from injured reserve.
  const qb = onDeal(me.slots.QB2);
  hurt(qb);
  placeOnIr(lg, u, qb);
  assert.ok(lg.contracts[qb], 'reserve keeps him on the books');
  assert.equal(owedFor(() => releaseFromIr(lg, u, qb)), 5, 'released from reserve, he was let go for nothing');
  assert.equal(lg.contracts[qb], undefined, 'released from reserve, he kept his deal');

  // Let go to make room for a man back from it.
  const back = me.slots.RB1, makesWay = onDeal(me.slots.RB2);
  hurt(back);
  placeOnIr(lg, u, back);
  delete lg.injuries[back];
  assert.equal(owedFor(() => activateFromIr(lg, u, back, makesWay, byId)), 5, 'the man let go for him cost nothing');
  assert.ok(lg.contracts[back], 'the man activated lost his deal');
  assert.equal(lg.contracts[makesWay], undefined, 'the man let go for him kept his');

  // The practice squad, both ways out. Who may go down is squad.test.js's
  // business; these two are put there by hand, since what is asked here is
  // only what leaving it costs.
  const down = (slot) => { const id = me.slots[slot]; me.slots[slot] = null; (me.squad ??= []).push(id); return id; };
  const cut = onDeal(down('LB3'));
  assert.equal(owedFor(() => releaseFromSquad(lg, u, cut)), 5, 'released from the squad, he cost nothing');
  assert.equal(lg.contracts[cut], undefined, 'released from the squad, he kept his deal');
  const up = down('DL4');
  const dropped = onDeal(me.slots.DL3);
  assert.equal(owedFor(() => promote(lg, u, up, dropped, byId)), 5, 'the man let go for a promotion cost nothing');
  assert.ok(lg.contracts[up], 'the man brought up lost his deal');
  assert.equal(lg.contracts[dropped], undefined, 'the man let go for him kept his');

  // The spare man an uneven trade lets go: a receiver and a back for a
  // receiver leaves the club taking them a back too many.
  const x = other(lg), y = other(lg, x);
  const X = lg.teams[x], Y = lg.teams[y];
  const deal = [[X.slots.WR1, X.slots.RB1], [Y.slots.WR1]];
  const v = validateTrade(lg, x, y, ...deal, byId, PLAYERS);
  assert.ok(v.ok && v.uneven, v.reason);
  const spare = v.fills.b.releases;
  assert.equal(spare.length, 1);
  onDeal(spare[0]);
  // No charge: the AI weighs a trade on the lineup and never on money, so a
  // bill here would land on its clubs unseen.
  assert.equal(owedFor(() => executeTrade(lg, x, y, ...deal, byId, PLAYERS), y), 0);
  assert.equal(slotOf(Y, spare[0]), undefined);
  assert.equal(lg.contracts[spare[0]], undefined, 'the man a trade let go kept his deal');
  // The men traded keep theirs: a trade moves the deal with the man.
  for (const id of deal.flat()) assert.ok(lg.contracts[id], `${id} lost his deal in a trade`);
});

/** A drafted man moved to a club with no deal, as a claim or a fill leaves him. */
function arrived(lg, pick, to) {
  const from = lg.teams[pick.team];
  const id = pick.playerId;
  const pos = byId.get(id).pos;
  from.slots[slotOf(from, id)] = null;
  delete lg.contracts[id];
  const team = lg.teams[to];
  const slot = [...ROSTER_SLOTS].reverse().find((s) => s.pos === pos && team.slots[s.id] !== id);
  if (team.slots[slot.id]) delete lg.contracts[team.slots[slot.id]];
  team.slots[slot.id] = id;
  return id;
}

test('a man who joins a club during the season is signed at its end off the street, whoever drafted him', () => {
  const lg = pro(83);
  // Early picks, whose rookie deals are well above the minimum. The kickoff
  // after the draft signs them on the pick's terms, and still does.
  const [p1, p2] = lg.draft.picks.filter((p) => p.overall <= 40).slice(0, 2);
  for (const p of [p1, p2]) assert.equal(lg.contracts[p.playerId].salary, rookieSalary(p.overall, draftSize(lg)));
  assert.ok(rookieSalary(p1.overall, draftSize(lg)) > MIN_SALARY);
  // One claimed by another club; one let go and claimed back by the club that
  // drafted him, which is not the draft signing him either.
  const a = arrived(lg, p1, other(lg, p1.team));
  const b = arrived(lg, p2, p2.team);
  syncContracts(lg, byId);
  for (const id of [a, b]) {
    assert.equal(lg.contracts[id].salary, MIN_SALARY, `${id} was signed on the draft's terms`);
    assert.equal(lg.contracts[id].years, VET_YEARS);
    assert.equal(lg.contracts[id].round, ROSTER_SLOTS.length);
  }
});

test('a season run back on the same rosters signs nobody on the last draft\'s terms', () => {
  const lg = pro(84);
  const [p1] = lg.draft.picks.filter((p) => p.overall <= 40);
  const id = arrived(lg, p1, other(lg, p1.team));
  newSeasonSameRosters(lg, byId);
  assert.equal(lg.season, 2);
  assert.equal(lg.contracts[id].salary, MIN_SALARY, 'run back, he was signed on the draft\'s terms');
});

test('in a fantasy auction a claimed man is on $1, not the price his old club paid', () => {
  const lg = createLeague({ name: 'F', user: ME, numTeams: 8, seed: 85, draftType: 'auction', injuries: 'off' });
  autoCompleteAll(lg.auction, lg, PLAYERS, new RNG(85), byId);
  startSeason(lg, byId);
  const u = userTeamIndex(lg);
  const me = lg.teams[u];
  const slot = ['WR4', 'WR3', 'WR2', 'WR1'].find((s) => lg.contracts[me.slots[s]].salary > 1);
  const gone = me.slots[slot];
  const paid = lg.contracts[gone].salary;
  fileClaim(lg, u, bestFree(lg, 'WR').id, gone, byId);
  processWaivers(lg, byId);
  assert.equal(lg.contracts[gone], undefined, `dropped, he kept the $${paid} deal`);
  const a = other(lg);
  fileClaim(lg, a, gone, lg.teams[a].slots.WR4, byId);
  processWaivers(lg, byId);
  assert.equal(lg.teams[a].slots.WR4, gone, 'the claim did not go through');
  syncContracts(lg, byId);
  assert.equal(lg.contracts[gone].salary, 1, `claimed, he is kept at the $${paid} his old club paid`);
});

test('when reserve empties at the season\'s end, the weakest man at the position goes, and is charged as a cut', () => {
  const lg = pro(87);
  const u = userTeamIndex(lg);
  const me = lg.teams[u];
  const hurt = (id) => { lg.injuries[id] = { weeks: 20, kind: 'torn ACL', since: null, season: lg.season, team: u }; };
  const onRoster = (id) => Object.values(me.slots).includes(id);
  const free = (pos) => freeAgents(lg, PLAYERS).filter((p) => p.pos === pos).sort((a, b) => overall(a) - overall(b));

  // The starting quarterback hurt and parked, and the worst quarterback on the
  // market put in his slot to cover, as a claim would.
  const star = me.slots.QB1, backup = me.slots.QB2;
  hurt(star);
  placeOnIr(lg, u, star);
  const cover = free('QB')[0];
  me.slots.QB1 = cover.id;

  // The fourth receiver hurt and parked, and covered by a better one from
  // another club, as a trade would bring him: the man on reserve is now the
  // weakest in his room, so he is the one who goes — and he still had three
  // years at 10 to run.
  const weak = me.slots.WR4;
  lg.contracts[weak] = { ...lg.contracts[weak], salary: 10, years: 3, expiring: false };
  hurt(weak);
  placeOnIr(lg, u, weak);
  const donor = lg.teams.find((t) => !t.isUser && overall(byId.get(t.slots.WR1)) > overall(byId.get(weak)));
  const better = byId.get(donor.slots.WR1);
  donor.slots.WR1 = null;
  me.slots.WR4 = better.id;

  const owed = deadHit(lg, u);
  const mine = clearIr(lg, byId).filter((r) => r.team === u);
  const released = mine.map((r) => r.id);
  assert.ok(onRoster(star), 'the starter parked on reserve was let go and his cover kept');
  assert.ok(onRoster(backup));
  assert.ok(!onRoster(cover.id) && released.includes(cover.id), 'the weakest quarterback stayed');
  assert.ok(!onRoster(weak) && released.includes(weak), 'the weakest man in his room was the one on reserve, and he stayed');
  // Said as it happened: who went, and who came back in his place.
  assert.equal(mine.find((r) => r.id === cover.id).back, star);
  assert.equal(mine.find((r) => r.id === weak).back, null);
  assert.ok(onRoster(better.id));
  assert.equal(deadHit(lg, u) - owed, 5, 'let go from reserve, he was written off for nothing');
  assert.equal(lg.contracts[weak], undefined);
});

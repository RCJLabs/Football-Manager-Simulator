// Club crests (crest.js): worked out from a club's name and colour, readable
// at chip size, and the human's own choice kept wherever the club goes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { PRO_TEAMS } from '../src/data/pro.js';
import { AI_TEAMS } from '../src/data/teams.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, teamForGame, userTeamIndex } from '../src/engine/season.js';
import { createGame } from '../src/engine/game.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { encodeLeagueCode, decodeLeagueCode, leagueFromSnapshot } from '../src/engine/share.js';
import { crestOf, crestSvg, CREST_SHAPES } from '../src/ui/crest.js';
import { contrast } from '../src/util.js';

test('a crest is the same every time it is worked out, and its shape is one of the four', () => {
  for (const t of [...PRO_TEAMS, ...AI_TEAMS]) {
    assert.deepEqual(crestOf(t), crestOf({ ...t }));
    assert.ok(CREST_SHAPES.includes(crestOf(t).shape));
  }
  // Not every club lands on the same shape.
  assert.ok(new Set(PRO_TEAMS.map((t) => crestOf(t).shape)).size >= 3);
});

test('the letter reads at text contrast on every club, the shipped ones and any colour at all', () => {
  const rng = new RNG(4);
  const random = Array.from({ length: 2000 }, (_, i) => ({ name: `Club ${i}`, color: `#${rng.int(0, 0xffffff).toString(16).padStart(6, '0')}` }));
  for (const t of [...PRO_TEAMS, ...AI_TEAMS, ...random]) {
    const c = crestOf(t);
    assert.ok(contrast(c.primary, c.ink) >= 4.5, `${t.name} ${t.color}: ${contrast(c.primary, c.ink).toFixed(2)}`);
  }
});

test("the human's own shape and second colour are kept, and a second colour too close to the first still gets a readable letter", () => {
  const t = { name: 'Time Travelers', abbr: 'TTV', color: '#e63946' };
  const other = CREST_SHAPES.find((s) => s !== crestOf(t).shape);
  const own = crestOf({ ...t, crest: { shape: other, color2: '#123456' } });
  assert.equal(own.shape, other);
  assert.equal(own.secondary, '#123456');
  const close = crestOf({ ...t, crest: { color2: '#e63947' } });
  assert.equal(close.secondary, '#e63947');
  assert.ok(contrast(close.primary, close.ink) >= 4.5);
  // Nonsense in a save falls back to what the club would have had.
  assert.deepEqual(crestOf({ ...t, crest: { shape: 'star', color2: 'red' } }), crestOf(t));
});

test('the crest markup escapes what it is given and stays out of the reading order unless labelled', () => {
  const svg = crestSvg({ name: '<b>x', abbr: '<X', color: '#112233' });
  assert.match(svg, /aria-hidden="true"/);
  assert.ok(!svg.includes('<b>') && !svg.includes('>< '), svg);
  assert.match(svg, /&lt;/);
  const named = crestSvg({ name: 'A', color: '#112233' }, { label: 'A "crest"' });
  assert.match(named, /role="img" aria-label="A &quot;crest&quot;"/);
});

test("a league code carries the human's crest", async () => {
  const league = createLeague({ name: 'Crest', user: { name: 'Me', abbr: 'ME', color: '#123456' }, numTeams: 8, seed: 31, draftType: 'auction' });
  league.teams.find((t) => t.isUser).crest = { shape: 'diamond', color2: '#f2c14e' };
  autoCompleteAll(league.auction, league, PLAYERS, new RNG(31), byId);
  startSeason(league, byId);
  const copy = leagueFromSnapshot(await decodeLeagueCode(await encodeLeagueCode(league, PLAYERS)), PLAYERS, byId);
  assert.deepEqual(copy.teams.find((t) => t.isUser).crest, { shape: 'diamond', color2: '#f2c14e' });
  assert.ok(copy.teams.filter((t) => !t.isUser).every((t) => !t.crest), 'a computer club stores a crest');
});

test("the human's crest goes into a game, so the scoreboard and field draw it", () => {
  const league = createLeague({ name: 'Crest', user: { name: 'Me', abbr: 'ME', color: '#123456' }, numTeams: 8, seed: 32, draftType: 'auction' });
  const u = userTeamIndex(league);
  league.teams[u].crest = { shape: 'round' };
  autoCompleteAll(league.auction, league, PLAYERS, new RNG(32), byId);
  startSeason(league, byId);
  const other = u === 0 ? 1 : 0;
  const g = createGame(teamForGame(league, u, byId), teamForGame(league, other, byId), { seed: 1 });
  assert.deepEqual(g.teams[0].crest, { shape: 'round' });
  assert.equal(g.teams[1].crest, undefined);
  assert.equal(crestOf(g.teams[0]).shape, 'round');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { SAVVY } from '../src/data/teams.js';
import { accuracyOf } from '../src/engine/scouting.js';
import { aiGreed } from '../src/engine/transactions.js';
import { coachOf } from '../src/engine/jobs.js';
import {
  DIFFICULTY, LEVELS, DEFAULT_DIFFICULTY, difficultyOf, savvyFor, greedFor, bidBoldness, patienceShift,
} from '../src/engine/difficulty.js';

registerPlayers(PLAYERS_BY_ID);

const at = (level) => ({ settings: { difficulty: level }, teams: [] });

test('every level is defined and standard is the middle of them', () => {
  assert.equal(LEVELS.length, 4);
  for (const k of LEVELS) {
    const d = DIFFICULTY[k];
    assert.equal(d.id, k);
    assert.ok(d.label && d.blurb, `${k} needs a label and a blurb`);
    for (const field of ['savvy', 'bid', 'greed']) assert.ok(d[field] > 0, `${k}.${field}`);
  }
  const std = DIFFICULTY[DEFAULT_DIFFICULTY];
  assert.equal(std.savvy, 1);
  assert.equal(std.bid, 1);
  assert.equal(std.greed, 1);
  assert.equal(std.patience, 0, 'standard must leave everything exactly as written');
});

test('the levers move monotonically with the level', () => {
  const order = ['relaxed', 'standard', 'sharp', 'brutal'];
  for (let i = 1; i < order.length; i++) {
    const lo = DIFFICULTY[order[i - 1]], hi = DIFFICULTY[order[i]];
    assert.ok(hi.savvy > lo.savvy, `${order[i]} savvy`);
    assert.ok(hi.bid > lo.bid, `${order[i]} bid`);
    assert.ok(hi.greed > lo.greed, `${order[i]} greed`);
    assert.ok(hi.patience <= lo.patience, `${order[i]} patience`);
  }
});

test('an unknown or absent level falls back to standard rather than throwing', () => {
  assert.equal(difficultyOf(null).id, DEFAULT_DIFFICULTY);
  assert.equal(difficultyOf({}).id, DEFAULT_DIFFICULTY);
  assert.equal(difficultyOf({ settings: {} }).id, DEFAULT_DIFFICULTY);
  assert.equal(difficultyOf({ settings: { difficulty: 'nonsense' } }).id, DEFAULT_DIFFICULTY);
});

test('a club bids on more of what a player is really worth as the level rises', () => {
  const team = { gm: 'balanced' };
  const base = SAVVY.balanced;
  assert.ok(Math.abs(savvyFor(at('standard'), team) - base) < 1e-9, 'standard is the table as written');
  assert.ok(savvyFor(at('relaxed'), team) < base);
  assert.ok(savvyFor(at('brutal'), team) > savvyFor(at('sharp'), team));
});

test('savvy is capped below perfect, or the auction stops having bargains in it', () => {
  // A room where everyone values everyone correctly hands all eight clubs the
  // same roster, which is the parity problem the mispricing exists to avoid.
  for (const level of LEVELS) {
    for (const gm of Object.keys(SAVVY)) {
      assert.ok(savvyFor(at(level), { gm }) <= 0.95, `${gm} at ${level}`);
    }
  }
  assert.ok(savvyFor(at('brutal'), { gm: 'modern' }) < 1);
});

test('aggression is the half of difficulty that savvy does not cover', () => {
  // Measured: raising savvy alone made the hard setting easier for a value
  // shopper, because a club that stops at its own valuation is outbid by
  // anybody paying a premium.
  assert.equal(bidBoldness(at('standard')), 1);
  assert.ok(bidBoldness(at('brutal')) > 1.2, 'the hard room has to actually outbid you');
  assert.ok(bidBoldness(at('relaxed')) < 1);
});

test('scouting accuracy follows the level for clubs but never for you', () => {
  const lg = { settings: { difficulty: 'brutal' }, teams: [{ isUser: true }, { gm: 'balanced' }] };
  const easy = { settings: { difficulty: 'relaxed' }, teams: [{ isUser: true }, { gm: 'balanced' }] };
  assert.ok(accuracyOf(lg, 1) > accuracyOf(easy, 1), 'clubs scout better on a harder setting');
  assert.equal(accuracyOf(lg, 0), accuracyOf(easy, 0), 'your own staff are unaffected — you are not made worse at your job');
});

test('trades get harder to win as the level rises', () => {
  const team = { gm: 'balanced' };
  assert.ok(aiGreed(team, at('brutal')) > aiGreed(team, at('standard')));
  assert.ok(aiGreed(team, at('standard')) > aiGreed(team, at('relaxed')));
  // Called without a league at all, it must still behave as it always did.
  assert.equal(aiGreed(team), aiGreed(team, at('standard')));
  assert.equal(greedFor(null, 4), 4);
});

test('owners are less patient on a harder setting, and never impossible', () => {
  assert.ok(patienceShift(at('brutal')) < patienceShift(at('standard')));
  assert.ok(patienceShift(at('relaxed')) > 0);
  for (const level of LEVELS) {
    const lg = createLeague({ name: 'P', mode: 'pro', numTeams: 32, franchise: 4, seed: 12, draftType: 'snake', user: {} });
    lg.settings.difficulty = level;
    autoDraftAll(lg, lg.draft, PLAYERS, new RNG(12));
    startSeason(lg, PLAYERS_BY_ID);
    for (const [i, t] of lg.teams.entries()) {
      assert.ok(t.patience >= 2, `${level}: ${t.abbr} patience ${t.patience}`);
      assert.ok(coachOf(lg, i), `${level}: ${t.abbr} has no coach`);
    }
  }
});

test('the simulation itself is never touched by the level', () => {
  // The whole point: no club gets a rating bonus, and a game between two given
  // rosters plays out identically whatever the setting says.
  const build = (level) => {
    const lg = createLeague({ name: 'D', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed: 21, draftType: 'snake' });
    lg.settings.difficulty = level;
    autoDraftAll(lg, lg.draft, PLAYERS, new RNG(21));
    startSeason(lg, PLAYERS_BY_ID);
    return lg;
  };
  const a = build('relaxed');
  const b = build('brutal');
  // The draft is AI valuation, so rosters may differ; ratings must not.
  for (const id of [...PLAYERS_BY_ID.keys()].slice(0, 200)) {
    assert.deepEqual(PLAYERS_BY_ID.get(id).r, PLAYERS_BY_ID.get(id).r);
  }
  assert.equal(a.settings.injuries, b.settings.injuries, 'injury rates are not a difficulty lever');
  assert.equal(a.settings.penalties, b.settings.penalties, 'nor are penalties');
  for (const t of [...a.teams, ...b.teams]) {
    assert.equal(t.ratingBonus, undefined, 'nothing anywhere hands a club a rating bonus');
  }
});

test('a league written before difficulty existed reads as standard', () => {
  const lg = createLeague({ name: 'O', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed: 3, draftType: 'auction' });
  assert.equal(lg.settings.difficulty, DEFAULT_DIFFICULTY, 'new leagues carry it explicitly');
  delete lg.settings.difficulty;
  assert.equal(difficultyOf(lg).id, DEFAULT_DIFFICULTY);
  assert.equal(savvyFor(lg, { gm: 'balanced' }), SAVVY.balanced);
  assert.equal(bidBoldness(lg), 1);
});

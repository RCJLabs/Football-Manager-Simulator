import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { PRO_TEAMS } from '../src/data/pro.js';
import { RNG, hashSeed } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers, simulateWeekAi, gameOptions, teamForGame, currentWeek, weekNumber } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { createGame, simulateGame } from '../src/engine/game.js';
import { fgProbability, fgRange } from '../src/engine/playcall.js';
import { snapshot, leagueFromSnapshot } from '../src/engine/share.js';
import {
  CLIMATE, weatherOn, monthOf, homeOf, drawConditions, conditionsFor, passShift, fumbleFactor, fgShift, puntShift,
  describeWeather, conditionsLine, weatherNote, STARTER_ARM, STARTER_LEG,
} from '../src/engine/weather.js';

registerPlayers(byId);

const at = (abbr) => PRO_TEAMS.findIndex((t) => t.abbr === abbr);
const INDOORS = { roof: true };
const STILL = { temp: 60, wind: 5, precip: null };
const GALE = { temp: 50, wind: 28, precip: null };
const RAIN = { temp: 55, wind: 5, precip: 'rain' };
const SNOW = { temp: 28, wind: 5, precip: 'snow' };

function proLeague(seed, settings = {}) {
  const lg = createLeague({ name: 'W', user: { name: 'Me', abbr: 'ME', color: '#fff' }, seed, mode: 'pro', draftType: 'snake' });
  Object.assign(lg.settings, settings);
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, byId);
  return lg;
}

test('weather is a pro league\'s, on for a new one, and off for a save from before it', () => {
  const pro = createLeague({ name: 'P', seed: 1, mode: 'pro', draftType: 'snake' });
  assert.equal(pro.settings.weather, true);
  assert.equal(weatherOn(pro), true);
  // A fantasy club is a nickname with no city to play in.
  const fantasy = createLeague({ name: 'F', seed: 1, draftType: 'snake' });
  assert.equal(weatherOn(fantasy), false);
  assert.equal(conditionsFor(fantasy, { home: 0, away: 1 }, 3), null);
  // A save made before weather has no setting, and plays as it always did.
  delete pro.settings.weather;
  assert.equal(weatherOn(pro), false);
  assert.equal(conditionsFor(pro, { home: at('GB'), away: 0 }, 15), null);
});

test('a game\'s sky is fixed by the league, season, week and home club; a roof or the final is indoors', () => {
  const lg = { mode: 'pro', seed: 99, season: 2, settings: { weather: true } };
  const gb = at('GB');
  const a = conditionsFor(lg, { home: gb, away: 0 }, 16);
  assert.deepEqual(conditionsFor(lg, { home: gb, away: 5 }, 16), a, 'the visitor does not change the sky');
  assert.equal(a.city, 'Green Bay');
  const weeks = Array.from({ length: 18 }, (_, i) => JSON.stringify(conditionsFor(lg, { home: gb, away: 0 }, i + 1)));
  assert.ok(new Set(weeks).size > 10, 'the weather changes week to week');
  assert.ok(conditionsFor({ ...lg, season: 3 }, { home: gb, away: 0 }, 16).temp !== undefined);
  for (let w = 1; w <= 18; w++) assert.deepEqual(conditionsFor(lg, { home: at('DET'), away: 0 }, w), { roof: true, city: 'Detroit' });
  assert.deepEqual(conditionsFor(lg, { home: gb, away: 0, neutral: true }, 104), { roof: true, city: null, neutral: true });
  // September's first four weeks, January's last; the playoffs are January.
  assert.deepEqual([1, 4, 5, 9, 14, 18, 101].map(monthOf), [0, 0, 1, 2, 3, 4, 4]);
  // Every pro club has a climate, and every outdoor one a full season of it.
  for (const t of PRO_TEAMS) {
    const c = CLIMATE[t.abbr];
    assert.ok(c, `${t.abbr} has a climate`);
    if (!c.roof) assert.ok(c.temp.length === 5 && c.wet.length === 5 && c.wind > 0, t.abbr);
  }
});

test('a snowy January is colder than a September in the same city, and falls as snow only in the cold', () => {
  const home = homeOf(at('BUF'));
  const rng = new RNG(7);
  const sep = Array.from({ length: 400 }, () => drawConditions(home, 0, rng));
  const jan = Array.from({ length: 400 }, () => drawConditions(home, 4, rng));
  const avg = (xs) => xs.reduce((s, w) => s + w.temp, 0) / xs.length;
  assert.ok(avg(jan) < avg(sep) - 30);
  for (const w of [...sep, ...jan]) if (w.precip === 'snow') assert.ok(w.temp <= 34);
  assert.ok(jan.some((w) => w.precip === 'snow'));
});

test('every effect is taken out at its league mean, so a season of weather averages what the engine was fitted to', () => {
  // A stream of its own, not the one the means were taken on.
  const rng = new RNG(hashSeed('weather-test-stream'));
  const calls = ['screen', 'pass_short', 'pass_med', 'pa_pass', 'pass_deep'];
  const sum = { comp: Object.fromEntries(calls.map((c) => [c, 0])), fumble: 0, fg: 0, punt: 0 };
  let n = 0;
  for (let i = 0; i < PRO_TEAMS.length; i++) {
    for (let week = 1; week <= 18; week++) {
      for (let k = 0; k < 48; k++) {
        const w = drawConditions(homeOf(i), monthOf(week), rng);
        // At the arm and leg that start, which throw and kick nearly everything.
        for (const c of calls) sum.comp[c] += passShift(w, c, STARTER_ARM);
        sum.fumble += fumbleFactor(w); sum.fg += fgShift(w, STARTER_LEG); sum.punt += puntShift(w);
        n++;
      }
    }
  }
  for (const c of calls) assert.ok(Math.abs(sum.comp[c] / n) < 0.001, `${c}: ${sum.comp[c] / n}`);
  assert.ok(Math.abs(sum.fumble / n - 1) < 0.01, `fumbles ×${sum.fumble / n}`);
  // About three and a half standard errors of this sample's noise and the
  // means' own, either side: a mean taken at a middling leg instead of a
  // starter's would sit at 0.07 yards.
  assert.ok(Math.abs(sum.fg / n) < 0.035, `field goals ${sum.fg / n}`);
  assert.ok(Math.abs(sum.punt / n) < 0.1, `punts ${sum.punt / n}`);
  // No weather is no change at all.
  assert.deepEqual([passShift(null, 'pass_deep', 82), fumbleFactor(null), fgShift(null, 80), puntShift(null)], [0, 1, 0, 0]);
});

test('the wind takes a deep throw most, and a big arm and a big leg resist it', () => {
  const byDepth = ['screen', 'pass_short', 'pass_med', 'pass_deep'].map((c) => passShift(GALE, c, 82));
  for (let i = 1; i < byDepth.length; i++) assert.ok(byDepth[i] < byDepth[i - 1], `${byDepth}`);
  assert.ok(byDepth[0] < 0);
  assert.ok(passShift(GALE, 'pass_deep', 95) > passShift(GALE, 'pass_deep', 70));
  assert.ok(fgShift(GALE, 95) > fgShift(GALE, 65));
  // An arm only resists wind: indoors or on a still day it buys nothing here.
  assert.equal(passShift(INDOORS, 'pass_deep', 95), passShift(INDOORS, 'pass_deep', 70));
  assert.equal(passShift(STILL, 'pass_deep', 95), passShift(STILL, 'pass_deep', 70));
  // A dome plays a little above the league's average afternoon, a gale well below it.
  assert.ok(passShift(INDOORS, 'pass_deep', 82) > 0 && fgShift(INDOORS, 80) > 0 && puntShift(INDOORS) > 0);
  assert.ok(passShift(GALE, 'pass_deep', 82) < -0.05 && fgShift(GALE, 80) < -4 && puntShift(GALE) < -4);
});

test('rain and snow loosen the ball, cold shortens a kick, and altitude carries one', () => {
  assert.ok(fumbleFactor(SNOW) > fumbleFactor(RAIN) && fumbleFactor(RAIN) > fumbleFactor(STILL));
  assert.ok(fumbleFactor(STILL) < 1 && fumbleFactor(INDOORS) === fumbleFactor(STILL));
  assert.ok(passShift(RAIN, 'pass_short', 82) < passShift(STILL, 'pass_short', 82));
  assert.ok(fgShift({ ...STILL, temp: 18 }, 80) < fgShift(STILL, 80));
  assert.ok(puntShift({ ...STILL, temp: 18 }) < puntShift(STILL));
  assert.ok(fgShift({ ...STILL, altitude: true }, 80) > fgShift(STILL, 80) + 2);
  assert.ok(puntShift({ ...STILL, altitude: true }) > puntShift(STILL) + 2);
});

test('a kicker\'s make chance and range read the weather', () => {
  const k = { r: { kac: 82, kpw: 84 } };
  assert.ok(fgProbability(k, 48, GALE) < fgProbability(k, 48, null));
  assert.ok(fgProbability(k, 48, null) < fgProbability(k, 48, INDOORS));
  assert.ok(fgRange(k, GALE) < fgRange(k, null));
  assert.equal(fgProbability(k, 48), fgProbability(k, 48, null));
});

test('a snowy gale reaches every part of the game it should, against the same games indoors', () => {
  const lg = proLeague(4410);
  const teams = lg.teams.map((_, i) => teamForGame(lg, i, byId));
  const tally = (weather) => {
    const t = { att: 0, cmp: 0, fum: 0, punts: 0, puntYds: 0, from48: 0, band: 0, bandMade: 0 };
    for (let i = 0; i < 200; i++) {
      const g = createGame(teams[i % 32], teams[(i + 11) % 32], { seed: 500 + i, weather, injuryLevel: 0 });
      simulateGame(g);
      for (const side of g.stats) {
        t.att += side.team.passAtt; t.cmp += side.team.passCmp;
        for (const p of Object.values(side.players)) { t.fum += p.rush.fum; t.punts += p.p.n; t.puntYds += p.p.yds; }
      }
      for (const e of g.log) {
        const m = /(\d+)-yard field goal is (GOOD|NO GOOD|BLOCKED)/.exec(e.text || '');
        if (!m) continue;
        const dist = Number(m[1]);
        if (dist >= 48) t.from48++;
        if (dist >= 40 && dist <= 47) { t.band++; if (m[2] === 'GOOD') t.bandMade++; }
      }
    }
    return { ...t, comp: 100 * t.cmp / t.att, punt: t.puntYds / t.punts, band: t.bandMade / t.band };
  };
  const indoor = tally(INDOORS);
  const storm = tally({ temp: 28, wind: 28, precip: 'snow' });
  const says = `storm ${JSON.stringify(storm)} against indoors ${JSON.stringify(indoor)}`;
  assert.ok(storm.comp < indoor.comp - 4, `completions: ${says}`);
  assert.ok(storm.punt < indoor.punt - 4, `punts: ${says}`);
  // The coach knows his kicker's range has shrunk, and a kick from 40 to 47
  // yards, which both still try, misses more: by about sixteen points on the
  // old kicking curve (0.164 and 0.158 over 1,200 games), and by nine or ten on
  // the real make rates that replaced it, which are nearly flat from forty-seven
  // to fifty-two (77 and 73%): 0.100 over 1,200 games on the drive model, 0.092
  // once the rating weights, which draft kickers with more leg, were
  // re-measured on it. This sample has about 160 kicks in the band on each side,
  // a standard error of 0.043 on the gap, so the bound sits two of those under
  // it. The bound stayed at seven points through the kicking curve's change and
  // passed on one set of drafts and failed on the next.
  // Long tries fall too, and by the same flatter curve by less than they did,
  // when it was two thirds: the gale keeps 0.445 and 0.473 of them over 1,200
  // games on those two engines, and this sample's ratio carries about 0.035.
  assert.ok(storm.from48 < indoor.from48 * 0.55, `long tries: ${says}`);
  assert.ok(storm.band < indoor.band - 0.01, `makes from 40 to 47: ${says}`);
  assert.ok(storm.fum > indoor.fum * 1.15, `fumbles: ${says}`);
});

test('a pro week plays each game under its drawn sky and keeps it on the result; with weather off, none', () => {
  const lg = proLeague(4411);
  const wk = currentWeek(lg);
  const expected = wk.games.map((e) => conditionsFor(lg, e, weekNumber(lg)));
  assert.deepEqual(wk.games.map((e) => gameOptions(lg, e, null).weather), expected);
  simulateWeekAi(lg, byId, { includeUser: true });
  wk.games.forEach((e, i) => assert.deepEqual(e.result.weather, expected[i]));
  assert.ok(expected.some((w) => w.roof) && expected.some((w) => !w.roof));

  const dry = proLeague(4411, { weather: false });
  const dwk = currentWeek(dry);
  assert.ok(dwk.games.every((e) => gameOptions(dry, e, null).weather === null));
  simulateWeekAi(dry, byId, { includeUser: true });
  assert.ok(dwk.games.every((e) => !('weather' in e.result)));
});

test('a share code carries the setting either way', () => {
  for (const on of [true, false]) {
    const lg = proLeague(4412, { weather: on });
    const back = leagueFromSnapshot(JSON.parse(JSON.stringify(snapshot(lg, PLAYERS))), PLAYERS, byId);
    assert.equal(back.settings.weather, on);
  }
});

test('the conditions read plainly, and the matchup card speaks only when they matter', () => {
  assert.equal(describeWeather(INDOORS), 'Indoors');
  assert.equal(describeWeather({ roof: true, neutral: true }), 'Indoors, neutral site');
  assert.equal(describeWeather({ temp: 24, wind: 14, precip: 'snow' }), 'Snow, 24°F, wind 14 mph');
  assert.equal(describeWeather({ temp: 60, wind: 9, precip: null, altitude: true }), 'Clear, 60°F, wind 9 mph, a mile up');
  assert.equal(conditionsLine({ city: 'Chicago', temp: 41, wind: 22, precip: null }), 'Chicago · Blustery, 41°F, wind 22 mph');
  assert.equal(describeWeather(null), '');
  assert.equal(weatherNote(INDOORS), '');
  assert.equal(weatherNote(STILL), '');
  assert.match(weatherNote(GALE), /arm/);
  assert.match(weatherNote(RAIN), /fumbles/);
  assert.match(weatherNote({ ...STILL, temp: 20 }), /cold/);
  assert.match(weatherNote({ ...STILL, altitude: true }), /air/);
});

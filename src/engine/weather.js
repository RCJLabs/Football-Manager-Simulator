// Weather: what the sky does to a game, for a league that has somewhere to
// play.
//
// **Not penalties on top of the engine, a spread around it.** The engine was
// calibrated against real league averages (scripts/realism.mjs), and the real
// league plays in real weather, so the game as it stood already played
// average conditions. Weather that only took things away would have dragged
// every documented average below the league it was fitted to. So each effect
// here has its league-wide mean taken out: a dome or a still afternoon plays a
// little above the old engine, a gale or a blizzard below it, and a season of
// them averages what a season did before. `npm run weather` checks that.
//
// **Pro leagues only**, where clubs have a city (data/pro.js). A fantasy club
// is a nickname with no home, so weather there would be weather for its own
// sake. Covered stadiums play indoors; the final is at a neutral dome.
//
// **The climate is rounded**, a month of each city's typical afternoon — from
// general knowledge of climate normals, not from weather records — and a
// game's conditions are drawn around it, seeded by league, season, week and
// home club, so a replay sees the same sky.
//
// **What it touches, and what resists it.** Wind costs completions, deep ones
// most, and field-goal range and punt distance; cold costs kicking range and a
// little accuracy; rain and snow cost ball security and a little accuracy;
// Denver's altitude carries a kick. Arm strength resists the wind on a throw
// and leg strength on a kick, which is the one decision weather adds: a club
// that plays eight games a year by Lake Michigan has a reason to want a big
// arm and a big leg that a dome club does not.
//
// Every number here is chosen, not measured — the real-world direction of each
// effect is well established and its size here is set to be plausible and
// modest. What is measured is what they add up to.

import { PRO_TEAMS } from '../data/pro.js';
import { RNG, hashSeed } from './rng.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * A club's home: `roof` if it plays under one, else its typical afternoon by
 * month (September to January, °F), mean wind (mph), chance of rain or snow
 * during a game by month, and altitude where it matters. Keyed by the
 * franchise's own abbreviation in data/pro.js, which a renamed user club keeps
 * by position.
 */
export const CLIMATE = {
  NE: { temp: [72, 61, 50, 39, 34], wind: 11, wet: [0.14, 0.15, 0.17, 0.17, 0.17] },
  BUF: { temp: [70, 58, 47, 35, 30], wind: 12, wet: [0.15, 0.17, 0.2, 0.25, 0.25] },
  MIA: { temp: [89, 86, 81, 77, 76], wind: 9, wet: [0.25, 0.18, 0.1, 0.08, 0.08] },
  NYS: { temp: [76, 65, 54, 43, 38], wind: 11, wet: [0.13, 0.13, 0.14, 0.15, 0.14] },
  PIT: { temp: [75, 63, 51, 40, 35], wind: 9, wet: [0.14, 0.14, 0.17, 0.2, 0.2] },
  BAL: { temp: [79, 68, 57, 46, 42], wind: 9, wet: [0.13, 0.13, 0.14, 0.15, 0.14] },
  CLE: { temp: [73, 61, 49, 38, 33], wind: 11, wet: [0.14, 0.15, 0.2, 0.25, 0.25] },
  CIN: { temp: [78, 66, 53, 42, 38], wind: 8, wet: [0.12, 0.13, 0.15, 0.18, 0.18] },
  HOU: { roof: true },
  IND: { roof: true },
  JAX: { temp: [88, 82, 75, 67, 66], wind: 8, wet: [0.2, 0.12, 0.08, 0.1, 0.1] },
  NSH: { temp: [84, 73, 61, 51, 48], wind: 7, wet: [0.12, 0.12, 0.14, 0.16, 0.16] },
  KC: { temp: [79, 67, 53, 40, 37], wind: 11, wet: [0.12, 0.12, 0.1, 0.1, 0.08] },
  DEN: { temp: [78, 65, 52, 44, 44], wind: 9, wet: [0.08, 0.08, 0.08, 0.08, 0.08], altitude: true },
  LV: { roof: true },
  LAS: { roof: true },
  DAL: { roof: true },
  PHI: { temp: [78, 67, 56, 45, 41], wind: 10, wet: [0.13, 0.13, 0.14, 0.15, 0.14] },
  WAS: { temp: [80, 69, 58, 47, 43], wind: 9, wet: [0.13, 0.13, 0.13, 0.14, 0.14] },
  NYG: { temp: [76, 65, 54, 43, 38], wind: 11, wet: [0.13, 0.13, 0.14, 0.15, 0.14] },
  GB: { temp: [70, 57, 43, 29, 24], wind: 11, wet: [0.14, 0.15, 0.15, 0.18, 0.15] },
  CHI: { temp: [75, 62, 48, 35, 31], wind: 12, wet: [0.13, 0.14, 0.15, 0.17, 0.16] },
  DET: { roof: true },
  MIN: { roof: true },
  NO: { roof: true },
  ATL: { roof: true },
  CAR: { temp: [83, 73, 63, 53, 51], wind: 7, wet: [0.12, 0.1, 0.1, 0.12, 0.13] },
  TB: { temp: [90, 85, 78, 73, 71], wind: 8, wet: [0.22, 0.1, 0.07, 0.08, 0.08] },
  SF: { temp: [80, 75, 64, 58, 58], wind: 10, wet: [0.02, 0.05, 0.1, 0.15, 0.18] },
  SEA: { temp: [69, 59, 51, 45, 47], wind: 8, wet: [0.1, 0.25, 0.35, 0.38, 0.35] },
  ARI: { roof: true },
  LAX: { roof: true },
};

/** Whether a league plays in weather at all. */
export function weatherOn(league) {
  return league?.mode === 'pro' && !!league?.settings?.weather;
}

/** September to January, from a schedule week; the playoffs are January. */
export function monthOf(week) {
  if (week >= 100) return 4;
  return week <= 4 ? 0 : week <= 8 ? 1 : week <= 13 ? 2 : week <= 17 ? 3 : 4;
}

/** A club's home climate, by its position in the pro league. */
export function homeOf(teamIdx) {
  const t = PRO_TEAMS[teamIdx];
  return t ? { city: t.city, ...(CLIMATE[t.abbr] || { roof: true }) } : null;
}

/**
 * One afternoon at a home: temperature, wind and whatever falls, drawn around
 * the month's climate by `rng`.
 */
export function drawConditions(home, month, rng) {
  if (!home || home.roof) return { roof: true, city: home?.city ?? null };
  const temp = Math.round(rng.normal(home.temp[month], 7));
  const wind = Math.max(0, Math.round(rng.normal(home.wind, 4)));
  const falls = rng.chance(home.wet[month]);
  return { city: home.city, temp, wind, precip: falls ? (temp <= 34 ? 'snow' : 'rain') : null, altitude: !!home.altitude };
}

/**
 * This game's conditions, or null where there is no weather. Seeded by the
 * league, the season, the week and the home club, so a replayed week plays
 * under the same sky; the final is at a neutral dome.
 */
export function conditionsFor(league, entry, week) {
  if (!weatherOn(league) || !entry) return null;
  if (entry.neutral) return { roof: true, city: null, neutral: true };
  const rng = new RNG(hashSeed(`wx:${league.seed >>> 0}:${league.season}:${week}:${entry.home}`));
  return drawConditions(homeOf(entry.home), monthOf(week), rng);
}

// ---------------------------------------------------------------------------
// Effects. Each `raw` is what the conditions do against a still, dry, mild
// day; the league mean of it is taken out below, so what the engine applies
// averages to nothing over a season.
// ---------------------------------------------------------------------------

/** Mph a game has to blow before it costs anything. */
const CALM = 8;
/** Completion probability off per mph over calm, at a medium throw by an average arm. */
const WIND_COMP = 0.0035;
/** How much each kind of throw feels the wind, against a medium one. */
const DEPTH = { screen: 0.2, pass_short: 0.5, pass_med: 1, pa_pass: 1, pass_deep: 1.6 };
/** A wet ball. */
const WET_COMP = { rain: 0.02, snow: 0.03 };
const COLD_COMP = 0.01;
const WET_FUMBLE = { rain: 0.25, snow: 0.35 };
/** Field-goal range, in yards of the kicker's midpoint. */
const WIND_FG = 0.25;
const COLD_FG = 0.08;
const WET_FG = { rain: 1, snow: 2 };
const ALTITUDE_FG = 3;
/** Punt distance, in yards. */
const WIND_PUNT = 0.25;
const COLD_PUNT = 0.05;
const WET_PUNT = { rain: 1, snow: 2 };
const ALTITUDE_PUNT = 3;
/**
 * Where the engine's own formulas centre an arm and a leg (plays.js and
 * `fgProbability`), so an arm or leg feels the wind here as it would there.
 */
const ARM_MID = 82;
const LEG_MID = 80;
/**
 * The arm and leg that actually start in a pro league, which throw nearly
 * every pass and kick every kick: 89.9 and 87.3 over eight founding drafts
 * (`npm run weather arms`). The means are taken here, not at the formulas'
 * centres — taken there, weather lifted league completion by 0.13 points,
 * because the wind costs a strong starting arm less than the middling arm the
 * means had assumed.
 */
export const STARTER_ARM = 90;
export const STARTER_LEG = 87;

const windOver = (w) => Math.max(0, (w.wind ?? 0) - CALM);
const coldBelow = (w, t) => Math.max(0, t - (w.temp ?? t));
/** Arm strength resists the wind: a 95 arm feels two thirds of it, a 70 arm a third more. */
export const armFactor = (thp) => clamp(1 - ((thp ?? ARM_MID) - ARM_MID) / 40, 0.4, 1.4);
/** Leg strength likewise, on a kick. */
export const legFactor = (kpw) => clamp(1 - ((kpw ?? LEG_MID) - LEG_MID) / 40, 0.4, 1.4);

function rawComp(w, call, thp) {
  if (!w || w.roof) return 0;
  return -WIND_COMP * windOver(w) * (DEPTH[call] ?? 1) * armFactor(thp)
    - (WET_COMP[w.precip] || 0) - ((w.temp ?? 60) < 32 ? COLD_COMP : 0);
}
function rawFumble(w) {
  return w && !w.roof ? 1 + (WET_FUMBLE[w.precip] || 0) : 1;
}
function rawFg(w, kpw) {
  if (!w || w.roof) return 0;
  return -WIND_FG * windOver(w) * legFactor(kpw) - COLD_FG * coldBelow(w, 45) - (WET_FG[w.precip] || 0) + (w.altitude ? ALTITUDE_FG : 0);
}
function rawPunt(w) {
  if (!w || w.roof) return 0;
  return -WIND_PUNT * windOver(w) - COLD_PUNT * coldBelow(w, 45) - (WET_PUNT[w.precip] || 0) + (w.altitude ? ALTITUDE_PUNT : 0);
}

/**
 * The league means, over every home in the pro league and every week of a
 * season, drawn on a fixed stream at load so they cannot drift from the
 * climate table. A starter's arm and leg.
 */
export const MEANS = (() => {
  const rng = new RNG(hashSeed('weather-means'));
  const calls = Object.keys(DEPTH);
  const sum = { comp: Object.fromEntries(calls.map((c) => [c, 0])), fumble: 0, fg: 0, punt: 0 };
  let n = 0;
  for (let i = 0; i < PRO_TEAMS.length; i++) {
    const home = homeOf(i);
    for (let week = 1; week <= 18; week++) {
      for (let k = 0; k < 24; k++) {
        const w = drawConditions(home, monthOf(week), rng);
        for (const c of calls) sum.comp[c] += rawComp(w, c, STARTER_ARM);
        sum.fumble += rawFumble(w);
        sum.fg += rawFg(w, STARTER_LEG);
        sum.punt += rawPunt(w);
        n++;
      }
    }
  }
  return {
    comp: Object.fromEntries(calls.map((c) => [c, sum.comp[c] / n])),
    fumble: sum.fumble / n, fg: sum.fg / n, punt: sum.punt / n,
  };
})();

/** Completion probability to add for this throw in this weather. Zero with no weather. */
export function passShift(w, call, thp) {
  return w ? rawComp(w, call, thp) - (MEANS.comp[call] ?? 0) : 0;
}
/** What to multiply a fumble chance by. One with no weather. */
export function fumbleFactor(w) {
  return w ? rawFumble(w) / MEANS.fumble : 1;
}
/** Yards on a kicker's field-goal midpoint. Zero with no weather. */
export function fgShift(w, kpw) {
  return w ? rawFg(w, kpw) - MEANS.fg : 0;
}
/** Yards on a punt. Zero with no weather. */
export function puntShift(w) {
  return w ? rawPunt(w) - MEANS.punt : 0;
}

/** "Snow, 24°F, wind 14 mph" — or indoors. */
export function describeWeather(w) {
  if (!w) return '';
  if (w.roof) return w.neutral ? 'Indoors, neutral site' : 'Indoors';
  const sky = w.precip === 'snow' ? 'Snow' : w.precip === 'rain' ? 'Rain' : w.wind >= 18 ? 'Blustery' : w.temp <= 32 ? 'Frozen' : w.temp >= 85 ? 'Hot' : 'Clear';
  return `${sky}, ${w.temp}°F, wind ${w.wind} mph${w.altitude ? ', a mile up' : ''}`;
}

/** "Chicago · Snow, 24°F, wind 14 mph", for a scoreboard. */
export function conditionsLine(w) {
  if (!w) return '';
  return w.city ? `${w.city} · ${describeWeather(w)}` : describeWeather(w);
}

/** Mph over calm at which the wind is worth a sentence: about four points off a deep throw's completion. */
const WINDY = 7;

/**
 * What these conditions do, for the matchup card — only what is big enough
 * to matter, so a mild afternoon or a dome says nothing.
 */
export function weatherNote(w) {
  if (!w || w.roof) return '';
  const notes = [];
  if (windOver(w) >= WINDY) notes.push('the wind takes deep throws and long kicks, and a big arm and a big leg resist it');
  if (w.precip) notes.push(`a wet ball: more fumbles, fewer completions`);
  if ((w.temp ?? 60) < 32) notes.push('the cold shortens kicks');
  if (w.altitude) notes.push('the thin air carries a kick');
  return notes.join('; ');
}

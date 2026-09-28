// The game, told after the final whistle: the score by quarter, the man who
// won it, the plays that turned it drawn on the field, and a reel of the ones
// worth seeing again.
//
// All of it is read from what a finished game keeps — the log (the score
// each event carries, win probability, where each play went) and the
// players' lines — so a game that kept neither, one the AI played without
// you, has none of it. A season's logs are thinned when it ends: scores,
// turnovers and flags are kept whole and still draw; the other plays keep
// their words and lose their spots.

import { esc } from '../util.js';
import { fmtClock, fmtQuarter, fantasyPoints } from '../engine/stats.js';
import { replacementFromId } from '../engine/injuries.js';
import { resultLine, turningPoints, playText, starLines, injuryLine } from './charts.js';
import { playShapes, playFieldSvg, naturalSeconds } from './field.js';
import { teamChip } from './components.js';

// ---------------------------------------------------------------------------
// What is read off the game
// ---------------------------------------------------------------------------

/**
 * Points by quarter, from the score every event carries: a quarter's points
 * are the score at its last event less the score at the last event before it.
 * Overtime periods share one column. Null for a game without a log, or one
 * whose snapshots do not add up to its final score.
 */
export function lineScore(log, final) {
  if (!Array.isArray(log) || !log.length) return null;
  const at = [];
  let last = 4;
  for (const e of log) {
    if (!Array.isArray(e.score) || !Number.isInteger(e.q) || e.q < 1) continue;
    at[e.q] = e.score;
    last = Math.max(last, e.q);
  }
  const cum = [[0, 0]];
  for (let q = 1; q <= last; q++) cum[q] = at[q] || cum[q - 1];
  const periods = [1, 2, 3, 4];
  const points = (side) => {
    const row = periods.map((q) => cum[q][side] - cum[q - 1][side]);
    if (last > 4) row.push(cum[last][side] - cum[4][side]);
    return row;
  };
  const rows = [points(0), points(1)];
  const totals = [cum[last][0], cum[last][1]];
  if (final && (totals[0] !== final[0] || totals[1] !== final[1])) return null;
  return { periods: [...periods.map(String), ...(last > 4 ? ['OT'] : [])], rows, totals };
}

/**
 * The biggest fantasy line on the winning side — both sides in a tie — by the
 * game's own scoring (`fantasyPoints`), which counts a defender's tackles,
 * sacks and takeaways and a kicker's kicks as well as yards and scores.
 */
export function playerOfTheGame(players, score, byId) {
  if (!players || !score) return null;
  const sides = score[0] > score[1] ? [0] : score[1] > score[0] ? [1] : [0, 1];
  let best = null;
  for (const side of sides) {
    for (const [id, s] of Object.entries(players[side] || {})) {
      const p = byId.get(id) || replacementFromId(id);
      if (!p) continue;
      const pts = fantasyPoints(s);
      if (!best || pts > best.pts || (pts === best.pts && p.name < best.p.name)) best = { side, id, p, s, pts };
    }
  }
  return best && best.pts > 0 ? best : null;
}

/** A man's game in a line or two, whatever he plays: the parts that scored most first. */
export function statLine(s) {
  const d = s.def;
  const parts = [];
  if (s.pass.att) parts.push([s.pass.yds * 0.04 + s.pass.td * 4, `${s.pass.cmp}/${s.pass.att}, ${s.pass.yds} yds${s.pass.td ? `, ${s.pass.td} TD` : ''}${s.pass.int ? `, ${s.pass.int} INT` : ''}`]);
  if (s.rush.att) parts.push([s.rush.yds * 0.1 + s.rush.td * 6, `${s.rush.att} car, ${s.rush.yds} yds${s.rush.td ? `, ${s.rush.td} TD` : ''}`]);
  if (s.rec.rec) parts.push([s.rec.rec + s.rec.yds * 0.1 + s.rec.td * 6, `${s.rec.rec} rec, ${s.rec.yds} yds${s.rec.td ? `, ${s.rec.td} TD` : ''}`]);
  const dv = d.tkl + d.sck * 2 + d.int * 3 + d.ff * 2 + d.fr * 2 + d.pd * 0.5 + d.td * 6;
  if (dv) parts.push([dv, [d.tkl && `${d.tkl} tkl`, d.sck && `${d.sck} sck`, d.int && `${d.int} INT`, d.ff && `${d.ff} FF`, d.fr && `${d.fr} FR`, d.td && `${d.td} TD`].filter(Boolean).join(', ')]);
  if (s.k.fga || s.k.xpa) parts.push([s.k.fgm * 3 + s.k.xpm, `${s.k.fgm}/${s.k.fga} FG, ${s.k.xpm}/${s.k.xpa} XP`]);
  if (s.ret.td) parts.push([s.ret.td * 6, `${s.ret.td} return TD`]);
  return parts.sort((a, b) => b[0] - a[0]).filter((x, k) => k === 0 || x[0] >= 2).slice(0, 2).map((x) => x[1]).join(' · ');
}

// What earns a play a place in the reel beyond its swing: a touchdown or a
// safety, a turnover, a gain or a return long enough to be worth watching.
// A reel of the plays that moved the number most is right in a close game and
// empty in a rout, where nothing moves it and the scores are the story.
const SCORE_FLOOR = 0.08;
const BIG_FLOOR = 0.06;
const MIN_WEIGHT = 0.03;

/**
 * Up to `max` plays worth seeing again, in the order they happened: the plays
 * in `keep` (the turning points) whatever they are, then the rest by how far
 * each moved win probability, with touchdowns, safeties and turnovers counted
 * at least as a large swing and long gains and returns as a middling one —
 * without `keep`, a shootout's six touchdowns could crowd out the play that
 * decided it. Only plays that can be drawn; nothing that moved it less than a
 * routine swing.
 */
export function highlights(log, shapes, max = 6, keep = []) {
  const must = new Set(keep);
  const out = [];
  let prevWp = null;
  let lastScore = [0, 0];
  (log || []).forEach((e, k) => {
    const wp = typeof e.wp === 'number' ? e.wp : null;
    const delta = wp != null && prevWp != null ? wp - prevWp : 0;
    if (wp != null) prevWp = wp;
    const scored = Array.isArray(e.score) ? e.score[0] + e.score[1] - lastScore[0] - lastScore[1] : 0;
    if (Array.isArray(e.score)) lastScore = e.score;
    const shape = shapes[k];
    if (!shape) return;
    if (must.has(k)) { out.push({ k, e, delta, w: Infinity, shape }); return; }
    if (e.type === 'xp' || e.type === 'penalty' || e.type === 'kneel' || e.type === 'spike') return;
    let w = Math.abs(delta);
    if (scored >= 6 || (scored === 2 && e.type !== '2pt')) w = Math.max(w, SCORE_FLOOR);
    if (e.type === 'int' || e.type === 'fumble' || (e.type === 'punt' && e.yards < 0) || e.miss === 'blocked') w = Math.max(w, SCORE_FLOOR);
    if ((e.type === 'run' || e.type === 'pass') && e.yards >= 25) w = Math.max(w, BIG_FLOOR);
    if ((e.type === 'kickoff' || e.type === 'punt') && e.land != null && e.to != null && Math.min(e.land, 100) - e.to >= 30) w = Math.max(w, BIG_FLOOR);
    if (w >= MIN_WEIGHT) out.push({ k, e, delta, w, shape });
  });
  return out.sort((a, b) => b.w - a.w || a.k - b.k).slice(0, max).sort((a, b) => a.k - b.k);
}

/** Everything the recap shows, read once. */
export function buildRecap(box, byId) {
  const log = box.log || [];
  const shapes = playShapes(log);
  return {
    result: resultLine(box),
    lines: lineScore(log, box.score),
    potg: playerOfTheGame(box.players, box.score, byId),
    turns: turningPoints(log).map((t) => ({ ...t, shape: shapes[t.k] || null })).sort((a, b) => a.k - b.k),
    reel: highlights(log, shapes, 6, turningPoints(log).map((t) => t.k)),
    stars: starLines(box, byId),
    hurt: injuryLine(box, byId),
  };
}

// ---------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------

const swing = (delta, teams) => {
  if (!delta) return '';
  const t = teams[delta > 0 ? 0 : 1];
  return `<span class="swing" title="win probability">${esc(t.abbr)} +${Math.round(Math.abs(delta) * 100)}%</span>`;
};
const when = (e) => `${fmtQuarter(e.q)} ${fmtClock(e.clock ?? 0)}`;
const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The result, the score by quarter and the player of the game. */
export function recapTop(r, box) {
  const [home, away] = box.teams;
  const ls = r.lines;
  const table = ls ? `<div class="table-wrap"><table class="linescore"><thead><tr><th></th>${ls.periods.map((p) => `<th class="num">${p}</th>`).join('')}<th class="num">T</th></tr></thead><tbody>${[home, away].map((t, side) => `<tr><td>${teamChip(t, { abbr: true }).__raw}</td>${ls.rows[side].map((v) => `<td class="num">${v}</td>`).join('')}<td class="num"><b>${ls.totals[side]}</b></td></tr>`).join('')}</tbody></table></div>` : '';
  const p = r.potg;
  const potg = p ? `<div class="potg"><div class="potg-k">Player of the game</div><div class="potg-n"><b>${esc(p.p.name)}</b> <small class="muted">${esc(p.p.pos || '')}</small> ${teamChip(box.teams[p.side], { abbr: true }).__raw}</div><div class="potg-l">${esc(statLine(p.s))}</div><div class="muted potg-f">${p.pts.toFixed(1)} fantasy points</div></div>` : '';
  if (!r.result && !table && !potg) return '';
  return `<div class="card tight recap">${r.result ? `<p class="recap-result">${esc(r.result)}</p>` : ''}${table}${potg}</div>`;
}

/**
 * The turning points as cards, each with its play drawn close up; a tap
 * replays it. With `extras`, the leaders and the injuries underneath, for a
 * screen that has no box score of its own.
 */
export function turnsCard(r, box, { extras = false } = {}) {
  const cards = r.turns.map((t) => `<div class="tp${t.shape ? '' : ' bare'}">${t.shape ? `<button type="button" class="tp-field field2d" data-tp="${t.k}" aria-label="Replay: ${esc(playText(t.e))}">${playFieldSvg(t.shape, box.teams, { zoom: true, label: false })}</button>` : ''}<div class="tp-body"><div class="tp-meta"><b>${when(t.e)}</b> ${swing(t.delta, box.teams)}</div><div class="tp-text">${esc(playText(t.e))}</div></div></div>`).join('');
  const more = extras ? [...(r.stars.length ? [`Stars — ${r.stars.join(' · ')}.`] : []), ...(r.hurt ? [r.hurt] : [])] : [];
  if (!cards && !more.length) return '';
  return `<div class="card tight turns">${cards ? `<h3>${r.turns.length > 1 ? 'Turning points' : 'Turning point'}</h3><div class="tps">${cards}</div>` : ''}${more.map((l) => `<p class="muted recap-more">${esc(l)}</p>`).join('')}</div>`;
}

const caption = (h, teams) => `<b>${when(h.e)}</b> · ${esc(playText(h.e))} ${swing(h.delta, teams)}${Array.isArray(h.e.score) ? ` <b class="mono">${h.e.score[0]}–${h.e.score[1]}</b>` : ''}`;

/**
 * The reel's card, showing its first play as it finished; `mountRecap` runs
 * it. A device that asks for less motion is given the plays to step through
 * and no button that plays them on a timer.
 */
export function reelCard(r, box) {
  if (!r.reel.length) return '';
  const first = r.reel[0];
  const dots = r.reel.map((h, n) => `<span class="rdot${n === 0 ? ' on' : ''}"></span>`).join('');
  return `<div class="card tight reel" data-reel>
    <div class="row between reel-head"><h3>Highlights</h3><small class="muted reel-count">1 of ${r.reel.length}</small></div>
    <div class="field2d reel-field">${playFieldSvg(first.shape, box.teams)}</div>
    <p class="reel-cap" aria-live="polite">${caption(first, box.teams)}</p>
    <div class="reel-bar">
      <button type="button" class="btn sm" data-reel="prev" aria-label="Previous highlight">◀</button>
      ${calm() ? '' : '<button type="button" class="btn sm primary" data-reel="play">▶ Play all</button>'}
      <button type="button" class="btn sm" data-reel="next" aria-label="Next highlight">▶</button>
      <span class="reel-dots" aria-hidden="true">${dots}</span>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Behaviour
// ---------------------------------------------------------------------------

/**
 * Wire the reel and the turning points in `root`. Returns a function that
 * stops the reel, for a view to call when it redraws or leaves.
 *
 * The reel plays each highlight a quarter slower than the live game draws it
 * and holds on it a second and a half before the next. Asked for less motion,
 * it shows each play as it finished and moves on only when told to.
 */
export function mountRecap(root, r, box) {
  let timer = null;
  const el = root.querySelector('[data-reel]');
  let at = 0;
  let playing = false;
  const stop = () => { clearTimeout(timer); timer = null; };
  const show = (n, animate) => {
    if (!el) return;
    at = (n + r.reel.length) % r.reel.length;
    const h = r.reel[at];
    const seconds = naturalSeconds(h.shape) * 1.25;
    el.querySelector('.reel-field').innerHTML = playFieldSvg(h.shape, box.teams, { animate: animate && !calm(), seconds });
    el.querySelector('.reel-cap').innerHTML = caption(h, box.teams);
    el.querySelector('.reel-count').textContent = `${at + 1} of ${r.reel.length}`;
    el.querySelectorAll('.rdot').forEach((d, k) => d.classList.toggle('on', k === at));
    stop();
    if (playing) {
      if (at + 1 < r.reel.length) timer = setTimeout(() => show(at + 1, true), (seconds + 1.5) * 1000);
      else timer = setTimeout(() => { playing = false; timer = null; label(); }, (seconds + 1.5) * 1000);
    }
  };
  const label = () => {
    const b = el?.querySelector('[data-reel="play"]');
    if (b) b.textContent = playing ? '⏸ Pause' : '▶ Play all';
  };
  el?.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-reel]');
    if (!b) return;
    const act = b.dataset.reel;
    if (act === 'play') {
      if (playing) { playing = false; stop(); label(); return; }
      // From the top when the reel has run out; from where it stands otherwise.
      playing = true;
      label();
      show(at === r.reel.length - 1 && !timer ? 0 : at, true);
    } else {
      playing = false;
      label();
      show(at + (act === 'next' ? 1 : -1), true);
    }
  });
  root.querySelectorAll('[data-tp]').forEach((b) => b.addEventListener('click', () => {
    const t = r.turns.find((x) => String(x.k) === b.dataset.tp);
    if (t?.shape) b.innerHTML = playFieldSvg(t.shape, box.teams, { zoom: true, label: false, animate: !calm(), seconds: naturalSeconds(t.shape) * 1.25 });
  }));
  return stop;
}

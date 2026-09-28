// The rest of the week, played back. When a week is simulated every game in
// it resolves at once and the hub shows sixteen finals, which is the result
// without the afternoon. This runs every game of the week on one clock as a
// board of scores — twenty seconds from kickoff to the last final — with each
// score arriving when it came, a line for every score in a feed, and the
// finals marked where a side with a much worse record beat a much better one.
//
// Nothing here is decided by the ticker: the results are already in the
// books. Every game records when each of its scores came (`scoringTimeline`,
// season.js), and this replays them.

import { esc } from '../util.js';
import { teamChip, announce } from './components.js';
import { fmtClock, fmtQuarter } from '../engine/stats.js';

/** Real seconds for a regulation afternoon; overtime runs on at the same rate. */
export const TICKER_SECONDS = 20;
/**
 * An upset is by the standings, not by the odds: both sides four games in,
 * and the winner's record at least this far below the loser's going into the
 * week. The engine's own chance at kickoff was the first idea and does not
 * survive measuring — over 1,853 league games it predicts the winner worse
 * than a coin — and even a gap this wide in the records is won by the better
 * side only 57% of the time, so the badge states the records and claims no
 * odds (DESIGN.md, "The rest of the week").
 */
export const UPSET_GAP = 0.35;
export const UPSET_MIN_GAMES = 4;
const RATE = 3600 / TICKER_SECONDS;

const played = (r) => r.w + r.l + r.t;
const pct = (r) => (r.w + r.t / 2) / Math.max(1, played(r));
const fmtRec = (r) => `${r.w}–${r.l}${r.t ? `–${r.t}` : ''}`;

/**
 * A club's record going into the game `entry`: its record now, less this
 * game in the regular season, which is when records count it. Good for the
 * current week only, which is the only week the ticker plays.
 */
function recordBefore(league, entry, side) {
  const r = league.teams[side === 0 ? entry.home : entry.away].record || { w: 0, l: 0, t: 0 };
  if (league.phase !== 'season') return r;
  const [h, a] = entry.result.score;
  const d = side === 0 ? h - a : a - h;
  return { w: r.w - (d > 0), l: r.l - (d < 0), t: r.t - (d === 0) };
}

/** The week's games that can be played back, in schedule order. */
export function tickerGames(league, games, u) {
  const out = [];
  (games || []).forEach((entry, i) => {
    const r = entry.result;
    if (!r || !Array.isArray(r.sc) || entry.bye) return;
    const [h, a] = r.score;
    let upset = null;
    if (h !== a) {
      const win = h > a ? 0 : 1;
      const w = recordBefore(league, entry, win), l = recordBefore(league, entry, 1 - win);
      if (Math.min(played(w), played(l)) >= UPSET_MIN_GAMES && pct(l) - pct(w) >= UPSET_GAP - 1e-9) upset = { winner: fmtRec(w), loser: fmtRec(l) };
    }
    out.push({
      i, home: league.teams[entry.home], away: league.teams[entry.away],
      score: r.score, sc: r.sc, end: r.end || 3600, overtime: !!r.overtime,
      mine: entry.home === u || entry.away === u, upset,
    });
  });
  return out;
}

/** "2nd 8:34", "OT 3:12", "2OT 14:05" at `t` elapsed game seconds. */
export function clockLabel(t, playoff) {
  if (t <= 0) return 'Kickoff';
  // A moment on a period's boundary is the end of the period, not the start
  // of the next: a field goal as regulation expires is "4th 0:00".
  if (t <= 3600) {
    const q = Math.min(4, Math.ceil(t / 900));
    return `${fmtQuarter(q)} ${fmtClock(q * 900 - t)}`;
  }
  const len = playoff ? 900 : 600;
  const n = Math.ceil((t - 3600) / len) - 1;
  return `${n ? `${n + 1}OT` : 'OT'} ${fmtClock((n + 1) * len - (t - 3600))}`;
}

/** The score of a game at `t` elapsed seconds. */
export function scoreAt(game, t) {
  const s = [0, 0];
  for (let k = 0; k < game.sc.length; k += 3) if (game.sc[k] <= t) s[game.sc[k + 1]] += game.sc[k + 2];
  return s;
}

// Short, as a ticker writes them: a line has to fit across a phone. A lone
// two is a safety, since a try scores only with the touchdown before it.
const KIND = { 2: 'safety', 3: 'FG', 6: 'TD', 7: 'TD', 8: 'TD' };

/**
 * Every score of the week in the order it came: who scored, what it was, the
 * score after it, and what it did to the game.
 */
export function feedOf(games, playoff) {
  const out = [];
  games.forEach((g, gi) => {
    const s = [0, 0];
    for (let k = 0; k < g.sc.length; k += 3) {
      const [t, side, pts] = [g.sc[k], g.sc[k + 1], g.sc[k + 2]];
      const before = [...s];
      s[side] += pts;
      const was = Math.sign(before[side] - before[1 - side]), now = Math.sign(s[side] - s[1 - side]);
      // The first score of a game puts a side ahead of nobody: not called.
      const what = now === 0 ? 'ties it' : was < 0 && now > 0 ? 'takes the lead' : was === 0 && now > 0 && before[0] > 0 ? 'goes ahead' : '';
      out.push({ t, gi, side, pts, kind: KIND[pts] || `${pts} points`, after: [...s], what, when: clockLabel(t, playoff) });
    }
  });
  return out.sort((a, b) => a.t - b.t || a.gi - b.gi);
}

const board = (g, n) => `<div class="tk-game${g.mine ? ' mine' : ''}" data-g="${n}">
  <div class="tk-row" data-side="0">${teamChip(g.home, { abbr: true }).__raw}<b class="tk-s">0</b></div>
  <div class="tk-row" data-side="1">${teamChip(g.away, { abbr: true }).__raw}<b class="tk-s">0</b></div>
  <div class="tk-st muted"></div>
</div>`;

/** The ticker's card; `mountTicker` runs it. */
export function tickerCard(title, games) {
  if (!games.length) return '';
  // The clock, the buttons and the latest scores sit above the boards: on a
  // phone sixteen boards run well past the fold, and what is happening now
  // should not be down there with them.
  return `<div class="card tight ticker-card" data-ticker>
    <div class="row between tk-head"><h3>${esc(title)}</h3><span class="tk-clock mono" aria-hidden="true">Kickoff</span></div>
    <div class="btn-group tk-bar">
      <button type="button" class="btn sm" data-tk="skip">Skip to the finals</button>
      <button type="button" class="btn sm ghost" data-tk="close">Close</button>
    </div>
    <ul class="tk-feed plain" aria-hidden="true"></ul>
    <div class="tk-grid">${games.map(board).join('')}</div>
  </div>`;
}

const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Where a ticker stands, kept across the hub's redraws so a redraw neither
// restarts it nor loses it: the week it belongs to, and when it started.
let run = null;

/** Ask for the week `key` to be played back the next time the hub draws. */
export function queueTicker(key) { run = { key, t0: null }; }
/** Whether the week `key` has a ticker showing. */
export const tickerFor = (key) => !!run && run.key === key;

/**
 * Run the ticker in `root` for the week `key`. Returns a function that stops
 * the clock, for the view to call when it redraws or is left. A device that
 * asks for less motion is shown the finals at once.
 */
export function mountTicker(root, games, { key, playoff = false, onClose } = {}) {
  const el = root.querySelector('[data-ticker]');
  if (!el || !run || run.key !== key) return () => {};
  const total = Math.max(...games.map((g) => g.end));
  const feed = feedOf(games, playoff);
  if (run.t0 == null) run.t0 = calm() ? -Infinity : performance.now();
  let raf = null;
  let shown = -1;
  let fed = 0;
  // A redraw of the hub mid-afternoon picks the clock up where it was; the
  // scores it arrives at are not news, so they do not flash.
  let quiet = true;
  const draw = (t) => {
    games.forEach((g, n) => {
      const box = el.querySelector(`[data-g="${n}"]`);
      const done = t >= g.end;
      const s = done ? g.score : scoreAt(g, t);
      box.querySelectorAll('.tk-row').forEach((row, side) => {
        const out = row.querySelector('.tk-s');
        if (out.textContent !== String(s[side])) {
          out.textContent = String(s[side]);
          if (!quiet && !done) { row.classList.remove('hit'); void row.offsetWidth; row.classList.add('hit'); }
        }
        row.classList.toggle('lead', s[side] > s[1 - side]);
      });
      const st = box.querySelector('.tk-st');
      // Every game runs on the one clock at the top; a board says only when
      // it is over.
      st.innerHTML = done
        ? `<b>Final${g.overtime ? ' · OT' : ''}</b>${g.upset ? ` <span class="badge upset">Upset</span> <span title="their records going into the week">${g.upset.winner} over ${g.upset.loser}</span>` : ''}`
        : '';
      box.classList.toggle('final', done);
    });
    el.querySelector('.tk-clock').textContent = t >= total ? 'All final' : clockLabel(t, playoff);
    // The newest scores at the top, five at a time.
    const list = el.querySelector('.tk-feed');
    while (fed < feed.length && feed[fed].t <= t) {
      const f = feed[fed++];
      const g = games[f.gi];
      const who = f.side === 0 ? g.home : g.away;
      const li = document.createElement('li');
      li.innerHTML = `<small class="muted">${f.when}</small> <b>${esc(who.abbr)}</b> ${f.kind}${f.what ? `, ${f.what}` : ''} · ${esc(g.home.abbr)} ${f.after[0]}–${f.after[1]} ${esc(g.away.abbr)}`;
      list.prepend(li);
      while (list.children.length > 5) list.lastChild.remove();
    }
    quiet = false;
  };
  const frame = (now) => {
    const t = Math.min(total, Math.max(0, (now - run.t0) / 1000) * RATE);
    // Five game seconds a redraw: the clock still reads true to the second.
    const whole = Math.floor(t / 5);
    if (whole !== shown) { shown = whole; draw(t); }
    if (t < total) raf = requestAnimationFrame(frame);
    else finish();
  };
  const finish = () => {
    const b = el.querySelector('[data-tk="skip"]');
    if (b && calm()) b.remove();
    else if (b) { b.textContent = 'Replay'; b.dataset.tk = 'replay'; }
    if (!run.said) {
      run.said = true;
      const ups = games.filter((g) => g.upset).length;
      announce(`All final. ${ups ? `${ups} upset${ups === 1 ? '' : 's'}.` : 'No upsets.'}`);
    }
  };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tk]');
    if (!b) return;
    if (b.dataset.tk === 'close') { run = null; cancelAnimationFrame(raf); onClose?.(); return; }
    if (b.dataset.tk === 'skip') { run.t0 = -Infinity; }
    if (b.dataset.tk === 'replay') {
      run.t0 = performance.now();
      fed = 0; shown = -1; quiet = false;
      el.querySelector('.tk-feed').replaceChildren();
      b.textContent = 'Skip to the finals';
      b.dataset.tk = 'skip';
      raf = requestAnimationFrame(frame);
    }
  });
  if (run.t0 === -Infinity) { draw(total); finish(); } else raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

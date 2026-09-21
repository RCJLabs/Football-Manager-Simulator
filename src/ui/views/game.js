import { html, render, raw } from '../../util.js';
import { step, stepDrive, stepQuarter, simulateGame, decisionNeeded, spot, downText, callTimeout, timeoutLegal, takeClock, setTempo } from '../../engine/game.js';
import { OFFENSE_CALLS, DEFENSE_CALLS, fgDistance, fgProbability, halfSecondsLeft, matchup } from '../../engine/playcall.js';
import { fmtClock, fmtQuarter } from '../../engine/stats.js';
import { currentWeek, simulateWeekAi, recordResult, weekNumber, userTeamIndex } from '../../engine/season.js';
import { teamChip, announce} from '../components.js';
import { wpChart, wpLabel, driveChart, gameStory, statLeaders } from '../charts.js';

export const selfRendering = true;

const PLAY_HELP = {
  run_in: 'Power between the tackles', run_out: 'Stretch / toss to the edge', screen: 'Beats the blitz', pass_short: 'High percentage', pass_med: 'Intermediate routes',
  pass_deep: 'Take a shot', pa_pass: 'Fake the run, throw', fg: '', punt: '', kneel: 'Run out the clock', spike: 'Stop the clock',
};

/**
 * The play-by-play, newest first, without the drive headers reading as footers.
 *
 * The list is reversed so the latest play is at the top, and a drive header is
 * logged *before* the plays it introduces, so reversing put it underneath them.
 * That is not merely upside down: an interception ends one drive and starts
 * another, so the header for the club that took the ball landed between the
 * kneel it led to and the interception that caused it, inverting the causation
 * twice in three lines.
 *
 * So the order is by drive rather than by event. Newest drive first, its header
 * on top of its own plays — a header is a label for the possession, not a
 * moment inside it — and the plays under it newest first, which keeps the play
 * that just happened second from the top of the page.
 *
 * A kickoff is logged before the drive header it produces, so it is pulled down
 * into the drive it started rather than left hanging under the previous one.
 * Everything before the first header (the opening-kickoff note) keeps its own
 * headerless group at the bottom. The final whistle is hoisted clear of the
 * last drive: it is the result of the game, not a line inside somebody's
 * possession, and it belongs at the top of the page.
 */
export function pbpOrder(log) {
  if (!Array.isArray(log) || !log.length) return [];
  const groups = [[]];
  for (const e of log) {
    if (e.type === 'drive') {
      // Carry any kickoff already sitting at the end of the last group forward:
      // it belongs to the possession it handed the ball to.
      const prev = groups[groups.length - 1];
      const carried = [];
      while (prev.length && prev[prev.length - 1].type === 'kickoff') carried.unshift(prev.pop());
      groups.push([e, ...carried]);
    } else {
      groups[groups.length - 1].push(e);
    }
  }
  const out = [];
  const last = groups[groups.length - 1];
  const whistle = last.length && last[last.length - 1].type === 'final' ? last.pop() : null;
  if (whistle) out.push(whistle);
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g.length) continue;
    // The header stays at the top of its group; everything else reverses.
    if (g[0].type === 'drive') { out.push(g[0]); out.push(...g.slice(1).reverse()); }
    else out.push(...g.slice().reverse());
  }
  return out;
}

/**
 * What the chip means in words, from the offence's side.
 *
 * Measured against the neutral base look, so a defence that does not commit
 * gets neither credit nor blame and the sentence says exactly that instead of
 * showing a chip reading +0.0. Of the 21 committed cells, a quarter sit inside
 * 0.78 yards of base and half inside 1.23, so the two thresholds land at 0.75
 * and 2: roughly five even, eleven slight, five decisive.
 */
const VERDICT = {
  won: 'The defence committed the wrong way — this call punishes that look.',
  edge: 'A little in the offence\u2019s favour.',
  straight: 'The defence played it straight.',
  even: 'Committing that way changed almost nothing.',
  pinched: 'A little in the defence\u2019s favour.',
  lost: 'The defence committed the right way — this call walks into that look.',
};

/** Short enough for four of them to sit across a 360px phone. */
const TEMPO_LABEL = { auto: 'Auto', hurry: 'Hurry', normal: 'Normal', kill: 'Bleed' };
const TEMPO_HELP = {
  auto: 'Read the situation', hurry: 'No huddle, snap fast',
  normal: 'Ignore the clock', kill: 'Milk the play clock',
};

// ---------------------------------------------------------------------------
// Autoplay pacing
// ---------------------------------------------------------------------------

/**
 * How long to hold on the play that just ran.
 *
 * A flat interval gave a kneel-down the same three-quarters of a second as a
 * pick-six, which is most of why autoplay read as a ticker rather than a game.
 * The signal is the swing in win probability, which the engine already stamps
 * on every event: measured over 5,785 snaps, half move it by less than half a
 * point and the top one percent by more than twenty-four.
 *
 * The curve is a square root, so the common small swings still separate from
 * each other rather than all collapsing onto the floor, saturating at `FULL`
 * (about the 99th percentile). `BEAT` is a floor for the plays worth holding on
 * even when the number barely moves — a score that is not a routine extra
 * point, a turnover, the end of a period. A garbage-time touchdown is still the
 * most interesting thing on the screen.
 *
 * The constants are chosen so the mean lands within 2% of the speed the player
 * set: the slider keeps meaning what it says and a game takes as long as it
 * always did. What changes is the distribution — at the 900ms default, a
 * quarter of snaps sit at the 495ms floor, 8% are held for a beat, and the
 * range runs to 2.5s. A test pins the mean so that property cannot drift.
 */
export const PACE = { MIN: 0.55, MAX: 2.8, FULL: 0.2, BEAT: 1.4, FLOOR_MS: 250, CEIL_MS: 4000 };

export function paceDelay(base, delta, beat) {
  const d = Number.isFinite(delta) ? Math.abs(delta) : 0;
  const curve = PACE.MIN + (PACE.MAX - PACE.MIN) * Math.min(1, Math.sqrt(d / PACE.FULL));
  const scale = Math.max(beat ? PACE.BEAT : 0, curve);
  // Clamped in absolute terms as well, so neither end of the speed slider turns
  // into a flicker or a slideshow.
  return Math.round(Math.min(PACE.CEIL_MS, Math.max(PACE.FLOOR_MS, (base || 900) * scale)));
}

/** Worth a beat whatever the number says. */
export const isBeat = (e) => !!e && ((e.scoring && e.type !== 'xp') || e.type === 'int' || e.type === 'fumble' || e.type === 'quarter');

/**
 * The snap the field strip should draw: the most recent play in the log, which
 * is not always the most recent *event*.
 *
 * A play that changes possession logs itself and then, inside the same step,
 * logs the new drive's header on top of it — so walking back past a drive
 * header (and the asides that can follow a play) is how you find the snap that
 * just happened. A kickoff, quarter break or extra point means the last snap is
 * over and the bar should clear, so the walk stops at anything else.
 */
const SKIP_BACK = new Set(['drive', 'injury', 'timeout', 'info']);
// The last play announced, so a redraw that changes nothing says nothing.
let lastSaid = null;

function lastSnap(log) {
  if (!Array.isArray(log)) return null;
  for (let i = log.length - 1; i >= 0 && i >= log.length - 4; i--) {
    const e = log[i];
    if (e.from != null) return e;
    if (!SKIP_BACK.has(e.type)) return null;
  }
  return null;
}

export function view(root, params, ctx) {
  const state = ctx.getState();
  const league = state.league;
  if (!league || !state.game) { ctx.navigate('#/season'); return; }
  const g = state.game.g;
  const u = userTeamIndex(league);
  const userSide = g.teams.findIndex((t) => t.id === league.teams[u].id);
  const coach = league.settings.coachMode;
  const coachDef = league.settings.coachDefense;
  let timer = null;
  let autoplay = false;
  // Coaching a game means running its clock: `wantsTimeout` stops spending this
  // club's timeouts and `g.tempo` starts being honoured. Every skip-ahead path
  // hands it back for its own duration, so a Sim to end is managed as it always
  // was. Released in `finish`, not on unmount, so a trip to the depth chart
  // does not quietly reset the tempo mid-drill.
  if (coach && !g.final) takeClock(g, userSide);

  const persist = () => ctx.update((s) => { if (s.game) s.game.g = g; }, { silent: true });
  const decision = () => decisionNeeded(g, coach ? userSide : null, coachDef);
  const stopAuto = () => { autoplay = false; clearTimeout(timer); timer = null; };
  const startAuto = () => {
    autoplay = true;
    clearTimeout(timer);
    let prev = typeof g.lastEvent?.wp === 'number' ? g.lastEvent.wp : 0.5;
    const tick = () => {
      if (!autoplay) return;
      if (g.final || decision()) { stopAuto(); draw(); return; }
      const from = g.log.length;
      step(g);
      const wp = typeof g.lastEvent?.wp === 'number' ? g.lastEvent.wp : prev;
      const delta = wp - prev;
      prev = wp;
      // Only this step's events: a step logs the play and can log the drive
      // header behind it, and reaching further back would beat on the last one
      // again.
      const beat = g.log.slice(from).some(isBeat);
      persist();
      draw();
      if (!autoplay || g.final || decision()) { stopAuto(); draw(); return; }
      timer = setTimeout(tick, paceDelay(ctx.getState().prefs.autoplayMs, delta, beat));
    };
    // The first play runs on the click rather than after a wait, so the button
    // answers straight away.
    tick();
  };

  function act(fn) { fn(); persist(); draw(); }

  function draw() {
    const dec = decision();
    const off = g.possession;
    const [home, away] = g.teams;
    const ballX = g.phase === 'play' ? (off === 0 ? g.ballOn : 100 - g.ballOn) : 50;
    const fdX = g.phase === 'play' ? (off === 0 ? g.ballOn + g.toGo : 100 - g.ballOn - g.toGo) : null;
    // Where this drive began, so the strip shows how far they have come rather
    // than only where the ball is sitting.
    const startX = g.drive && g.phase === 'play'
      ? (off === 0 ? g.drive.startBallOn : 100 - g.drive.startBallOn) : null;
    const driveFrom = startX != null ? Math.min(startX, ballX) : null;
    const driveTo = startX != null ? Math.max(startX, ballX) : null;
    // The play that just happened, in the same left-to-right frame the strip
    // uses. `from` and `snapOff` come off the log entry because the ball has
    // already moved (and on a turnover changed hands) by the time it is written.
    const ev = lastSnap(g.log);
    // A live game is the one screen where the thing worth knowing arrives on a
    // timer rather than on a tap, and it was silent. The play-by-play list is
    // not the place to say so — it redraws whole, so a live region on it would
    // read the entire log again every snap. The newest play goes through the
    // same one-line channel a toast uses, once, and only while there is a game
    // still going on.
    if (ev && ev.text && !g.final && lastSaid !== ev.text) { lastSaid = ev.text; announce(ev.text); }
    // Not `g.lastEvent`: a play that changes hands calls `changePossession` in
    // the same step, and that logs the new drive's header on top of it. Punts,
    // interceptions, fumbles, missed field goals and turnovers on downs all did
    // that, so the bar for every one of them was overwritten before it drew.
    // The phase is no authority either — a touchdown flips to `pat` and a made
    // field goal to `kickoff` the moment they score.
    const playable = ev && typeof ev.yards === 'number' && !g.final;
    let play = null;
    if (playable) {
      const frame = (spotOn) => (ev.snapOff === 0 ? spotOn : 100 - spotOn);
      const clamp100 = (n) => Math.max(0, Math.min(100, n));
      const a = frame(clamp100(ev.from));
      // Kicks carry their landing spot, because their `yards` is 0.
      const b = frame(clamp100(ev.to != null ? ev.to : ev.from + ev.yards));
      const kick = ev.type === 'punt' || ev.type === 'fg';
      const turnover = ev.type === 'int' || ev.type === 'fumble'
        || (ev.type === 'fg' && !ev.scoring) || /Turnover on downs/.test(ev.text || '');
      play = {
        from: Math.min(a, b), to: Math.max(a, b),
        // Outcome, not club: a green team on a green field is invisible, and
        // several of them are green. The drive band underneath still carries
        // the colour, so identity is not lost.
        kind: ev.scoring ? 'score' : turnover ? 'turn' : ev.type === 'penalty' ? 'flag'
          : kick ? 'kick' : ev.yards < 0 ? 'loss' : 'gain',
      };
    }
    const dist = fgDistance(g.ballOn);
    const kicker = g.teams[off].comp.k;
    const fgP = Math.round(fgProbability(kicker, dist) * 100);

    let controls;
    if (g.final) {
      controls = html`<div class="row" style="justify-content:center;margin:.5rem 0">
        <a class="btn" href="#/box/live">Box score</a>
        <button class="btn primary lg" id="finish">Continue to season</button>
      </div>`;
    } else if (dec === 'offense') {
      const playKeys = ['run_in', 'run_out', 'pass_short', 'pass_med', 'pass_deep', 'screen', 'pa_pass'];
      controls = html`
        <div class="row between"><b>Your call — ${downText(g)} at ${spot(g, off, g.ballOn)}</b><small class="muted">${fmtQuarter(g.quarter)} ${fmtClock(g.clock)}</small></div>
        <div class="playcalls" style="margin:.5rem 0">
          ${playKeys.map((k) => html`<button class="btn" data-off="${k}">${OFFENSE_CALLS[k].label}<small>${PLAY_HELP[k]}</small></button>`)}
          <button class="btn ghost" data-off="ai">Let the AI call it<small>Use my strategy</small></button>
        </div>
        <div class="btn-group">
          <button class="btn special" data-off="fg" ${dist > 68 ? 'disabled' : ''}>Field goal <small>&nbsp;${dist} yds · ${fgP}%</small></button>
          <button class="btn special" data-off="punt">Punt</button>
          <button class="btn special" data-off="kneel">Kneel</button>
          <button class="btn special" data-off="spike">Spike</button>
          <span class="spacer"></span>
          <button class="btn ghost" id="simEnd">Sim to end</button>
        </div>`;
    } else if (dec === 'defense') {
      controls = html`
        <div class="row between"><b>Defensive call — ${downText(g)}, ${g.teams[off].abbr} at ${spot(g, off, g.ballOn)}</b><small class="muted">${fmtQuarter(g.quarter)} ${fmtClock(g.clock)}</small></div>
        <div class="playcalls" style="margin:.5rem 0">
          ${Object.entries(DEFENSE_CALLS).map(([k, d]) => html`<button class="btn" data-def="${k}">${d.label}<small>${d.desc}</small></button>`)}
        </div>
        <div class="btn-group"><button class="btn ghost" data-def="ai">Let the AI call it</button><span class="spacer"></span><button class="btn ghost" id="simEnd">Sim to end</button></div>`;
    } else if (dec === 'pat') {
      controls = html`<div class="row between"><b>Touchdown! Extra point or two?</b></div>
        <div class="btn-group" style="margin:.5rem 0"><button class="btn primary" data-pat="xp">Kick the extra point</button><button class="btn" data-pat="two">Go for two</button></div>`;
    } else {
      // Five buttons of equal weight measured 179px of an 844px phone — a fifth
      // of the screen, for the least interesting thing on it, pushing the
      // play-by-play below the fold. Watching is one action; skipping ahead is
      // three you want occasionally and never by accident.
      controls = html`<div class="gamebar">
        <button class="btn primary" id="next">Next play</button>
        <button class="btn ${autoplay ? 'primary' : ''}" id="auto">${autoplay ? '⏸ Pause' : '▶ Autoplay'}</button>
      </div>
      <details class="skipahead">
        <summary class="muted">Skip ahead</summary>
        <div class="btn-group" style="margin-top:.4rem">
          <button class="btn sm" id="drive">Next drive</button>
          <button class="btn sm" id="quarter">End of quarter</button>
          <button class="btn sm" id="simEnd">Sim to end</button>
        </div>
      </details>`;
    }

    // The clock decides games at the end of a half and nowhere else, and a row
    // of buttons that does nothing for fifty minutes is a row of buttons in the
    // way. Measured over 400 seeds: hoarding three timeouts in a trailing
    // two-minute drill costs 6.6 points of win rate, and on defence 5.3 — which
    // is what the button is for. Tempo only shows with the ball, because you
    // cannot set the other club's.
    const clockLive = coach && !g.final && (g.quarter === 2 || g.quarter >= 4) && halfSecondsLeft(g) <= 300;
    const canTimeout = clockLive && timeoutLegal(g, userSide);
    const myBall = clockLive && g.possession === userSide && g.phase === 'play';
    const tempoNow = g.tempo?.[userSide] || 'auto';
    const clockbar = !clockLive ? '' : html`<div class="clockbar">
      <button class="btn sm ${canTimeout ? 'danger' : ''}" id="timeout" ${canTimeout ? '' : 'disabled'}
        title="${g.timeouts[userSide] ? (canTimeout ? 'Stop the clock' : 'The clock is already stopped') : 'None left'}">
        ⏱ Timeout · ${g.timeouts[userSide]} left</button>
      ${myBall ? html`<div class="tempo" role="group" aria-label="Tempo">
        ${Object.keys(TEMPO_LABEL).map((k) => html`<button class="btn sm ${tempoNow === k ? 'primary' : ''}" data-tempo="${k}" title="${TEMPO_HELP[k]}">${TEMPO_LABEL[k]}</button>`)}
      </div>` : ''}
    </div>`;

    // `Last: Medium Pass vs Base` said what was called and nothing about whether
    // it was a good call, which is the only part a player can learn from. The
    // grid says what the pairing is worth; the chip says how much of that was
    // the defence's guess. It is about the call, not this snap — a good call
    // still loses three yards sometimes — so the line is labelled that way.
    const lc = g.lastCall && g.phase !== 'kickoff' && !g.final ? g.lastCall : null;
    const mu = lc ? matchup(lc.off, lc.def) : null;
    const last = lc ? {
      off: OFFENSE_CALLS[lc.off]?.label || lc.off,
      def: DEFENSE_CALLS[lc.def]?.label || lc.def,
      mu,
      note: mu ? VERDICT[mu.verdict] : '',
      tip: mu ? `${mu.yds.toFixed(1)} yards a play league-wide, against ${mu.base.toFixed(1)} for this call into a base look — ${mu.rank === 1 ? 'the best' : mu.rank === mu.of ? 'the worst' : `number ${mu.rank}`} of the ${mu.of} defences it could have met.` : '',
    } : null;
    const wpNow = g.lastEvent && typeof g.lastEvent.wp === 'number' ? g.lastEvent.wp : null;
    const story = g.final ? gameStory({ teams: g.teams, score: g.score, final: true, overtime: g.quarter >= 5, log: g.log, players: [g.stats[0].players, g.stats[1].players], injuries: g.teams.map((t) => t.injuries || []) }, ctx.byId) : [];
    // Who is having the game. Folded away like the drive chart, so it costs one
    // line closed; the summary carries the two names worth seeing at a glance,
    // which is the part you want while watching rather than while studying.
    // Live only: once the game ends the story card above prints the same four
    // lines as prose, and two copies of the same thing is worse than one.
    const leaders = g.teams.map((t, side) => ({
      abbr: t.abbr, color: t.color, rows: statLeaders(g.stats[side].players, ctx.byId),
    }));
    const leadSummary = leaders
      .map((l) => { const best = l.rows.find((r) => r.kind === 'pass') || l.rows[0]; return best ? `${l.abbr} ${best.name.split(' ').at(-1)}` : ''; })
      .filter(Boolean).join(' · ');

    const newest = g.log.length - 1;
    const logItems = pbpOrder(g.log).map((e) => {
      const cls = e.type === 'drive' ? 'drive' : e.type === 'injury' ? 'injury' : e.flag && !e.scoring ? 'penalty' : e.type === 'quarter' || e.type === 'final' || e.type === 'info' ? 'quarter' : e.scoring ? 'scoring' : (e.type === 'int' || e.type === 'fumble' || /Turnover on downs/.test(e.text)) ? 'turnover' : '';
      return `<li class="${cls} ${e.i === newest ? 'latest' : ''}">${e.situation ? `<span class="sit">${e.situation}</span>` : ''}${e.text}</li>`;
    }).join('');

    render(root, html`
      <div class="scoreboard">
        <div class="sb-team ${off === 0 && !g.final ? 'poss' : ''}"><span class="name">${teamChip(home, { responsive: true })}</span><span class="score">${g.score[0]}</span><span class="to">${'●'.repeat(g.timeouts[0])}${'○'.repeat(Math.max(0, 3 - g.timeouts[0]))}</span></div>
        <div class="sb-mid">
          <div class="q">${g.final ? 'FINAL' : `${fmtQuarter(g.quarter)} · ${fmtClock(g.clock)}`}</div>
          <div class="dd">${g.final ? (g.quarter >= 5 ? 'Overtime' : '') : g.phase === 'play' ? downText(g) : g.phase === 'pat' ? 'PAT' : 'Kickoff'}</div>
          <div class="spot">${g.phase === 'play' && !g.final ? `${g.teams[off].abbr} ball at ${spot(g, off, g.ballOn)}` : ''}</div>
          ${wpNow != null && !g.final ? html`<div class="wpnow" title="win probability">${wpLabel(wpNow, g.teams)}</div>` : ''}
        </div>
        <div class="sb-team ${off === 1 && !g.final ? 'poss' : ''}"><span class="name">${teamChip(away, { responsive: true })}</span><span class="score">${g.score[1]}</span><span class="to">${'●'.repeat(g.timeouts[1])}${'○'.repeat(Math.max(0, 3 - g.timeouts[1]))}</span></div>
      </div>
      <div class="fieldbar" aria-hidden="true">
        <div class="ez left" style="background:${home.color}">${home.abbr}</div><div class="ez right" style="background:${away.color}">${away.abbr}</div>
        ${raw([10, 20, 30, 40, 50, 60, 70, 80, 90].map((x) => `<div class="tick ${x === 50 ? 'half' : ''}" style="left:${6 + x * 0.88}%"></div>`).join(''))}
        ${raw([20, 40, 50, 60, 80].map((x) => `<div class="yard" style="left:${6 + x * 0.88}%">${x > 50 ? 100 - x : x}</div>`).join(''))}
        ${driveFrom != null && driveTo - driveFrom > 0.5
          ? html`<div class="gained" style="left:${6 + driveFrom * 0.88}%;width:${(driveTo - driveFrom) * 0.88}%;background:${g.teams[off].color}"></div>` : ''}
        ${play ? html`<div class="play ${play.kind}" style="left:${6 + play.from * 0.88}%;width:${Math.max(0.6, play.to - play.from) * 0.88}%"></div>` : ''}
        ${fdX != null && fdX > 0 && fdX < 100 ? html`<div class="marker" style="left:${6 + fdX * 0.88}%"></div>` : ''}
        ${g.phase === 'play' ? html`<div class="ball" style="left:${6 + ballX * 0.88}%"></div>` : ''}
        ${g.phase === 'play' ? html`<div class="going ${off === 0 ? 'right' : 'left'}" style="left:${6 + ballX * 0.88}%">${off === 0 ? '▸' : '◂'}</div>` : ''}
      </div>
      ${g.phase === 'play' && g.drive ? html`<div class="drivenote muted">${g.teams[off].abbr} drive: ${g.drive.plays} play${g.drive.plays === 1 ? '' : 's'}, ${g.drive.yards >= 0 ? '' : '−'}${Math.abs(g.drive.yards)} yard${Math.abs(g.drive.yards) === 1 ? '' : 's'}${startX != null ? ` from ${spot(g, off, g.drive.startBallOn)}` : ''}</div>` : ''}
      ${story.length ? html`<div class="card tight" style="margin-bottom:.75rem"><h3>Game story</h3>${raw(story.map((s) => `<p style="margin:.3rem 0;font-size:.92rem">${s}</p>`).join(''))}</div>` : ''}
      <div class="card tight" style="margin-bottom:.75rem">
        ${clockbar}
        ${controls}
        ${last ? html`<div class="callvs">
          <span class="calls"><b>${last.off}</b> <span class="sep">vs</span> <b>${last.def}</b></span>
          ${last.mu && last.mu.verdict !== 'straight' ? html`<span class="edge v-${last.mu.verdict}" title="${last.tip}">${last.mu.delta >= 0 ? '▲ +' : '▼ −'}${Math.abs(last.mu.delta).toFixed(1)}</span>` : ''}
        </div>
        ${last.note ? html`<small class="muted">${last.note}</small>` : ''}` : ''}
      </div>
      ${g.log.length > 2 ? html`<div class="card tight" style="margin-bottom:.75rem">
        <div class="row between" style="font-size:.78rem"><span class="muted">Win probability</span><span><span class="teamdot" style="background:${home.color}"></span>${home.abbr} above the line · <span class="teamdot" style="background:${away.color}"></span>${away.abbr} below</span></div>
        ${raw(wpChart(g.log, g.teams))}
        ${g.drives.length ? html`<details style="margin-top:.4rem"><summary class="muted" style="cursor:pointer;font-size:.8rem">Drive chart · ${g.drives.length} drives</summary>${raw(driveChart(g.drives, g.teams))}</details>` : ''}
        ${!g.final && leaders.some((l) => l.rows.length) ? html`<details class="leaders" style="margin-top:.4rem">
          <summary class="muted" style="cursor:pointer;font-size:.8rem">Leaders${leadSummary ? ` · ${leadSummary}` : ''}</summary>
          ${leaders.map((l) => l.rows.length ? html`<div class="leadside">
            <div class="who"><span class="teamdot" style="background:${l.color}"></span>${l.abbr}</div>
            <ul>${l.rows.map((r) => html`<li><b>${r.name}</b> <span class="muted">${r.line}</span></li>`)}</ul>
          </div>` : '')}
          <a class="muted" href="#/box/live" style="font-size:.78rem">Full box score →</a>
        </details>` : ''}
      </div>` : ''}
      <ul class="pbp card tight" style="padding:0">${raw(logItems)}</ul>
      <p class="muted" style="font-size:.8rem;margin-top:.5rem">${home.name} (home) vs ${away.name}. ${league.phase === 'playoffs' ? 'Playoff rules: overtime continues until someone wins.' : 'Regular season: one 10-minute overtime, ties allowed.'} <a href="#/season">Back to season hub</a> (the game is saved).</p>
    `);

    root.querySelector('#next')?.addEventListener('click', () => act(() => step(g)));
    root.querySelector('#drive')?.addEventListener('click', () => act(() => stepDrive(g)));
    root.querySelector('#quarter')?.addEventListener('click', () => act(() => stepQuarter(g)));
    root.querySelector('#simEnd')?.addEventListener('click', () => { stopAuto(); act(() => simulateGame(g)); });
    root.querySelector('#auto')?.addEventListener('click', () => { if (autoplay) { stopAuto(); draw(); } else startAuto(); });
    root.querySelectorAll('[data-off]').forEach((b) => b.addEventListener('click', () => act(() => step(g, b.dataset.off === 'ai' ? {} : { off: b.dataset.off }))));
    root.querySelectorAll('[data-def]').forEach((b) => b.addEventListener('click', () => act(() => step(g, b.dataset.def === 'ai' ? {} : { def: b.dataset.def }))));
    root.querySelectorAll('[data-pat]').forEach((b) => b.addEventListener('click', () => act(() => step(g, { pat: b.dataset.pat }))));
    root.querySelector('#timeout')?.addEventListener('click', () => act(() => callTimeout(g, userSide)));
    root.querySelectorAll('[data-tempo]').forEach((b) => b.addEventListener('click', () => act(() => setTempo(g, userSide, b.dataset.tempo === 'auto' ? null : b.dataset.tempo))));
    root.querySelector('#finish')?.addEventListener('click', finish);
  }

  function finish() {
    stopAuto();
    takeClock(g, null);
    ctx.update((s) => {
      const lg = s.league;
      const gm = s.game;
      if (gm && gm.phase === lg.phase && gm.weekNo === weekNumber(lg)) {
        const wk = currentWeek(lg);
        const entry = wk.games[gm.entryIdx];
        if (entry && !entry.result) recordResult(lg, weekNumber(lg), entry, g, { keepLog: true });
        simulateWeekAi(lg, ctx.byId);
      }
      s.game = null;
    }, { silent: true });
    ctx.navigate('#/season');
  }

  // Keyboard: space / enter / n advance a play when no call is pending.
  const onKey = (e) => {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (!(e.key === ' ' || e.key === 'Enter' || e.key.toLowerCase() === 'n')) return;
    if (g.final || decision()) return;
    e.preventDefault();
    act(() => step(g));
  };
  document.addEventListener('keydown', onKey);

  draw();
  return () => { stopAuto(); document.removeEventListener('keydown', onKey); };
}

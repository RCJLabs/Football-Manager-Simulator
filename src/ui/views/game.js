import { html, render, raw } from '../../util.js';
import { step, stepDrive, stepQuarter, simulateGame, decisionNeeded, spot, downText } from '../../engine/game.js';
import { OFFENSE_CALLS, DEFENSE_CALLS, fgDistance, fgProbability } from '../../engine/playcall.js';
import { fmtClock, fmtQuarter } from '../../engine/stats.js';
import { currentWeek, simulateWeekAi, recordResult, weekNumber, userTeamIndex } from '../../engine/season.js';
import { teamChip } from '../components.js';

export const selfRendering = true;

const PLAY_HELP = {
  run_in: 'Power between the tackles', run_out: 'Stretch / toss to the edge', screen: 'Beats the blitz', pass_short: 'High percentage', pass_med: 'Intermediate routes',
  pass_deep: 'Take a shot', pa_pass: 'Fake the run, throw', fg: '', punt: '', kneel: 'Run out the clock', spike: 'Stop the clock',
};

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

  const persist = () => ctx.update((s) => { if (s.game) s.game.g = g; }, { silent: true });
  const decision = () => decisionNeeded(g, coach ? userSide : null, coachDef);
  const stopAuto = () => { autoplay = false; clearInterval(timer); timer = null; };
  const startAuto = () => {
    autoplay = true;
    clearInterval(timer);
    timer = setInterval(() => {
      if (g.final || decision()) { stopAuto(); draw(); return; }
      step(g); persist(); draw();
    }, ctx.getState().prefs.autoplayMs || 900);
  };

  function act(fn) { fn(); persist(); draw(); }

  function draw() {
    const dec = decision();
    const off = g.possession;
    const [home, away] = g.teams;
    const ballX = g.phase === 'play' ? (off === 0 ? g.ballOn : 100 - g.ballOn) : 50;
    const fdX = g.phase === 'play' ? (off === 0 ? g.ballOn + g.toGo : 100 - g.ballOn - g.toGo) : null;
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
      controls = html`<div class="btn-group">
        <button class="btn primary" id="next">Next play</button>
        <button class="btn" id="drive">Next drive</button>
        <button class="btn" id="quarter">End of quarter</button>
        <button class="btn" id="simEnd">Sim to end</button>
        <span class="spacer"></span>
        <button class="btn ${autoplay ? 'primary' : ''}" id="auto">${autoplay ? '⏸ Pause' : '▶ Autoplay'}</button>
      </div>`;
    }

    const last = g.lastCall && g.phase !== 'kickoff' && !g.final ? `Last: ${OFFENSE_CALLS[g.lastCall.off]?.label || g.lastCall.off} vs ${DEFENSE_CALLS[g.lastCall.def]?.label || g.lastCall.def}` : '';
    const logItems = g.log.slice().reverse().map((e, i) => {
      const cls = e.type === 'drive' ? 'drive' : e.type === 'injury' ? 'injury' : e.flag && !e.scoring ? 'penalty' : e.type === 'quarter' || e.type === 'final' || e.type === 'info' ? 'quarter' : e.scoring ? 'scoring' : (e.type === 'int' || e.type === 'fumble' || /Turnover on downs/.test(e.text)) ? 'turnover' : '';
      return `<li class="${cls} ${i === 0 ? 'latest' : ''}">${e.situation ? `<span class="sit">${e.situation}</span>` : ''}${e.text}</li>`;
    }).join('');

    render(root, html`
      <div class="scoreboard">
        <div class="sb-team ${off === 0 && !g.final ? 'poss' : ''}"><span class="name">${teamChip(home, { responsive: true })}</span><span class="score">${g.score[0]}</span><span class="to">${'●'.repeat(g.timeouts[0])}${'○'.repeat(Math.max(0, 3 - g.timeouts[0]))}</span></div>
        <div class="sb-mid">
          <div class="q">${g.final ? 'FINAL' : `${fmtQuarter(g.quarter)} · ${fmtClock(g.clock)}`}</div>
          <div class="dd">${g.final ? (g.quarter >= 5 ? 'Overtime' : '') : g.phase === 'play' ? downText(g) : g.phase === 'pat' ? 'PAT' : 'Kickoff'}</div>
          <div class="spot">${g.phase === 'play' && !g.final ? `${g.teams[off].abbr} ball at ${spot(g, off, g.ballOn)}` : ''}</div>
        </div>
        <div class="sb-team ${off === 1 && !g.final ? 'poss' : ''}"><span class="name">${teamChip(away, { responsive: true })}</span><span class="score">${g.score[1]}</span><span class="to">${'●'.repeat(g.timeouts[1])}${'○'.repeat(Math.max(0, 3 - g.timeouts[1]))}</span></div>
      </div>
      <div class="fieldbar" aria-hidden="true">
        <div class="ez left" style="background:${home.color}">${home.abbr}</div><div class="ez right" style="background:${away.color}">${away.abbr}</div>
        ${raw([10, 20, 30, 40, 50, 60, 70, 80, 90].map((x) => `<div class="tick" style="left:${6 + x * 0.88}%"></div>`).join(''))}
        ${fdX != null && fdX > 0 && fdX < 100 ? html`<div class="marker" style="left:${6 + fdX * 0.88}%"></div>` : ''}
        ${g.phase === 'play' ? html`<div class="ball" style="left:${6 + ballX * 0.88}%"></div>` : ''}
      </div>
      <div class="card tight" style="margin-bottom:.75rem">
        ${controls}
        ${last ? html`<small class="muted">${last}</small>` : ''}
      </div>
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
    root.querySelector('#finish')?.addEventListener('click', finish);
  }

  function finish() {
    stopAuto();
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

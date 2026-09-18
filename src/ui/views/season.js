import { html, render, raw, pct } from '../../util.js';
import { currentWeek, userTeamIndex, userGameThisWeek, simulateWeekAi, weekComplete, advanceWeek, standings, powerRankings, teamForGame, gameSeed, weekNumber, recordResult, newSeasonSameRosters } from '../../engine/season.js';
import { createGame, simulateGame } from '../../engine/game.js';
import { fantasyPoints } from '../../engine/stats.js';
import { GM_PERSONALITIES } from '../../data/teams.js';
import { teamChip, toast, modal } from '../components.js';

export function fmtPhase(league) {
  if (league.phase === 'draft') return 'Drafting';
  if (league.phase === 'season') return `Season ${league.season} · Week ${league.week} of ${league.schedule.length}`;
  if (league.phase === 'playoffs') return `Season ${league.season} · Playoffs · ${league.playoffs.rounds[league.playoffs.round - 1].name}`;
  return `Season ${league.season} complete`;
}

export function view(root, params, ctx) {
  const state = ctx.getState();
  const league = state.league;
  if (!league) { ctx.navigate('#/new'); return; }
  if (league.phase === 'draft') { ctx.navigate('#/draft'); return; }
  const u = userTeamIndex(league);
  const me = league.teams[u];
  const wk = currentWeek(league);
  const myGame = userGameThisWeek(league);
  const myGameIdx = wk ? wk.games.indexOf(myGame) : -1;
  const liveGame = state.game && state.game.phase === league.phase && state.game.weekNo === weekNumber(league) ? state.game : null;
  if (state.game && !liveGame) ctx.update((s) => { s.game = null; }, { silent: true });
  const complete = weekComplete(league);
  const rows = standings(league);
  const power = powerRankings(league, ctx.byId);
  const rec = (t) => `${t.record.w}-${t.record.l}${t.record.t ? `-${t.record.t}` : ''}`;

  let matchupCard = '';
  if (league.phase === 'complete') {
    const champ = league.teams[league.champion];
    matchupCard = html`<div class="champ">
      <div style="font-size:3rem">🏆</div>
      <h1>${champ.name} are the champions</h1>
      <p class="muted">Season ${league.season} · ${rec(champ)} in the regular season${champ.isUser ? ' · That\'s you!' : ''}</p>
      <div class="row" style="justify-content:center;margin-top:.75rem">
        <button class="btn primary" id="again">Play another season with these rosters</button>
        <a class="btn" href="#/new">Start a new league</a>
      </div>
    </div>`;
  } else if (myGame) {
    const oppIdx = myGame.home === u ? myGame.away : myGame.home;
    const opp = league.teams[oppIdx];
    const oppPower = power.find((p) => p.idx === oppIdx).power;
    const myPower = power.find((p) => p.idx === u).power;
    const gm = GM_PERSONALITIES.find((g) => g.id === opp.gm);
    matchupCard = html`<div class="card">
      <h3>${league.phase === 'playoffs' ? wk.name : `Week ${league.week}`} · ${myGame.home === u ? 'Home' : 'Away'} vs ${opp.abbr}</h3>
      <div class="matchup mine" style="margin:.5rem 0">
        <div class="side">${teamChip(league.teams[myGame.home], { responsive: true })}<small class="muted">${rec(league.teams[myGame.home])}</small></div>
        <div class="vs">${myGame.result ? html`${myGame.result.score[0]}–${myGame.result.score[1]}${myGame.result.overtime ? ' (OT)' : ''}` : 'vs'}</div>
        <div class="side right"><small class="muted">${rec(league.teams[myGame.away])}</small>${teamChip(league.teams[myGame.away], { responsive: true })}</div>
      </div>
      <p class="muted" style="font-size:.9rem">Power: you ${myPower} · them ${oppPower}${gm ? ` · ${gm.name} GM (${gm.blurb.toLowerCase().replace(/\.$/, '')})` : ''}</p>
      <div class="btn-group">
        ${myGame.result
          ? html`<a class="btn" href="#/box/${league.phase === 'playoffs' ? 'p' : 'w'}/${league.phase === 'playoffs' ? league.playoffs.round : league.week}/${myGameIdx}">Box score</a>`
          : liveGame
            ? html`<a class="btn primary lg" href="#/game">Resume game</a><button class="btn danger" id="abandon">Abandon game</button>`
            : html`<button class="btn primary lg" id="play">Play ${league.settings.coachMode ? '(coach mode)' : '(watch)'}</button><button class="btn" id="simMine">Sim my game</button>`}
        ${!complete ? html`<button class="btn" id="simWeek">Sim ${league.phase === 'playoffs' ? 'round' : 'week'}</button>` : ''}
        ${complete ? html`<button class="btn primary lg" id="advance">${league.phase === 'playoffs' ? 'Next round' : league.week >= league.schedule.length ? 'Start playoffs' : `Advance to week ${league.week + 1}`}</button>` : ''}
      </div>
    </div>`;
  } else if (wk) {
    matchupCard = html`<div class="card">
      <h3>${league.phase === 'playoffs' ? wk.name : `Week ${league.week}`}</h3>
      <p class="muted">${league.phase === 'playoffs' ? 'You have been eliminated from the playoffs. Sim the remaining rounds to crown a champion.' : 'You are idle this week.'}</p>
      <div class="btn-group">
        ${!complete ? html`<button class="btn primary" id="simWeek">Sim ${league.phase === 'playoffs' ? 'round' : 'week'}</button>` : ''}
        ${complete ? html`<button class="btn primary lg" id="advance">${league.phase === 'playoffs' ? 'Next round' : 'Advance'}</button>` : ''}
      </div>
    </div>`;
  }

  const gamesList = (games, kind, weekNo) => games.map((g, i) => {
    const h = league.teams[g.home], a = league.teams[g.away];
    const mine = g.home === u || g.away === u;
    const r = g.result;
    const hw = r && r.score[0] > r.score[1], aw = r && r.score[1] > r.score[0];
    const inner = `<div class="side ${hw ? 'w' : ''}">${teamChip(h, { responsive: true }).__raw}<small class="muted">${rec(h)}</small></div><div class="vs">${r ? `${r.score[0]}–${r.score[1]}${r.overtime ? '<small> OT</small>' : ''}` : 'vs'}</div><div class="side right ${aw ? 'w' : ''}"><small class="muted">${rec(a)}</small>${teamChip(a, { responsive: true }).__raw}</div>`;
    return r ? `<a class="matchup ${mine ? 'mine' : ''}" href="#/box/${kind}/${weekNo}/${i}">${inner}</a>` : `<div class="matchup ${mine ? 'mine' : ''}">${inner}</div>`;
  }).join('');

  const leaders = seasonLeaders(league, ctx.byId);

  render(root, html`<div id="season-view">
    <div class="row between" style="margin-bottom:.75rem">
      <div><h1 style="margin:0">${league.name}</h1><span class="muted">${fmtPhase(league)}</span></div>
      <div class="row">${teamChip(me)} <b>${rec(me)}</b></div>
    </div>
    ${matchupCard}
    <div class="grid grid-2" style="margin-top:1rem">
      <div class="stack">
        ${league.playoffs ? html`<div class="card tight"><h3>Playoffs</h3><div class="bracket">${raw(league.playoffs.rounds.map((r, ri) => `<div><div class="muted" style="font-size:.8rem;margin-bottom:.3rem">${r.name}</div><div class="stack">${gamesList(r.games, 'p', ri + 1)}</div></div>`).join(''))}</div>
          <small class="muted">Seeds: ${league.playoffs.seeds.map((s, i) => `${i + 1}. ${league.teams[s].abbr}`).join(' · ')}</small></div>` : ''}
        ${wk && league.phase === 'season' ? html`<div class="card tight"><h3>Week ${league.week} games</h3><div class="stack">${raw(gamesList(wk.games, 'w', league.week))}</div></div>` : ''}
        <div class="card tight">
          <h3>Standings</h3>
          <div class="table-wrap"><table class="standings">
            <thead><tr><th>#</th><th>Team</th><th class="num">W</th><th class="num">L</th><th class="num hide-sm">T</th><th class="num hide-sm">PCT</th><th class="num hide-sm">PF</th><th class="num hide-sm">PA</th><th class="num">Diff</th></tr></thead>
            <tbody>${raw(rows.map((r, i) => `<tr class="clickable ${r.team.isUser ? 'me' : ''}" data-team="${r.idx}"><td>${i + 1}</td><td>${teamChip(r.team).__raw}</td><td class="num">${r.w}</td><td class="num">${r.l}</td><td class="num hide-sm">${r.t}</td><td class="num hide-sm">${r.gp ? r.pct.toFixed(3).replace(/^0/, '') : '—'}</td><td class="num hide-sm">${r.pf}</td><td class="num hide-sm">${r.pa}</td><td class="num">${r.diff > 0 ? '+' : ''}${r.diff}</td></tr>`).join(''))}</tbody>
          </table></div>
        </div>
        <details class="card tight"><summary style="cursor:pointer"><b>Full schedule &amp; results</b></summary>
          <div class="stack" style="margin-top:.5rem">${raw(league.schedule.map((w) => `<div><div class="muted" style="font-size:.8rem;margin:.4rem 0 .2rem">Week ${w.week}${w.week === league.week && league.phase === 'season' ? ' (current)' : ''}</div><div class="stack">${gamesList(w.games, 'w', w.week)}</div></div>`).join(''))}</div>
        </details>
      </div>
      <div class="stack">
        <div class="card tight">
          <h3>Season leaders</h3>
          ${leaders.length ? raw(leaders.map((l) => `<div style="margin-bottom:.6rem"><div class="muted" style="font-size:.75rem;text-transform:uppercase;letter-spacing:.04em">${l.title}</div>${l.rows.map((r) => `<div class="row between" style="font-size:.88rem;flex-wrap:nowrap;gap:.5rem"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><span class="teamdot" style="background:${r.team.color}"></span>${r.p.name} <small class="muted">${r.p.pos}</small></span><b class="mono">${r.val}</b></div>`).join('')}</div>`).join('')) : html`<p class="muted">No games played yet.</p>`}
        </div>
        <div class="card tight">
          <h3>Power rankings</h3>
          <div class="table-wrap"><table><tbody>${raw(power.map((p, i) => { const gm = GM_PERSONALITIES.find((g) => g.id === p.team.gm); return `<tr class="clickable ${p.team.isUser ? 'me' : ''}" data-team="${p.idx}"><td>${i + 1}</td><td>${teamChip(p.team).__raw}</td><td class="hide-sm">${gm ? `<span class="badge gm">${gm.name}</span>` : '<span class="badge">You</span>'}</td><td class="num"><b>${p.power}</b></td></tr>`; }).join(''))}</tbody></table></div>
        </div>
        ${league.history && league.history.length ? html`<div class="card tight"><h3>Past champions</h3>${raw(league.history.map((h) => `<div class="row between"><span>Season ${h.season}</span>${teamChip(league.teams[h.champion]).__raw}</div>`).join(''))}</div>` : ''}
      </div>
    </div>
  </div>`);

  root.querySelector('#season-view').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-team]');
    if (tr) ctx.navigate(`#/team/${tr.dataset.team}`);
  });
  root.querySelector('#play')?.addEventListener('click', () => {
    const g = createGame(teamForGame(league, myGame.home, ctx.byId), teamForGame(league, myGame.away, ctx.byId), { seed: gameSeed(league, weekNumber(league), myGame.home, myGame.away), playoff: league.phase === 'playoffs' });
    ctx.update((s) => { s.game = { weekNo: weekNumber(league), phase: league.phase, entryIdx: myGameIdx, g }; }, { silent: true });
    ctx.navigate('#/game');
  });
  root.querySelector('#simMine')?.addEventListener('click', () => {
    ctx.update((s) => {
      const lg = s.league;
      const w = currentWeek(lg);
      const entry = w.games[myGameIdx];
      const g = createGame(teamForGame(lg, entry.home, ctx.byId), teamForGame(lg, entry.away, ctx.byId), { seed: gameSeed(lg, weekNumber(lg), entry.home, entry.away), playoff: lg.phase === 'playoffs' });
      simulateGame(g);
      recordResult(lg, weekNumber(lg), entry, g, { keepLog: true });
      simulateWeekAi(lg, ctx.byId);
    });
  });
  root.querySelector('#simWeek')?.addEventListener('click', () => {
    ctx.update((s) => { simulateWeekAi(s.league, ctx.byId, { includeUser: true }); s.game = null; });
  });
  root.querySelector('#advance')?.addEventListener('click', () => {
    ctx.update((s) => { advanceWeek(s.league); });
  });
  root.querySelector('#abandon')?.addEventListener('click', () => {
    const m = modal(html`<h2>Abandon the game in progress?</h2><p class="muted">You'll be able to start it over from the season hub.</p><div class="row"><button class="btn danger" id="yes">Abandon</button><button class="btn" data-close>Cancel</button></div>`);
    m.el.querySelector('#yes').addEventListener('click', () => { m.close(); ctx.update((s) => { s.game = null; }); });
  });
  root.querySelector('#again')?.addEventListener('click', () => {
    ctx.update((s) => { newSeasonSameRosters(s.league); s.game = null; });
    toast(`Season ${league.season + 1} begins`);
  });
}

function seasonLeaders(league, byId) {
  const all = [];
  for (const team of league.teams) {
    for (const [pid, s] of Object.entries(team.seasonStats.players)) {
      const p = byId.get(pid);
      if (p) all.push({ p, team, s });
    }
  }
  if (!all.length) return [];
  const top = (title, get, fmt = (v) => v) => {
    const rows = all.map((r) => ({ ...r, v: get(r.s) })).filter((r) => r.v > 0).sort((a, b) => b.v - a.v).slice(0, 3).map((r) => ({ p: r.p, team: r.team, val: fmt(r.v) }));
    return rows.length ? { title, rows } : null;
  };
  return [
    top('Passing yards', (s) => s.pass.yds),
    top('Rushing yards', (s) => s.rush.yds),
    top('Receiving yards', (s) => s.rec.yds),
    top('Touchdowns', (s) => s.rush.td + s.rec.td + s.def.td + s.ret.td),
    top('Sacks', (s) => s.def.sck),
    top('Interceptions', (s) => s.def.int),
    top('Fantasy points', (s) => fantasyPoints(s), (v) => v.toFixed(1)),
  ].filter(Boolean);
}

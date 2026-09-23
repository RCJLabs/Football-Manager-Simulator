import { html, render, raw, pct } from '../../util.js';
import { fantasyPoints, fmtClock, fmtQuarter } from '../../engine/stats.js';
import { teamChip, esc } from '../components.js';
import { replacementFromId, fmtWeeks } from '../../engine/injuries.js';
import { wpChart, driveChart, gameStory } from '../charts.js';
import { conditionsLine } from '../../engine/weather.js';

export function view(root, params, ctx) {
  const state = ctx.getState();
  const league = state.league;
  if (!league) { ctx.navigate('#/'); return; }
  let box;
  if (params.kind === 'live') {
    if (!state.game) { ctx.navigate('#/season'); return; }
    const g = state.game.g;
    box = { teams: g.teams, score: g.score, teamStats: [g.stats[0].team, g.stats[1].team], players: [g.stats[0].players, g.stats[1].players], log: g.log, drives: g.drives, overtime: g.quarter >= 5, final: g.final, back: '#/game', injuries: g.teams.map((t) => t.injuries || []), weather: g.weather };
  } else {
    const list = params.kind === 'p' ? league.playoffs?.rounds[Number(params.a) - 1]?.games : league.schedule[Number(params.a) - 1]?.games;
    const entry = list && list[Number(params.b)];
    if (!entry || !entry.result) { render(root, html`<div class="card"><p class="empty">No box score for that game.</p><a class="btn" href="#/season">Back</a></div>`); return; }
    const r = entry.result;
    box = { teams: [league.teams[entry.home], league.teams[entry.away]], score: r.score, teamStats: r.teamStats, players: r.players, log: r.log, drives: r.drives, overtime: r.overtime, final: true, back: '#/season', injuries: r.injuries || [[], []], thinned: !!r.thinned, weather: r.weather,
      title: params.kind === 'p' ? league.playoffs.rounds[Number(params.a) - 1].name : `Week ${params.a}` };
  }
  const [h, a] = box.teams;
  const ts = box.teamStats;
  const cmp = (label, f, fmt = (v) => v) => `<div class="l">${fmt(f(ts[0]))}</div><div class="m">${label}</div><div>${fmt(f(ts[1]))}</div>`;
  const scoring = (box.log || []).filter((e) => e.scoring);
  // A thinned log carries bare { q, wp } points so the win-probability chart
  // keeps its shape; they have nothing to print, so the list skips them.
  const plays = (box.log || []).filter((e) => e.text);
  const story = box.final && box.log ? gameStory(box, ctx.byId) : [];
  const wp = box.log ? wpChart(box.log, box.teams) : '';
  const drives = box.drives ? driveChart(box.drives, box.teams) : '';
  const injuryRows = (box.injuries || []).flatMap((list, side) => list.map((x) => {
    const p = ctx.byId.get(x.id);
    const when = x.weeks === 0 ? 'left the game' : `out ${fmtWeeks(x.weeks)}`;
    return `<li>${teamChip(box.teams[side], { abbr: true }).__raw} <b>${esc(p ? p.name : x.name || x.id)}</b> <small class="muted">${p ? p.pos : x.pos || ''}</small> — ${esc(x.kind)}, ${when}</li>`;
  })).join('');

  const tables = (side) => {
    if (!box.players) return '<p class="muted" style="font-size:.85rem">Player lines are kept for your games and the playoffs; this one has team totals only. Season totals for everyone are on their team page.</p>';
    const P = box.players[side];
    const rows = Object.entries(P).map(([id, s]) => ({ p: ctx.byId.get(id) || replacementFromId(id), s })).filter((r) => r.p);
    const tbl = (title, cols, filter, sortBy) => {
      const rs = rows.filter(filter).sort((x, y) => sortBy(y.s) - sortBy(x.s));
      if (!rs.length) return '';
      return `<h3 style="margin-top:.75rem">${title}</h3><div class="table-wrap"><table><thead><tr><th>Player</th>${cols.map((c) => `<th class="num">${c[0]}</th>`).join('')}</tr></thead><tbody>${rs.map((r) => `<tr><td><b>${esc(r.p.name)}</b> <small class="muted">${r.p.pos}</small>${r.p.replacement ? ' <span class="badge rep">fill-in</span>' : ''}</td>${cols.map((c) => `<td class="num">${c[1](r.s)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    };
    return `
      ${tbl('Passing', [['C/ATT', (s) => `${s.pass.cmp}/${s.pass.att}`], ['YDS', (s) => s.pass.yds], ['TD', (s) => s.pass.td], ['INT', (s) => s.pass.int], ['SCK', (s) => s.pass.sck], ['LNG', (s) => s.pass.lng]], (r) => r.s.pass.att > 0 || r.s.pass.sck > 0, (s) => s.pass.yds)}
      ${tbl('Rushing', [['ATT', (s) => s.rush.att], ['YDS', (s) => s.rush.yds], ['AVG', (s) => (s.rush.att ? (s.rush.yds / s.rush.att).toFixed(1) : '—')], ['TD', (s) => s.rush.td], ['LNG', (s) => s.rush.lng], ['FUM', (s) => s.rush.fum]], (r) => r.s.rush.att > 0, (s) => s.rush.yds)}
      ${tbl('Receiving', [['TGT', (s) => s.rec.tgt], ['REC', (s) => s.rec.rec], ['YDS', (s) => s.rec.yds], ['TD', (s) => s.rec.td], ['LNG', (s) => s.rec.lng]], (r) => r.s.rec.tgt > 0, (s) => s.rec.yds)}
      ${tbl('Defense', [['TKL', (s) => s.def.tkl], ['SCK', (s) => s.def.sck], ['INT', (s) => s.def.int], ['PD', (s) => s.def.pd], ['FF', (s) => s.def.ff], ['FR', (s) => s.def.fr], ['TD', (s) => s.def.td]], (r) => Object.values(r.s.def).some((v) => v > 0), (s) => s.def.tkl + s.def.sck * 2 + s.def.int * 3)}
      ${tbl('Kicking & punting', [['FG', (s) => `${s.k.fgm}/${s.k.fga}`], ['LNG', (s) => s.k.lng], ['XP', (s) => `${s.k.xpm}/${s.k.xpa}`], ['PUNTS', (s) => s.p.n], ['AVG', (s) => (s.p.n ? (s.p.yds / s.p.n).toFixed(1) : '—')], ['IN20', (s) => s.p.in20]], (r) => r.s.k.fga + r.s.k.xpa + r.s.p.n > 0, (s) => s.k.fgm * 3 + s.k.xpm + s.p.n)}
      ${tbl('Returns', [['KR', (s) => s.ret.kr], ['YDS', (s) => s.ret.krYds], ['PR', (s) => s.ret.pr], ['YDS', (s) => s.ret.prYds], ['TD', (s) => s.ret.td]], (r) => r.s.ret.kr + r.s.ret.pr > 0, (s) => s.ret.krYds + s.ret.prYds)}
      ${tbl('Fantasy (PPR)', [['PTS', (s) => fantasyPoints(s).toFixed(1)]], (r) => fantasyPoints(r.s) >= 5, (s) => fantasyPoints(s))}`;
  };

  render(root, html`
    <div class="row between" style="margin-bottom:.75rem"><a class="btn sm" href="${box.back}">← Back</a>${box.title ? html`<span class="muted">${box.title}</span>` : ''}</div>
    <div class="scoreboard">
      <div class="sb-team"><span class="name">${teamChip(h, { responsive: true })}</span><span class="score">${box.score[0]}</span></div>
      <div class="sb-mid"><div class="q">${box.final ? 'FINAL' : 'IN PROGRESS'}</div><div class="dd">${box.overtime ? 'OT' : ''}</div></div>
      <div class="sb-team"><span class="name">${teamChip(a, { responsive: true })}</span><span class="score">${box.score[1]}</span></div>
    </div>
    ${box.weather ? html`<p class="muted wxline">${conditionsLine(box.weather)}</p>` : ''}
    <div class="card tight" style="margin-top:.75rem">
      <div class="stat-compare">
        ${raw(cmp('Total yards', (t) => t.totalYds))}
        ${raw(cmp('Passing', (t) => t.passYds))}
        ${raw(cmp('Rushing', (t) => t.rushYds))}
        ${raw(cmp('Comp / Att', (t) => `${t.passCmp}/${t.passAtt}`))}
        ${raw(cmp('Rush attempts', (t) => t.rushAtt))}
        ${raw(cmp('First downs', (t) => t.firstDowns))}
        ${raw(cmp('3rd down', (t) => `${t.thirdConv}/${t.thirdAtt}`))}
        ${raw(cmp('4th down', (t) => `${t.fourthConv}/${t.fourthAtt}`))}
        ${raw(cmp('Red zone TD', (t) => `${t.redZoneTd}/${t.redZoneAtt}`))}
        ${raw(cmp('Turnovers', (t) => t.turnovers))}
        ${raw(cmp('Penalties', (t) => `${t.penalties || 0}-${t.penYds || 0}`))}
        ${raw(cmp('Sacks allowed', (t) => t.sacksAllowed))}
        ${raw(cmp('Plays', (t) => t.plays))}
        ${raw(cmp('Possession', (t) => fmtClock(t.top)))}
      </div>
    </div>
    ${story.length ? html`<div class="card tight" style="margin-top:.75rem"><h3>Game story</h3>${raw(story.map((s) => `<p style="margin:.3rem 0;font-size:.92rem">${s}</p>`).join(''))}</div>` : ''}
    ${wp || drives ? html`<div class="card tight" style="margin-top:.75rem">
      ${wp ? html`<div class="row between" style="font-size:.78rem"><span class="muted">Win probability</span><span><span class="teamdot" style="background:${h.color}"></span>${h.abbr} above the line · <span class="teamdot" style="background:${a.color}"></span>${a.abbr} below</span></div>${raw(wp)}` : ''}
      ${drives ? html`<div class="muted" style="font-size:.78rem;margin-top:.5rem">Drives</div>${raw(drives)}` : ''}
    </div>` : ''}
    ${injuryRows ? html`<div class="card tight" style="margin-top:.75rem"><h3>Injuries</h3><ul class="plain ticker">${raw(injuryRows)}</ul></div>` : ''}
    ${scoring.length ? html`<div class="card tight" style="margin-top:.75rem"><h3>Scoring summary</h3><ul class="plain ticker">${raw(scoring.map((e) => `<li><small class="muted">${fmtQuarter(e.q)} ${fmtClock(e.clock)}</small> ${e.text} <b class="mono">${e.score ? `${e.score[0]}–${e.score[1]}` : ''}</b></li>`).join(''))}</ul></div>` : ''}
    <div class="grid grid-2" style="margin-top:.75rem">
      <div class="card tight"><h2 style="font-size:1rem">${teamChip(h)}</h2>${raw(tables(0))}</div>
      <div class="card tight"><h2 style="font-size:1rem">${teamChip(a)}</h2>${raw(tables(1))}</div>
    </div>
    ${plays.length ? html`<details class="card tight" style="margin-top:.75rem"><summary style="cursor:pointer"><b>${box.thinned ? 'How it went' : 'Full play-by-play'}</b></summary>${box.thinned ? html`<p class="muted" style="margin:.4rem 0 0;font-size:.78rem">Scores, flags, turnovers and injuries. Once a season is over its routine plays are dropped, because a pro save keeps seventeen play-by-plays and they are the biggest thing in it.</p>` : ''}<ul class="pbp" style="max-height:none;margin-top:.5rem">${raw(plays.map((e) => `<li class="${e.type === 'drive' ? 'drive' : e.flag ? 'penalty' : e.scoring ? 'scoring' : e.type === 'int' || e.type === 'fumble' ? 'turnover' : e.type === 'injury' ? 'injury' : ''}">${e.situation ? `<span class="sit">${e.situation}</span>` : ''}${e.text}</li>`).join(''))}</ul></details>` : ''}
  `);
}

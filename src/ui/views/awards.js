import { html, render, raw } from '../../util.js';
import { POSITION_ORDER } from '../../data/positions.js';
import { seasonAwards, hallOfFame, RECORD_LABELS, TEAM_RECORD_LABELS, HOF_THRESHOLD, HOF_MIN_SEASONS } from '../../engine/awards.js';
import { playerModal, teamChip, esc, posBadge } from '../components.js';

const ui = { tab: 'race' };
const TABS = [['race', 'This season'], ['honours', 'Honours'], ['records', 'Records'], ['hall', 'Hall of Fame']];

export function view(root, params, ctx) {
  const { league } = ctx.getState();
  if (!league) { ctx.navigate('#/new'); return; }
  if (league.phase === 'draft') { ctx.navigate(league.draftType === 'auction' ? '#/auction' : '#/draft'); return; }
  if (params && params.tab) { if (TABS.some(([k]) => k === params.tab)) ui.tab = params.tab; delete params.tab; }
  const byId = ctx.byId;
  const name = (id) => esc(byId.get(id)?.name || id);
  const who = (e) => (e ? `<span class="tap" data-show="${esc(e.id)}"><b>${name(e.id)}</b></span> ${posBadge(byId.get(e.id)?.pos || '').__raw} ${teamChip(league.teams[e.team], { abbr: true }).__raw}` : '<span class="muted">—</span>');
  const played = league.teams.some((t) => t.record.w + t.record.l + t.record.t > 0);

  let body;
  if (ui.tab === 'race') {
    if (!played && league.phase === 'season') body = html`<p class="empty">No games played yet. Come back after week 1.</p>`;
    else {
      const a = seasonAwards(league, byId);
      const race = a.mvpRace.map((e, i) => `<li class="${league.teams[e.team].isUser ? 'me' : ''}"><small class="muted">${i + 1}.</small> ${who(e)} <small class="muted">${esc(e.line)} · ${e.pts} pts · score ${e.score}</small></li>`).join('');
      const honour = (label, e) => `<div class="row between" style="gap:.5rem;padding:.25rem 0;border-bottom:1px solid var(--line)"><span class="muted" style="font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;min-width:7rem">${label}</span><span style="text-align:right;font-size:.9rem">${e ? `${who(e)}<br><small class="muted">${esc(e.line)}</small>` : '<span class="muted">—</span>'}</span></div>`;
      const all = POSITION_ORDER.filter((pos) => a.allLeague[pos]).map((pos) => `<div style="margin:.35rem 0"><span class="badge pos">${pos}</span> ${a.allLeague[pos].map((e) => who(e)).join(' · ') || '<span class="muted">—</span>'}</div>`).join('');
      body = html`
        <p class="muted" style="margin:0 0 .5rem;font-size:.85rem">${league.phase === 'season' ? `The race after ${a.games} game${a.games === 1 ? '' : 's'}. Players need half the season to qualify.` : 'Final honours for the season.'} MVP scores each player against his own position first, then by how much the position matters.</p>
        <div class="grid grid-2">
          <div class="card tight"><h3>MVP race</h3><ol class="plain ticker" style="max-height:none">${raw(race || '<li class="muted">Nobody qualifies yet.</li>')}</ol></div>
          <div class="card tight"><h3>Honours</h3>
            ${raw(honour('Offensive player', a.offensive))}${raw(honour('Defensive player', a.defensive))}${raw(honour('Kicker', a.kicker))}
            <div class="row between" style="gap:.5rem;padding:.25rem 0"><span class="muted" style="font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;min-width:7rem">Coach</span><span>${a.coach != null ? raw(teamChip(league.teams[a.coach]).__raw) : '—'}</span></div>
          </div>
        </div>
        <div class="card tight" style="margin-top:.75rem"><h3>All-league team</h3>${raw(all)}<small class="muted">Linemen keep no statistics, so the line is not picked.</small></div>`;
    }
  } else if (ui.tab === 'honours') {
    const seasons = (league.history || []).slice().reverse();
    body = seasons.length ? raw(seasons.map((h) => {
      const aw = h.awards;
      return `<div class="card tight" style="margin-bottom:.75rem"><div class="row between"><h3 style="margin:0">Season ${h.season}</h3><span>🏆 ${teamChip(league.teams[h.champion], { responsive: true }).__raw}</span></div>
        ${aw ? `<div class="kv" style="margin-top:.4rem"><dt>MVP</dt><dd>${who(aw.mvp)}${aw.mvp ? ` <small class="muted">${esc(aw.mvp.line)}</small>` : ''}</dd><dt>Offense</dt><dd>${who(aw.offensive)}</dd><dt>Defense</dt><dd>${who(aw.defensive)}</dd><dt>Kicker</dt><dd>${who(aw.kicker)}</dd><dt>Coach</dt><dd>${aw.coach != null ? teamChip(league.teams[aw.coach], { abbr: true }).__raw : '—'}</dd></div>
        <details style="margin-top:.4rem"><summary class="muted" style="cursor:pointer;font-size:.85rem">All-league team and leaders</summary>
          ${POSITION_ORDER.filter((pos) => aw.allLeague[pos]).map((pos) => `<div style="margin:.3rem 0"><span class="badge pos">${pos}</span> ${aw.allLeague[pos].map((e) => who(e)).join(' · ') || '—'}</div>`).join('')}
          <div class="muted" style="font-size:.8rem;margin-top:.4rem">${Object.entries(aw.leaders).filter(([, e]) => e).map(([k, e]) => `${RECORD_LABELS[k] ? RECORD_LABELS[k].replace(', season', '') : k}: ${name(e.id)} (${e.value})`).join(' · ')}</div>
        </details>` : '<small class="muted">No honours recorded for this season.</small>'}
      </div>`;
    }).join('')) : html`<p class="empty">No completed seasons yet.</p>`;
  } else if (ui.tab === 'records') {
    const R = league.records?.players || {}, T = league.records?.teams || {};
    const row = (label, r, extra) => `<tr><td>${label}</td><td class="num"><b>${r.value}</b></td><td>${extra}</td><td class="num muted hide-sm">S${r.season}</td></tr>`;
    const playerRows = Object.entries(RECORD_LABELS).filter(([k]) => R[k]).map(([k, label]) => row(label, R[k], `${who(R[k])}${R[k].vs != null ? ` <small class="muted">vs ${esc(league.teams[R[k].vs].abbr)}</small>` : ''}`)).join('');
    const teamRows = Object.entries(TEAM_RECORD_LABELS).filter(([k]) => T[k]).map(([k, label]) => row(label, T[k], `${teamChip(league.teams[T[k].team], { abbr: true }).__raw}${T[k].vs != null ? ` <small class="muted">vs ${esc(league.teams[T[k].vs].abbr)}</small>` : ''}`)).join('');
    body = playerRows || teamRows ? html`
      <p class="muted" style="margin:0 0 .5rem;font-size:.85rem">Season and team records cover every club. Single-game records come from games that kept player lines: yours and the playoffs.</p>
      <div class="card tight"><h3>Players</h3><div class="table-wrap"><table><tbody>${raw(playerRows || '<tr><td class="muted">Nothing yet.</td></tr>')}</tbody></table></div></div>
      <div class="card tight" style="margin-top:.75rem"><h3>Teams</h3><div class="table-wrap"><table><tbody>${raw(teamRows || '<tr><td class="muted">Nothing yet.</td></tr>')}</tbody></table></div></div>` : html`<p class="empty">The record book opens when a season ends.</p>`;
  } else {
    const { inducted, onTrack } = hallOfFame(league);
    const resume = (r) => {
      const c = r.c;
      const bits = [`${c.seasons} season${c.seasons === 1 ? '' : 's'}`, c.titles ? `${c.titles} title${c.titles > 1 ? 's' : ''}` : '', c.mvp ? `${c.mvp}× MVP` : '', c.opoy ? `${c.opoy}× OPOY` : '', c.dpoy ? `${c.dpoy}× DPOY` : '', c.allLeague ? `${c.allLeague}× all-league` : '', c.leader ? `${c.leader}× leader` : ''].filter(Boolean);
      const p = byId.get(r.id);
      const totals = p ? (p.pos === 'QB' ? `${c.passYds} pass yds, ${c.passTd} TD` : ['RB'].includes(p.pos) ? `${c.rushYds} rush yds, ${c.rushTd + c.recTd} TD` : ['WR', 'TE'].includes(p.pos) ? `${c.recYds} rec yds, ${c.recTd} TD` : p.pos === 'K' ? `${c.fieldGoals} FG` : p.pos === 'P' ? '' : `${c.tackles} tkl, ${c.sacks} sck, ${c.interceptions} INT`) : '';
      return `<li><span class="tap" data-show="${esc(r.id)}"><b>${name(r.id)}</b></span> ${posBadge(p?.pos || '').__raw} <small class="muted">${bits.join(' · ')}${totals ? ` · ${totals}` : ''} · score <b>${r.score}</b></small></li>`;
    };
    body = html`
      <p class="muted" style="margin:0 0 .5rem;font-size:.85rem">A résumé score: a point a season, four for an MVP, two for a player-of-the-year award or a title, one and a half per all-league selection, half per statistical title, plus a point per 300 fantasy points. Induction at ${HOF_THRESHOLD} with at least ${HOF_MIN_SEASONS} seasons.</p>
      <div class="card tight"><h3>Inducted</h3>${inducted.length ? raw(`<ul class="plain ticker" style="max-height:none">${inducted.map(resume).join('')}</ul>`) : html`<p class="muted" style="margin:0">Nobody yet. Play a few seasons.</p>`}</div>
      <div class="card tight" style="margin-top:.75rem"><h3>Building a case</h3>${onTrack.length ? raw(`<ul class="plain ticker" style="max-height:none">${onTrack.map(resume).join('')}</ul>`) : html`<p class="muted" style="margin:0">Careers start counting when a season ends.</p>`}</div>`;
  }

  render(root, html`<div id="awards-view">
    <div class="card tight">
      <div class="row between"><h2 style="margin:0">Awards &amp; records</h2><small class="muted">${league.name}</small></div>
      <div class="tabs" id="tabs" style="margin-top:.5rem">${raw(TABS.map(([k, label]) => `<button class="tab ${ui.tab === k ? 'active' : ''}" data-tab="${k}">${label}</button>`).join(''))}</div>
    </div>
    <div style="margin-top:.75rem">${body}</div>
  </div>`);
  const el = root.querySelector('#awards-view');
  el.querySelector('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { ui.tab = b.dataset.tab; view(root, params, ctx); } });
  el.addEventListener('click', (e) => { const show = e.target.closest('[data-show]'); if (show && byId.get(show.dataset.show)) playerModal(byId.get(show.dataset.show)); });
}

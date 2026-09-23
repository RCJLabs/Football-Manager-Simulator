import { html, render, raw } from '../../util.js';
import { POSITION_ORDER } from '../../data/positions.js';
import { seasonAwards, hallOfFame, RECORD_LABELS, TEAM_RECORD_LABELS, HOF_THRESHOLD, HOF_MIN_SEASONS } from '../../engine/awards.js';
import { playerModal, teamChip, esc, posBadge, toast } from '../components.js';
import { seasonResult, encodeResultCode, decodeResultCode, compareResults, cardSeasons, fmtRecord } from '../../engine/result.js';
import { drawSeasonCard, shareCanvas } from '../share-card.js';
import { seasonTeamStats, rankTeams, TEAM_CATEGORIES, CATEGORY_BY_KEY, fmtCategory } from '../../engine/teamstats.js';

const ui = { tab: 'race', cardSeason: null, theirs: null, error: '', paste: '', statCat: 'dppg' };
const TABS = [['race', 'This season'], ['teams', 'Team stats'], ['honours', 'Honours'], ['records', 'Records'], ['hall', 'Hall of Fame'], ['card', 'Season card']];

export function view(root, params, ctx) {
  const { league } = ctx.getState();
  if (!league) { ctx.navigate('#/new'); return; }
  if (league.phase === 'draft') { ctx.navigate(league.draftType === 'auction' ? '#/auction' : '#/draft'); return; }
  if (params && params.tab) { if (TABS.some(([k]) => k === params.tab)) ui.tab = params.tab; delete params.tab; }
  const ordOf = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const byId = ctx.byId;
  const name = (id) => esc(byId.get(id)?.name || id);
  const who = (e) => (e ? `<button type="button" class="tap" data-show="${esc(e.id)}"><b>${name(e.id)}</b></button> ${posBadge(byId.get(e.id)?.pos || '').__raw} ${teamChip(league.teams[e.team], { abbr: true }).__raw}` : '<span class="muted">—</span>');
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
  } else if (ui.tab === 'teams') {
    // Both sides of the ball. The offence was always recorded; the defence is
    // derived from what opponents did, so it covers every game already played.
    const rows = seasonTeamStats(league);
    const anyGames = rows.some((r) => r.games > 0);
    const u = league.teams.findIndex((t) => t.isUser);
    const n = rows.filter((r) => r.games > 0).length;
    const chip = (r) => teamChip(r.team, { abbr: true }).__raw;
    const groups = [['off', 'Offence'], ['def', 'Defence'], ['both', 'Overall']];
    if (!anyGames) {
      body = html`<p class="empty">Team statistics start with the first week's games.</p>`;
    } else {
      // The best at everything, which is the question most people open this for.
      const leaderRow = (cat) => {
        const top = rankTeams(rows, cat)[0];
        if (!top || top.rank == null) return '';
        const mine = top.idx === u ? ' <span class="badge bargain">you</span>' : '';
        // Only the figure is unbreakable. Holding the whole cell on one line let
        // a long label plus a club chip plus a "you" badge run past the screen,
        // and whether it did depended on which rows the human happened to lead.
        return `<tr><td>${esc(cat.label)}</td><td class="num"><b class="stat-v" style="white-space:nowrap">${esc(fmtCategory(cat, top.v))}</b> ${chip(top)}${mine}</td></tr>`;
      };
      const leaders = groups.map(([side, label]) => {
        const body = TEAM_CATEGORIES.filter((c) => c.side === side).map(leaderRow).join('');
        return body ? `<h3 style="margin:.6rem 0 .2rem">${label}</h3><div class="table-wrap"><table style="font-size:.88rem"><tbody>${body}</tbody></table></div>` : '';
      }).join('');

      // Where your own club stands, which is what a general manager acts on.
      const third = Math.max(1, Math.round(n / 3));
      const mineRow = (cat) => {
        const r = rankTeams(rows, cat).find((x) => x.idx === u);
        if (!r || r.rank == null) return `<tr><td>${esc(cat.label)}</td><td class="num muted">—</td></tr>`;
        const tone = r.rank <= third ? 'bargain' : r.rank > n - third ? 'overpay' : '';
        return `<tr><td>${esc(cat.label)}</td><td class="num"><b class="stat-v" style="white-space:nowrap">${esc(fmtCategory(cat, r.v))}</b> <span class="badge ${tone}" style="white-space:nowrap">${r.rank} of ${n}</span></td></tr>`;
      };
      const mine = u >= 0 ? groups.map(([side, label]) => {
        const body = TEAM_CATEGORIES.filter((c) => c.side === side).map(mineRow).join('');
        return `<h3 style="margin:.6rem 0 .2rem">${label}</h3><div class="table-wrap"><table style="font-size:.88rem"><tbody>${body}</tbody></table></div>`;
      }).join('') : '';

      // The whole league in one category.
      const cat = CATEGORY_BY_KEY[ui.statCat] || TEAM_CATEGORIES[0];
      const ranked = rankTeams(rows, cat);
      const options = groups.map(([side, label]) => `<optgroup label="${label}">${TEAM_CATEGORIES.filter((c) => c.side === side).map((c) => `<option value="${c.key}" ${c.key === cat.key ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</optgroup>`).join('');
      const tableRows = ranked.map((r) => `<tr class="${r.idx === u ? 'me' : ''}"><td class="num muted">${r.rank ?? '—'}</td><td>${chip(r)}</td><td class="num"><b>${esc(fmtCategory(cat, r.v))}</b></td><td class="num muted hide-sm">${r.games} gp</td></tr>`).join('');

      body = html`
        <p class="muted" style="margin:0 0 .5rem;font-size:.85rem">Regular season, every club. A defence is measured by what its opponents did against it.</p>
        <div class="card tight"><h3 style="margin-top:0">League leaders</h3>${raw(leaders)}</div>
        ${u >= 0 ? html`<div class="card tight" style="margin-top:.75rem"><h3 style="margin-top:0">Where you stand</h3>${raw(mine)}</div>` : ''}
        <div class="card tight" style="margin-top:.75rem">
          <h3 style="margin-top:0">Every club</h3>
          <select id="statCat" aria-label="Category" style="max-width:100%;margin-bottom:.5rem">${raw(options)}</select>
          <div class="table-wrap"><table style="font-size:.9rem"><thead><tr><th class="num">#</th><th>Club</th><th class="num">${esc(cat.label)}</th><th class="num hide-sm">Games</th></tr></thead><tbody>${raw(tableRows)}</tbody></table></div>
        </div>`;
    }
  } else if (ui.tab === 'records') {
    const R = league.records?.players || {}, T = league.records?.teams || {};
    const row = (label, r, extra) => `<tr><td>${label}</td><td class="num"><b>${r.value}</b></td><td>${extra}</td><td class="num muted hide-sm">S${r.season}</td></tr>`;
    const playerRows = Object.entries(RECORD_LABELS).filter(([k]) => R[k]).map(([k, label]) => row(label, R[k], `${who(R[k])}${R[k].vs != null ? ` <small class="muted">vs ${esc(league.teams[R[k].vs].abbr)}</small>` : ''}`)).join('');
    const teamRows = Object.entries(TEAM_RECORD_LABELS).filter(([k]) => T[k]).map(([k, label]) => row(label, T[k], `${teamChip(league.teams[T[k].team], { abbr: true }).__raw}${T[k].vs != null ? ` <small class="muted">vs ${esc(league.teams[T[k].vs].abbr)}</small>` : ''}`)).join('');
    body = playerRows || teamRows ? html`
      <p class="muted" style="margin:0 0 .5rem;font-size:.85rem">Season and team records cover every club. Single-game records come from games that kept player lines: yours and the playoffs.</p>
      <div class="card tight"><h3>Players</h3><div class="table-wrap"><table><tbody>${raw(playerRows || '<tr><td class="muted">Nothing yet.</td></tr>')}</tbody></table></div></div>
      <div class="card tight" style="margin-top:.75rem"><h3>Teams</h3><div class="table-wrap"><table><tbody>${raw(teamRows || '<tr><td class="muted">Nothing yet.</td></tr>')}</tbody></table></div></div>` : html`<p class="empty">The record book opens when a season ends.</p>`;
  } else if (ui.tab === 'card') {
    const seasons = cardSeasons(league);
    if (!seasons.length) {
      body = html`<p class="empty">A season card is made when a season ends. Play one out and come back.</p>`;
    } else {
      const season = seasons.includes(ui.cardSeason) ? ui.cardSeason : seasons[0];
      ui.cardSeason = season;
      const mine = seasonResult(league, byId, ctx.players, season);
      const r = mine.record;
      const cmp = ui.theirs ? compareResults(mine, ui.theirs) : null;
      const cell = (v, win) => `<td class="num" style="${win > 0 ? 'color:var(--good);font-weight:700' : ''}">${esc(String(v))}</td>`;
      body = html`
        <p class="muted" style="margin:0 0 .5rem;font-size:.85rem">Open a friend's league code, play the same season, then swap cards to see who did more with the same rosters. A card carries the result only, so it stays readable whatever the simulation does later.</p>
        <div class="grid grid-2">
          <div class="card tight">
            <div class="row between"><h3 style="margin:0">Your season</h3>${seasons.length > 1 ? html`<select id="cardSeason" style="max-width:9rem">${seasons.map((n) => html`<option value="${n}" ${n === season ? 'selected' : ''}>Season ${n}</option>`)}</select>` : ''}</div>
            <p style="margin:.4rem 0 0;font-size:1.6rem;font-weight:800">${fmtRecord(r)}</p>
            <p class="muted" style="margin:0">${ordOf(mine.rank)} of ${mine.teams} · PF ${r.pf} · PA ${r.pa}</p>
            <p style="margin:.4rem 0 0"><b style="color:${mine.champion && mine.champion.mine ? 'var(--accent)' : 'inherit'}">${mine.playoff.replace(/^./, (x) => x.toUpperCase())}</b></p>
            <div class="kv" style="margin-top:.5rem">
              <dt>Champion</dt><dd>${mine.champion ? mine.champion.name : '—'}</dd>
              <dt>MVP</dt><dd>${mine.mvp ? `${mine.mvp.name} · ${mine.mvp.pos} · ${mine.mvp.club}` : '—'}</dd>
              <dt>Your best</dt><dd>${mine.best.length ? mine.best.map((b) => `${b.name} (${b.pts})`).join(', ') : '—'}</dd>
            </div>
            <div class="btn-group" style="margin-top:.5rem"><button class="btn" id="copyCard">Copy card code</button><button class="btn" id="cardImage">Share as image</button></div>
            <textarea id="cardOut" rows="3" readonly hidden style="margin-top:.5rem;font-family:var(--mono);font-size:.75rem"></textarea>
          </div>
          <div class="card tight">
            <h3>Compare a friend's card</h3>
            <textarea id="theirCard" rows="3" placeholder="Paste their card code">${ui.paste}</textarea>
            <div class="btn-group" style="margin-top:.4rem"><button class="btn primary" id="compare">Compare</button>${ui.theirs ? html`<button class="btn ghost" id="clearCmp">Clear</button>` : ''}</div>
            ${ui.error ? html`<p class="notice" style="margin-top:.5rem">${ui.error}</p>` : ''}
            ${cmp && !cmp.ok ? html`<p class="notice" style="margin-top:.5rem">${cmp.reason}</p>` : ''}
            ${cmp && cmp.ok ? html`
              <p style="margin:.5rem 0 .3rem"><b style="color:${cmp.better > 0 ? 'var(--good)' : cmp.better < 0 ? 'var(--bad)' : 'inherit'}">${cmp.verdict}</b></p>
              ${cmp.sameChampion ? html`<p class="muted" style="margin:0 0 .4rem;font-size:.85rem">The same club won it in both.</p>` : html`<p class="muted" style="margin:0 0 .4rem;font-size:.85rem">Different champions, from the same starting rosters.</p>`}
              <div class="table-wrap"><table><thead><tr><th></th><th class="num">You</th><th class="num">Them</th></tr></thead><tbody>${raw(cmp.rows.map((row) => `<tr><td>${esc(row.label)}</td>${cell(row.mine, row.win)}${cell(row.theirs, -row.win)}</tr>`).join(''))}</tbody></table></div>` : ''}
          </div>
        </div>`;
    }
  } else {
    const { inducted, onTrack } = hallOfFame(league);
    const resume = (r) => {
      const c = r.c;
      const bits = [`${c.seasons} season${c.seasons === 1 ? '' : 's'}`, c.titles ? `${c.titles} title${c.titles > 1 ? 's' : ''}` : '', c.mvp ? `${c.mvp}× MVP` : '', c.opoy ? `${c.opoy}× OPOY` : '', c.dpoy ? `${c.dpoy}× DPOY` : '', c.allLeague ? `${c.allLeague}× all-league` : '', c.leader ? `${c.leader}× leader` : ''].filter(Boolean);
      const p = byId.get(r.id);
      const totals = p ? (p.pos === 'QB' ? `${c.passYds} pass yds, ${c.passTd} TD` : ['RB'].includes(p.pos) ? `${c.rushYds} rush yds, ${c.rushTd + c.recTd} TD` : ['WR', 'TE'].includes(p.pos) ? `${c.recYds} rec yds, ${c.recTd} TD` : p.pos === 'K' ? `${c.fieldGoals} FG` : p.pos === 'P' ? '' : `${c.tackles} tkl, ${c.sacks} sck, ${c.interceptions} INT`) : '';
      return `<li><button type="button" class="tap" data-show="${esc(r.id)}"><b>${name(r.id)}</b></button> ${posBadge(p?.pos || '').__raw} <small class="muted">${bits.join(' · ')}${totals ? ` · ${totals}` : ''} · score <b>${r.score}</b></small></li>`;
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
  const redraw = () => view(root, params, ctx);
  el.querySelector('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { ui.tab = b.dataset.tab; ui.error = ''; redraw(); } });
  el.querySelector('#statCat')?.addEventListener('change', (e) => { ui.statCat = e.target.value; redraw(); });
  el.querySelector('#cardSeason')?.addEventListener('change', (e) => { ui.cardSeason = Number(e.target.value); ui.theirs = null; ui.error = ''; redraw(); });
  el.querySelector('#copyCard')?.addEventListener('click', async () => {
    const out = el.querySelector('#cardOut');
    const code = await encodeResultCode(seasonResult(league, byId, ctx.players, ui.cardSeason));
    out.value = code; out.hidden = false;
    try { await navigator.clipboard.writeText(code); toast(`Card copied (${code.length} characters)`); }
    catch { out.select(); toast('Copy the code from the box'); }
  });
  el.querySelector('#cardImage')?.addEventListener('click', async () => {
    try {
      const mine = seasonResult(league, byId, ctx.players, ui.cardSeason);
      const how = await shareCanvas(drawSeasonCard(mine), `${(mine.club.name || 'season').replace(/\W+/g, '-').toLowerCase()}-season-${mine.season}.png`);
      toast(how === 'shared' ? 'Shared' : 'Saved as a PNG');
    } catch (err) { if (err && err.name !== 'AbortError') toast(err.message); }
  });
  el.querySelector('#theirCard')?.addEventListener('input', (e) => { ui.paste = e.target.value; });
  el.querySelector('#compare')?.addEventListener('click', async () => {
    const text = el.querySelector('#theirCard').value;
    ui.paste = text;
    ui.error = '';
    try { ui.theirs = await decodeResultCode(text); }
    catch (err) { ui.theirs = null; ui.error = err.message; }
    redraw();
  });
  el.querySelector('#clearCmp')?.addEventListener('click', () => { ui.theirs = null; ui.error = ''; ui.paste = ''; redraw(); });
  el.addEventListener('click', (e) => { const show = e.target.closest('[data-show]'); if (show && byId.get(show.dataset.show)) playerModal(byId.get(show.dataset.show)); });
}

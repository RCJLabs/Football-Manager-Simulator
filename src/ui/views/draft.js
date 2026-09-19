import { html, render, raw } from '../../util.js';
import { valuePanel, valueHint } from '../value-panel.js';
import { POSITION_ORDER, ROSTER_SLOTS } from '../../data/positions.js';
import { ERAS } from '../../data/db.js';
import { overall } from '../../engine/ratings.js';
import { currentPicker, overallPickNumber, availablePlayers, openSlotsByPos, makePick, runAiPicks, aiChoose, autoDraftAll, TOTAL_ROUNDS, RNG } from '../../engine/draft.js';
import { startSeason } from '../../engine/season.js';
import { GM_PERSONALITIES } from '../../data/teams.js';
import { ovrBadge, playerItem, playerModal, teamChip, toast, esc } from '../components.js';
import { shownOverall } from '../../engine/scouting.js';

const ui = { pos: 'ALL', era: 'ALL', q: '' };
const PAGE = 120;

export function view(root, params, ctx) {
  // Rank by what we believe about a player: sorting an unscouted rookie by his
  // true rating would put the number back on screen as his place in the list.
  const scoutObs = ctx.getState().league ? ctx.getState().league.teams.findIndex((t) => t.isUser) : -1;
  const scoutRank = (p) => (ctx.getState().league ? shownOverall(ctx.getState().league, p, scoutObs) : overall(p));
  const { league } = ctx.getState();
  if (!league) { ctx.navigate('#/new'); return; }
  if (league.draftType === 'auction') { ctx.navigate('#/auction'); return; }
  if (league.phase !== 'draft') { ctx.navigate('#/season'); return; }
  const draft = league.draft;
  const u = league.teams.findIndex((t) => t.isUser);
  const me = league.teams[u];

  // Let the AI pick until it's the user's turn.
  if (!draft.complete && currentPicker(draft) !== u) {
    ctx.update((s) => {
      const rng = new RNG(s.league.rngState);
      runAiPicks(s.league, s.league.draft, ctx.players, rng);
      s.league.rngState = rng.state;
    }, { silent: true });
  }

  if (draft.complete) {
    render(root, html`
      <div class="card" style="text-align:center">
        <h1>Draft complete</h1>
        <p class="muted">${league.teams.length} rosters are set.${league.offseason ? ` Season ${league.season} is next.` : ''}</p>
        <div class="btn-group" style="justify-content:center">
          <a class="btn" href="#/team/${u}">Review my roster</a>
          <button class="btn primary lg" id="start">Start the season</button>
        </div>
      </div>`);
    root.querySelector('#start').addEventListener('click', () => {
      ctx.update((s) => { startSeason(s.league, ctx.byId); }, { silent: true });
      ctx.navigate('#/season');
    });
    return;
  }

  const open = openSlotsByPos(me);
  const avail = availablePlayers(draft, ctx.players);
  const pickNo = overallPickNumber(draft);
  const q = ui.q.trim().toLowerCase();
  const rows = avail
    .filter((p) => (ui.pos === 'ALL' || p.pos === ui.pos) && (ui.era === 'ALL' || `${Math.floor(p.season / 10) * 10}s` === ui.era) && (!q || p.name.toLowerCase().includes(q) || p.team.toLowerCase() === q))
    .sort((a, b) => scoutRank(b) - scoutRank(a));
  const shown = rows.slice(0, PAGE);
  const recent = draft.picks.slice(-12).reverse();
  const myPicks = ROSTER_SLOTS.map((s) => ({ slot: s, p: me.slots[s.id] ? ctx.byId.get(me.slots[s.id]) : null })).filter((x) => x.p);

  render(root, html`<div id="draft-view">
    <div class="card tight">
      <div class="clock">Round ${draft.round} of ${TOTAL_ROUNDS} · Pick ${pickNo}</div>
      <div class="muted" style="font-size:.85rem">You're on the clock, ${me.name}. Tap a position to fill it:</div>
      <div class="needs" style="margin-top:.45rem">${raw(POSITION_ORDER.map((pos) => `<span class="need ${open[pos] ? 'open' : ''}" data-filter="${pos}">${pos} ${open[pos] ? `×${open[pos]}` : '✓'}</span>`).join(''))}</div>
      <div class="btn-group" style="margin-top:.6rem">
        <button class="btn sm" id="autoOne">Auto-pick this round</button>
        <button class="btn sm" id="autoAll">Auto-draft the rest</button>
      </div>
    </div>
    <details class="card tight" id="valueGuide" style="margin-top:.5rem">
      <summary style="cursor:pointer"><b>Where money wins games</b> <span class="muted">${valueHint()}</span></summary>
      ${valuePanel()}
    </details>
    <div class="grid grid-3" style="margin-top:.75rem">
      <div class="card tight stack">
        <div class="tabs" id="posTabs">${raw(['ALL', ...POSITION_ORDER].map((p) => `<button class="tab ${ui.pos === p ? 'active' : ''}" data-pos="${p}">${p}</button>`).join(''))}</div>
        <div class="tabs" id="eraTabs">${raw(['ALL', ...ERAS].map((e) => `<button class="tab ${ui.era === e ? 'active' : ''}" data-era="${e}">${e}</button>`).join(''))}</div>
        <input type="search" id="q" placeholder="Search player or team…" value="${ui.q}">
        <div class="plist-scroll">
          <ul class="plist">${raw(shown.map((p) => playerItem(p, {
            cls: open[p.pos] ? '' : 'dim',
            action: `<button class="btn sm primary" data-draft="${esc(p.id)}" ${open[p.pos] ? '' : 'disabled'}>Draft</button>`,
          })).join(''))}</ul>
          ${shown.length === 0 ? html`<p class="empty">No available players match.</p>` : ''}
          ${rows.length > shown.length ? html`<p class="empty">${rows.length - shown.length} more — narrow the filters or search.</p>` : ''}
        </div>
      </div>
      <div class="stack">
        <div class="card tight">
          <h3>Recent picks</h3>
          <ul class="plain ticker">${raw(recent.map((pk) => { const p = ctx.byId.get(pk.playerId); const t = league.teams[pk.team]; return `<li class="${t.isUser ? 'me' : ''}"><small class="muted">#${pk.overall}</small> ${teamChip(t, { abbr: true }).__raw} — <b>${esc(p.name)}</b> <small class="muted">${p.pos} · ${p.season}</small></li>`; }).join('') || '<li class="muted">You have the first pick.</li>')}</ul>
        </div>
        <div class="card tight">
          <h3>My roster (${myPicks.length}/${TOTAL_ROUNDS})</h3>
          ${myPicks.length ? raw(`<ul class="plist">${myPicks.map(({ slot, p }) => playerItem(p, { attrs: false, meta: ` <span class="badge slot">${slot.id}</span>` })).join('')}</ul>`) : html`<p class="muted" style="font-size:.85rem">No picks yet.</p>`}
        </div>
        <div class="card tight">
          <h3>Draft order</h3>
          <ul class="plain ticker">${raw(draft.order.map((ti, i) => { const t = league.teams[ti]; const gm = GM_PERSONALITIES.find((g) => g.id === t.gm); return `<li class="${t.isUser ? 'me' : ''}">${i + 1}. ${teamChip(t).__raw} ${gm ? `<span class="badge gm" title="${esc(gm.blurb)}">${gm.name}</span>` : ''}</li>`; }).join(''))}</ul>
          <small class="muted">Snake order: reverses every round.</small>
        </div>
      </div>
    </div>
  </div>`);

  const redraw = () => view(root, params, ctx);
  const el = root.querySelector('#draft-view');
  el.querySelector('#posTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-pos]'); if (b) { ui.pos = b.dataset.pos; redraw(); } });
  el.querySelector('#eraTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-era]'); if (b) { ui.era = b.dataset.era; redraw(); } });
  el.querySelector('.needs').addEventListener('click', (e) => { const b = e.target.closest('[data-filter]'); if (b) { ui.pos = b.dataset.filter; redraw(); } });
  el.querySelector('#q').addEventListener('input', (e) => {
    ui.q = e.target.value;
    const pos = e.target.selectionStart;
    redraw();
    const input = root.querySelector('#q'); input.focus(); input.setSelectionRange(pos, pos);
  });
  el.addEventListener('click', (e) => {
    const show = e.target.closest('[data-show]');
    if (show) { playerModal(ctx.byId.get(show.dataset.show)); return; }
    const btn = e.target.closest('[data-draft]');
    if (btn) pick(ctx.byId.get(btn.dataset.draft));
  });
  el.querySelector('#autoOne').addEventListener('click', () => {
    const rng = new RNG(league.rngState);
    const p = aiChoose(league, draft, ctx.players, u, rng);
    if (p) pick(p);
  });
  el.querySelector('#autoAll').addEventListener('click', () => {
    ctx.update((s) => {
      const rng = new RNG(s.league.rngState);
      autoDraftAll(s.league, s.league.draft, ctx.players, rng);
      s.league.rngState = rng.state;
    });
  });

  function pick(p) {
    try {
      ctx.update((s) => {
        makePick(s.league, s.league.draft, p);
        const rng = new RNG(s.league.rngState);
        runAiPicks(s.league, s.league.draft, ctx.players, rng);
        s.league.rngState = rng.state;
      });
      toast(`Drafted ${p.name}`);
    } catch (err) {
      toast(err.message);
    }
  }
}

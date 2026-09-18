import { html, render, raw } from '../../util.js';
import { POSITION_ORDER, ROSTER_SLOTS } from '../../data/positions.js';
import { ERAS } from '../../data/db.js';
import { overall } from '../../engine/ratings.js';
import { currentPicker, overallPickNumber, availablePlayers, openSlotsByPos, makePick, runAiPicks, aiChoose, autoDraftAll, TOTAL_ROUNDS, RNG } from '../../engine/draft.js';
import { startSeason } from '../../engine/season.js';
import { GM_PERSONALITIES } from '../../data/teams.js';
import { ovrBadge, posBadge, eraBadge, attrList, playerModal, teamChip, toast } from '../components.js';

const ui = { pos: 'ALL', era: 'ALL', q: '' };

export function view(root, params, ctx) {
  const { league } = ctx.getState();
  if (!league) { ctx.navigate('#/new'); return; }
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
      <div class="card" style="text-align:center;padding:2rem">
        <h1>Draft complete</h1>
        <p class="muted">${league.teams.length} rosters are set. The schedule is a double round-robin, then the top ${league.teams.length >= 6 ? 4 : 2} make the playoffs.</p>
        <div class="row" style="justify-content:center">
          <a class="btn" href="#/team/${u}">Review my roster</a>
          <button class="btn primary lg" id="start">Start the season</button>
        </div>
      </div>`);
    root.querySelector('#start').addEventListener('click', () => {
      ctx.update((s) => { startSeason(s.league); }, { silent: true });
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
    .sort((a, b) => overall(b) - overall(a));
  const recent = draft.picks.slice(-14).reverse();
  const mySlots = ROSTER_SLOTS.map((s) => ({ slot: s, p: me.slots[s.id] ? ctx.byId.get(me.slots[s.id]) : null }));

  render(root, html`
    <div class="card tight">
      <div class="row between">
        <div>
          <div class="clock">Round ${draft.round} of ${TOTAL_ROUNDS} · Pick ${pickNo}</div>
          <div class="muted">You're on the clock, ${me.name}. Positions still open:</div>
        </div>
        <div class="btn-group">
          <button class="btn" id="autoOne">Auto-pick this round</button>
          <button class="btn" id="autoAll">Auto-draft the rest</button>
        </div>
      </div>
      <div class="needs" style="margin-top:.5rem">${raw(POSITION_ORDER.map((pos) => `<span class="need ${open[pos] ? 'open' : ''}" data-filter="${pos}">${pos} ${open[pos] ? `×${open[pos]}` : '✓'}</span>`).join(''))}</div>
    </div>
    <div class="grid grid-3" style="margin-top:1rem">
      <div class="card tight stack">
        <div class="row between">
          <div class="tabs" id="posTabs">${raw(['ALL', ...POSITION_ORDER].map((p) => `<button class="tab ${ui.pos === p ? 'active' : ''}" data-pos="${p}">${p}</button>`).join(''))}</div>
        </div>
        <div class="row">
          <div class="tabs" id="eraTabs">${raw(['ALL', ...ERAS].map((e) => `<button class="tab ${ui.era === e ? 'active' : ''}" data-era="${e}">${e}</button>`).join(''))}</div>
          <input type="search" id="q" placeholder="Search…" value="${ui.q}" style="max-width:200px;margin-left:auto">
        </div>
        <div class="pool table-wrap">
          <table>
            <thead><tr><th>Ovr</th><th>Pos</th><th>Player</th><th>Ratings</th><th></th></tr></thead>
            <tbody>${raw(rows.slice(0, 250).map((p) => `<tr data-id="${p.id}" class="${open[p.pos] ? '' : 'dim'}">
              <td>${ovrBadge(p).__raw}</td><td>${posBadge(p.pos).__raw}</td>
              <td><b class="clickable" data-show="${p.id}">${p.name}</b><br><small>${p.season} ${p.team} ${eraBadge(p.season).__raw}</small></td>
              <td>${attrList(p).__raw}</td>
              <td><button class="btn sm primary" data-draft="${p.id}" ${open[p.pos] ? '' : 'disabled'}>Draft</button></td></tr>`).join(''))}</tbody>
          </table>
          ${rows.length === 0 ? html`<p class="empty">No available players match.</p>` : ''}
        </div>
      </div>
      <div class="stack">
        <div class="card tight">
          <h3>Recent picks</h3>
          <ul class="plain ticker">${raw(recent.map((pk) => { const p = ctx.byId.get(pk.playerId); const t = league.teams[pk.team]; return `<li class="${t.isUser ? 'me' : ''}"><small class="muted">#${pk.overall}</small> ${teamChip(t, { abbr: true }).__raw} — <b>${p.name}</b> <small class="muted">${p.pos} · ${p.season} ${p.team}</small></li>`; }).join('')) || '<li class="muted">You have the first pick.</li>'}</ul>
        </div>
        <div class="card tight">
          <h3>My roster (${draft.picks.filter((p) => p.team === u).length}/${TOTAL_ROUNDS})</h3>
          <div class="table-wrap"><table>
            <tbody>${raw(mySlots.map(({ slot, p }) => `<tr class="${p ? '' : 'dim'}"><td>${slot.id}</td><td>${p ? `${ovrBadge(p).__raw} <b>${p.name}</b> <small class="muted">${p.season}</small>` : '<span class="muted">—</span>'}</td></tr>`).join(''))}</tbody>
          </table></div>
        </div>
        <div class="card tight">
          <h3>Draft order</h3>
          <ul class="plain ticker">${raw(draft.order.map((ti, i) => { const t = league.teams[ti]; const gm = GM_PERSONALITIES.find((g) => g.id === t.gm); return `<li class="${t.isUser ? 'me' : ''}">${i + 1}. ${teamChip(t).__raw} ${gm ? `<span class="badge gm" title="${gm.blurb}">${gm.name}</span>` : ''}</li>`; }).join(''))}</ul>
          <small class="muted">Snake order: reverses every round.</small>
        </div>
      </div>
    </div>
  `);

  const redraw = () => view(root, params, ctx);
  root.querySelector('#posTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-pos]'); if (b) { ui.pos = b.dataset.pos; redraw(); } });
  root.querySelector('#eraTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-era]'); if (b) { ui.era = b.dataset.era; redraw(); } });
  root.querySelector('.needs').addEventListener('click', (e) => { const b = e.target.closest('[data-filter]'); if (b) { ui.pos = b.dataset.filter; redraw(); } });
  root.querySelector('#q').addEventListener('input', (e) => {
    ui.q = e.target.value;
    const pos = e.target.selectionStart;
    redraw();
    const el = root.querySelector('#q'); el.focus(); el.setSelectionRange(pos, pos);
  });
  root.querySelector('tbody').addEventListener('click', (e) => {
    const show = e.target.closest('[data-show]');
    if (show) { playerModal(ctx.byId.get(show.dataset.show)); return; }
    const btn = e.target.closest('[data-draft]');
    if (!btn) return;
    pick(ctx.byId.get(btn.dataset.draft));
  });
  root.querySelector('#autoOne').addEventListener('click', () => {
    const rng = new RNG(league.rngState);
    const p = aiChoose(league, draft, ctx.players, u, rng);
    if (p) pick(p);
  });
  root.querySelector('#autoAll').addEventListener('click', () => {
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

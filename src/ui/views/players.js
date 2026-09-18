import { html, render, raw } from '../../util.js';
import { POSITION_ORDER } from '../../data/positions.js';
import { ERAS } from '../../data/db.js';
import { overall } from '../../engine/ratings.js';
import { playerItem, playerModal, teamChip, esc } from '../components.js';
import { ownerMap } from '../../engine/transactions.js';

const ui = { pos: 'ALL', era: 'ALL', q: '', owned: 'all', limit: 120 };

export function view(root, params, ctx) {
  const { league } = ctx.getState();
  const owned = league ? ownerMap(league) : new Map();
  const owner = (p) => (owned.has(p.id) ? league.teams[owned.get(p.id)] : null);

  function list() {
    const q = ui.q.trim().toLowerCase();
    return ctx.players
      .filter((p) => (ui.pos === 'ALL' || p.pos === ui.pos) && (ui.era === 'ALL' || `${Math.floor(p.season / 10) * 10}s` === ui.era)
        && (!q || p.name.toLowerCase().includes(q) || p.team.toLowerCase() === q)
        && (ui.owned === 'all' || (ui.owned === 'free' ? !owner(p) : !!owner(p))))
      .sort((a, b) => overall(b) - overall(a) || a.name.localeCompare(b.name));
  }

  function draw() {
    const rows = list();
    const shown = rows.slice(0, ui.limit);
    render(root, html`<div id="players-view" class="card tight stack">
      <h2 style="margin:0">Player pool <small class="muted" style="font-weight:400">${ctx.players.length} players · ${rows.length} match</small></h2>
      <input type="search" id="q" placeholder="Search player or team…" value="${ui.q}">
      <div class="tabs" id="posTabs">${raw(['ALL', ...POSITION_ORDER].map((p) => `<button class="tab ${ui.pos === p ? 'active' : ''}" data-pos="${p}">${p}</button>`).join(''))}</div>
      <div class="tabs" id="eraTabs">${raw(['ALL', ...ERAS].map((e) => `<button class="tab ${ui.era === e ? 'active' : ''}" data-era="${e}">${e}</button>`).join(''))}</div>
      ${league ? html`<div class="tabs" id="ownTabs">${raw([['all', 'Everyone'], ['free', 'Undrafted'], ['owned', 'Drafted']].map(([k, label]) => `<button class="tab ${ui.owned === k ? 'active' : ''}" data-own="${k}">${label}</button>`).join(''))}</div>` : ''}
      <ul class="plist">${raw(shown.map((p) => { const o = owner(p); return playerItem(p, { meta: o ? ` · <span class="muted">${esc(o.abbr)}</span>` : '' }); }).join(''))}</ul>
      ${shown.length === 0 ? html`<p class="empty">Nothing matches those filters.</p>` : ''}
      ${rows.length > shown.length ? html`<button class="btn block" id="more">Show more (${rows.length - shown.length} left)</button>` : ''}
    </div>`);
    const el = root.querySelector('#players-view');
    el.querySelector('#q').addEventListener('input', (e) => {
      ui.q = e.target.value; ui.limit = 120;
      const pos = e.target.selectionStart;
      draw();
      const input = root.querySelector('#q'); input.focus(); input.setSelectionRange(pos, pos);
    });
    el.querySelector('#posTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-pos]'); if (b) { ui.pos = b.dataset.pos; ui.limit = 120; draw(); } });
    el.querySelector('#eraTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-era]'); if (b) { ui.era = b.dataset.era; ui.limit = 120; draw(); } });
    el.querySelector('#ownTabs')?.addEventListener('click', (e) => { const b = e.target.closest('[data-own]'); if (b) { ui.owned = b.dataset.own; ui.limit = 120; draw(); } });
    el.querySelector('#more')?.addEventListener('click', () => { ui.limit += 120; draw(); });
    el.addEventListener('click', (e) => {
      const show = e.target.closest('[data-show]');
      if (!show) return;
      const p = ctx.byId.get(show.dataset.show);
      const o = owner(p);
      playerModal(p, o ? `<p class="muted">Drafted by ${teamChip(o).__raw}</p>` : '');
    });
  }
  draw();
}

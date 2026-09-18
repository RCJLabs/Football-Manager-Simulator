import { html, render, raw } from '../../util.js';
import { POSITION_ORDER } from '../../data/positions.js';
import { ERAS } from '../../data/db.js';
import { overall } from '../../engine/ratings.js';
import { ovrBadge, posBadge, eraBadge, attrList, playerModal, teamChip } from '../components.js';

const ui = { pos: 'ALL', era: 'ALL', q: '', owned: 'all' };

export function view(root, params, ctx) {
  const { league } = ctx.getState();
  const owner = (p) => (league && league.draft && league.draft.taken[p.id] != null ? league.teams[league.draft.taken[p.id]] : null);

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
    render(root, html`
      <div class="card tight stack">
        <div class="row between">
          <h2 style="margin:0">Player pool <small class="muted">${ctx.players.length} players · ${rows.length} shown</small></h2>
          <input type="search" id="q" placeholder="Search name or team…" value="${ui.q}" style="max-width:260px">
        </div>
        <div class="tabs" id="posTabs">${raw(['ALL', ...POSITION_ORDER].map((p) => `<button class="tab ${ui.pos === p ? 'active' : ''}" data-pos="${p}">${p}</button>`).join(''))}</div>
        <div class="row">
          <div class="tabs" id="eraTabs">${raw(['ALL', ...ERAS].map((e) => `<button class="tab ${ui.era === e ? 'active' : ''}" data-era="${e}">${e}</button>`).join(''))}</div>
          ${league ? html`<select id="owned" style="width:auto"><option value="all" ${ui.owned === 'all' ? 'selected' : ''}>All</option><option value="free" ${ui.owned === 'free' ? 'selected' : ''}>Undrafted</option><option value="owned" ${ui.owned === 'owned' ? 'selected' : ''}>Drafted</option></select>` : ''}
        </div>
        <div class="table-wrap pool" style="max-height:70vh">
          <table>
            <thead><tr><th>Ovr</th><th>Pos</th><th>Player</th><th>Ratings</th>${league ? html`<th>Owner</th>` : ''}</tr></thead>
            <tbody>${raw(rows.slice(0, 400).map((p) => {
              const o = owner(p);
              return `<tr class="clickable" data-id="${p.id}"><td>${ovrBadge(p).__raw}</td><td>${posBadge(p.pos).__raw}</td><td><b>${p.name}</b><br><small>${p.season} ${p.team} ${eraBadge(p.season).__raw}</small></td><td>${attrList(p).__raw}</td>${league ? `<td>${o ? teamChip(o, { abbr: true }).__raw : '<span class="muted">—</span>'}</td>` : ''}</tr>`;
            }).join(''))}</tbody>
          </table>
          ${rows.length > 400 ? html`<p class="empty">Showing the first 400. Narrow the filters to see more.</p>` : ''}
        </div>
      </div>
    `);
    root.querySelector('#q').addEventListener('input', (e) => { ui.q = e.target.value; drawKeepFocus(); });
    root.querySelector('#posTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-pos]'); if (b) { ui.pos = b.dataset.pos; draw(); } });
    root.querySelector('#eraTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-era]'); if (b) { ui.era = b.dataset.era; draw(); } });
    root.querySelector('#owned')?.addEventListener('change', (e) => { ui.owned = e.target.value; draw(); });
    root.querySelector('tbody').addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      const p = ctx.byId.get(tr.dataset.id);
      const o = owner(p);
      playerModal(p, o ? `<p class="muted">Drafted by ${teamChip(o).__raw}</p>` : '');
    });
  }
  function drawKeepFocus() {
    const pos = root.querySelector('#q').selectionStart;
    draw();
    const q = root.querySelector('#q');
    q.focus(); q.setSelectionRange(pos, pos);
  }
  draw();
}

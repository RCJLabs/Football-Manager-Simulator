import { html, render, raw } from '../../util.js';
import { ROSTER_SLOTS, POSITION_ORDER, POSITIONS } from '../../data/positions.js';
import { GM_PERSONALITIES } from '../../data/teams.js';
import { buildLineup, teamPower, overall } from '../../engine/ratings.js';
import { ovrBadge, posBadge, eraBadge, attrList, playerModal, teamChip, toast } from '../components.js';
import { fantasyPoints } from '../../engine/stats.js';

const STRATEGY_FIELDS = [
  { key: 'passRate', label: 'Pass / run balance', lo: 'Run heavy', hi: 'Pass heavy', min: 0.35, max: 0.7 },
  { key: 'aggression', label: '4th-down aggression', lo: 'Conservative', hi: 'Go for it', min: 0, max: 1 },
  { key: 'tempo', label: 'Tempo', lo: 'Slow', hi: 'Fast', min: 0, max: 1 },
  { key: 'blitzRate', label: 'Blitz frequency', lo: 'Rarely', hi: 'Often', min: 0.05, max: 0.6 },
  { key: 'deepShell', label: 'Deep coverage', lo: 'Aggressive', hi: 'Prevent', min: 0, max: 0.6 },
];

export function view(root, params, ctx) {
  const { league } = ctx.getState();
  if (!league) { ctx.navigate('#/'); return; }
  const idx = Number(params.idx);
  const team = league.teams[idx];
  if (!team) { ctx.navigate('#/'); return; }
  const lineup = buildLineup(team.slots, ctx.byId);
  const power = teamPower(lineup);
  const gm = GM_PERSONALITIES.find((g) => g.id === team.gm);
  const canEdit = team.isUser;
  const stats = team.seasonStats.players;

  const groups = POSITION_ORDER.map((pos) => {
    const slots = ROSTER_SLOTS.filter((s) => s.pos === pos);
    return { pos, slots: slots.map((s, i) => ({ slot: s, i, p: team.slots[s.id] ? ctx.byId.get(team.slots[s.id]) : null })) };
  });

  render(root, html`<div id="team-view">
    <div class="card">
      <div class="row between">
        <div>
          <h1 style="margin:0">${teamChip(team)}</h1>
          <p class="muted" style="margin:.25rem 0 0">${team.record.w}-${team.record.l}${team.record.t ? `-${team.record.t}` : ''} · PF ${team.record.pf} · PA ${team.record.pa} · Power <b>${power}</b>
            ${gm ? html` · <span class="badge gm" title="${gm.blurb}">${gm.name}</span>` : ''}</p>
        </div>
        <div class="row">${league.teams.map((t, i) => html`<a class="btn sm ${i === idx ? 'primary' : ''}" href="#/team/${i}">${t.abbr}</a>`)}</div>
      </div>
    </div>
    <div class="grid grid-3" style="margin-top:1rem">
      <div class="card tight">
        <h3>Depth chart ${canEdit ? html`<small class="muted">— use ▲▼ to reorder within a position</small>` : ''}</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>Slot</th><th>Ovr</th><th>Player</th><th>Ratings</th><th>Fantasy</th>${canEdit ? html`<th></th>` : ''}</tr></thead>
          <tbody>${raw(groups.map((g) => g.slots.map(({ slot, i, p }) => {
            if (!p) return `<tr class="dim"><td>${slot.id}</td><td colspan="4" class="muted">empty</td></tr>`;
            const fp = stats[p.id] ? fantasyPoints(stats[p.id]) : 0;
            const btns = canEdit && g.slots.length > 1 ? `<td><span class="depth-btns">${i > 0 ? `<button class="btn sm ghost" data-move="${slot.id}" data-dir="-1" title="Move up">▲</button>` : ''}${i < g.slots.length - 1 ? `<button class="btn sm ghost" data-move="${slot.id}" data-dir="1" title="Move down">▼</button>` : ''}</span></td>` : canEdit ? '<td></td>' : '';
            return `<tr class="${slot.starter ? '' : 'dim'}"><td><b>${slot.id}</b>${slot.starter ? '' : '<br><small>bench</small>'}</td><td>${ovrBadge(p).__raw}</td><td><b class="clickable" data-show="${p.id}">${p.name}</b><br><small>${p.season} ${p.team} ${eraBadge(p.season).__raw}</small></td><td>${attrList(p).__raw}</td><td class="num">${fp ? fp.toFixed(1) : '—'}</td>${btns}</tr>`;
          }).join('')).join(''))}</tbody>
        </table></div>
      </div>
      <div class="stack">
        <div class="card tight">
          <h3>Strategy ${canEdit ? '' : html`<small class="muted">(AI-controlled)</small>`}</h3>
          ${STRATEGY_FIELDS.map((f) => html`<div class="slider-row">
            <div class="lbl"><span>${f.label}</span><b id="lbl-${f.key}">${pctLabel(f, team.strategy[f.key])}</b></div>
            <input type="range" data-strat="${f.key}" min="${f.min}" max="${f.max}" step="0.01" value="${team.strategy[f.key]}" ${canEdit ? '' : 'disabled'}>
            <div class="lbl"><span>${f.lo}</span><span>${f.hi}</span></div>
          </div>`)}
        </div>
        <div class="card tight">
          <h3>Unit ratings</h3>
          ${raw(unitTable(lineup))}
        </div>
      </div>
    </div>
  </div>`);

  root.querySelector('#team-view').addEventListener('click', (e) => {
    const show = e.target.closest('[data-show]');
    if (show) { playerModal(ctx.byId.get(show.dataset.show)); return; }
    const mv = e.target.closest('[data-move]');
    if (mv && canEdit) {
      const slotId = mv.dataset.move, dir = Number(mv.dataset.dir);
      const pos = ROSTER_SLOTS.find((s) => s.id === slotId).pos;
      const group = ROSTER_SLOTS.filter((s) => s.pos === pos);
      const i = group.findIndex((s) => s.id === slotId);
      const j = i + dir;
      if (j < 0 || j >= group.length) return;
      ctx.update((s) => {
        const t = s.league.teams[idx];
        const a = t.slots[group[i].id], b = t.slots[group[j].id];
        t.slots[group[i].id] = b; t.slots[group[j].id] = a;
      });
    }
  });
  for (const input of root.querySelectorAll('[data-strat]')) {
    const f = STRATEGY_FIELDS.find((x) => x.key === input.dataset.strat);
    input.addEventListener('input', () => { root.querySelector(`#lbl-${f.key}`).textContent = pctLabel(f, Number(input.value)); });
    input.addEventListener('change', () => ctx.update((s) => { s.league.teams[idx].strategy[f.key] = Number(input.value); }, { silent: true }));
  }
}

function pctLabel(f, v) {
  if (f.key === 'passRate') return `${Math.round(v * 100)}% pass`;
  return `${Math.round(((v - f.min) / (f.max - f.min)) * 100)}`;
}

function unitTable(lineup) {
  const avg = (arr, n) => { const a = (arr || []).slice(0, n); return a.length ? Math.round(a.reduce((s, p) => s + overall(p), 0) / a.length) : '—'; };
  const rows = [
    ['QB', avg(lineup.QB, 1)], ['RB', avg(lineup.RB, 2)], ['WR', avg(lineup.WR, 3)], ['TE', avg(lineup.TE, 1)], ['OL', avg(lineup.OL, 5)],
    ['DL', avg(lineup.DL, 4)], ['LB', avg(lineup.LB, 3)], ['CB', avg(lineup.CB, 2)], ['S', avg(lineup.S, 2)], ['K/P', Math.round(((lineup.K?.[0] ? overall(lineup.K[0]) : 70) + (lineup.P?.[0] ? overall(lineup.P[0]) : 70)) / 2)],
  ];
  return `<div class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd><div class="row"><div class="bar" style="flex:1"><i style="width:${typeof v === 'number' ? v : 0}%"></i></div><b style="min-width:2rem;text-align:right">${v}</b></div></dd>`).join('')}</div>`;
}

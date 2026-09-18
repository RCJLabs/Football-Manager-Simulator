import { html, raw, esc, textOn } from '../util.js';
import { overall } from '../engine/ratings.js';
import { POSITIONS, eraOf } from '../data/positions.js';

export function ovrBadge(p) {
  const o = overall(p);
  const cls = o >= 95 ? 'o95' : o >= 90 ? 'o90' : o >= 85 ? 'o85' : o >= 80 ? 'o80' : 'o0';
  return html`<span class="ovr ${cls}">${o}</span>`;
}

export function posBadge(pos) {
  return html`<span class="badge pos">${pos}</span>`;
}

export function eraBadge(season) {
  return html`<span class="badge era">${eraOf(season)}</span>`;
}

export function teamChip(team, { abbr = false } = {}) {
  return html`<span class="team-chip"><span class="teamdot" style="background:${team.color}"></span>${abbr ? team.abbr : team.name}</span>`;
}

export function attrList(p, { highlight = true } = {}) {
  const def = POSITIONS[p.pos];
  return raw(def.attrs.map((a) => {
    const v = p.r[a];
    const cls = highlight ? (v >= 92 ? 'hi' : v <= 70 ? 'lo' : '') : '';
    return `<span class="attr ${cls}">${a} <b>${v}</b></span>`;
  }).join(''));
}

export function playerRow(p, extraCells = '', { onclickAttr = '' } = {}) {
  return html`<tr ${raw(onclickAttr)}>
    <td>${ovrBadge(p)}</td>
    <td>${posBadge(p.pos)}</td>
    <td><b>${p.name}</b><br><small>${p.season} ${p.team} ${eraBadge(p.season)}</small></td>
    <td class="attrs">${attrList(p)}</td>
    ${raw(extraCells)}
  </tr>`;
}

let toastTimer;
export function toast(msg, ms = 2200) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

export function modal(contentHtml, { onClose } = {}) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${contentHtml.__raw ?? contentHtml}</div>`;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(back);
  return { el: back, close };
}

export function playerModal(p, extra = '') {
  const def = POSITIONS[p.pos];
  const rows = def.attrs.map((a) => `<div class="slider-row"><div class="lbl"><span>${ATTR_NAMES[a] || a}</span><b>${p.r[a]}</b></div><div class="bar"><i style="width:${p.r[a]}%"></i></div></div>`).join('');
  return modal(html`
    <div class="row between"><h2 style="margin:0">${p.name}</h2><button class="btn sm ghost" data-close>✕</button></div>
    <p class="muted">${def.name} · ${p.season} ${p.team} · ${eraOf(p.season)} · Overall ${ovrBadge(p)}</p>
    ${raw(rows)}
    ${raw(extra)}
  `);
}

export const ATTR_NAMES = {
  spd: 'Speed', awr: 'Awareness', thp: 'Arm strength', tha: 'Accuracy', mob: 'Mobility', elu: 'Elusiveness', pow: 'Power', rec: 'Receiving', car: 'Ball security',
  cth: 'Catching', rte: 'Route running', rac: 'Run after catch', blk: 'Blocking', pbk: 'Pass block', rbk: 'Run block', prs: 'Pass rush', rsd: 'Run defense', tck: 'Tackling',
  cov: 'Coverage', bal: 'Ball skills', kpw: 'Kick power', kac: 'Kick accuracy', ppw: 'Punt power', pac: 'Punt placement',
};

export function colorStyle(team) {
  return `background:${team.color};color:${textOn(team.color)}`;
}

export { esc, raw, html };

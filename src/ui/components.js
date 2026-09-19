import { html, raw, esc, textOn } from '../util.js';
import { fmtWeeks } from '../engine/injuries.js';
import { overall } from '../engine/ratings.js';
import { getState, update } from '../store.js';
import { setOverride } from '../data/tuning.js';
import { POSITIONS, eraOf } from '../data/positions.js';
import { careerPhase } from '../engine/careers.js';
import { scoutReport, coarseAttrs, scoutLabel, shownOverall } from '../engine/scouting.js';

export function ovrClass(o) {
  return o >= 95 ? 'o95' : o >= 90 ? 'o90' : o >= 85 ? 'o85' : o >= 80 ? 'o80' : 'o0';
}

/**
 * Whose eyes the screen is looking through. Read from the store rather than
 * threaded through every caller, the same way the rating editor already is.
 */
export function scoutView() {
  const lg = getState().league;
  if (!lg) return null;
  return { league: lg, observer: lg.teams.findIndex((t) => t.isUser) };
}

export function ovrBadge(p) {
  const v = scoutView();
  const rep = v ? scoutReport(v.league, p, v.observer) : null;
  if (rep && !rep.known) {
    return html`<span class="ovr range" title="Projection, not a measurement: ${scoutLabel(rep)}. He has not played yet.">${rep.low}–${rep.high}</span>`;
  }
  const o = overall(p);
  return html`<span class="ovr ${ovrClass(o)}">${o}</span>`;
}

export function posBadge(pos) {
  return html`<span class="badge pos">${pos}</span>`;
}

/** Injury marker for a player on the league ledger: OUT · 3 wk, OUT · season. */
export function outBadge(inj) {
  if (!inj) return raw('');
  return raw(`<span class="badge out" title="${esc(inj.kind || 'injured')}">OUT · ${fmtWeeks(inj.weeks)}</span>`);
}

/** Generated players carry their class instead of a decade. */
export function rookieBadge(p) {
  return p && p.generated ? raw(`<span class="badge rookie">rookie</span>`) : raw('');
}

/** A player with a career shows his age; a retired one says so instead. */
export function ageBadge(p) {
  if (!p) return raw('');
  if (p.retired) return raw(`<span class="badge retired">retired</span>`);
  if (p.age == null) return raw('');
  return raw(`<span class="badge age" title="${careerPhase(p.pos, p.age)}">${p.age}</span>`);
}

export function eraBadge(season) {
  return html`<span class="badge era">${eraOf(season)}</span>`;
}

/**
 * Team name with its colour dot. `abbr` always shows the short code;
 * `responsive` shows the short code on a phone and the full name from 560px up,
 * which keeps matchups and the scoreboard readable instead of ellipsised.
 */
export function teamChip(team, { abbr = false, responsive = false } = {}) {
  const label = responsive
    ? `<span class="t-short">${esc(team.abbr)}</span><span class="t-long">${esc(team.name)}</span>`
    : esc(abbr ? team.abbr : team.name);
  return raw(`<span class="team-chip"><span class="teamdot" style="background:${esc(team.color)}"></span><span class="tn">${label}</span></span>`);
}

export function attrList(p, { highlight = true } = {}) {
  const view = scoutView();
  // A scout can tell you the shape of a player — fast, hands of stone — without
  // giving you the number, and the rookie generator makes lopsided players on
  // purpose, so the shape is the part worth keeping.
  const attrs = view ? coarseAttrs(view.league, p, view.observer) : POSITIONS[p.pos].attrs.map((a) => ({ attr: a, value: p.r[a], exact: true }));
  return raw(attrs.map(({ attr, value, exact }) => {
    const cls = highlight && exact ? (value >= 92 ? 'hi' : value <= 70 ? 'lo' : '') : '';
    return `<span class="attr ${cls}${exact ? '' : ' est'}">${attr} <b>${exact ? '' : '~'}${value}</b></span>`;
  }).join(''));
}

/**
 * One player as a responsive row. Reflows to a single column on a phone and
 * spreads into columns on a wide screen, so no player list ever needs the
 * page to scroll sideways.
 *   action  raw HTML for the trailing control (a button, depth arrows…)
 *   meta    extra raw HTML appended to the small grey line
 */
export function playerItem(p, { action = '', meta = '', cls = '', attrs = true, era = true } = {}) {
  return `<li class="prow ${cls}" data-id="${esc(p.id)}">
    ${ovrBadge(p).__raw}
    <div class="who">
      <div class="nm"><span class="tap" data-show="${esc(p.id)}">${esc(p.name)}</span>${posBadge(p.pos).__raw}</div>
      <div class="meta">${p.generated ? `class of ${p.season}` : `${p.season} ${esc(p.team)}`}${p.generated ? rookieBadge(p).__raw : era ? eraBadge(p.season).__raw : ''}${ageBadge(p).__raw}${meta}</div>
    </div>
    <div class="act">${action}</div>
    ${attrs ? `<div class="attrs">${attrList(p).__raw}</div>` : ''}
  </li>`;
}

export function playerList(players, opts = {}) {
  const items = players.map((p) => (typeof opts.each === 'function' ? playerItem(p, opts.each(p)) : playerItem(p, opts))).join('');
  return raw(`<ul class="plist">${items}</ul>`);
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
  const editing = !!getState().prefs?.ratingEditor;
  const rows = def.attrs.map((a) => `<div class="slider-row"><div class="lbl"><span>${ATTR_NAMES[a] || a}${p.baseR && p.baseR[a] !== p.r[a] ? ` <small class="muted">(was ${p.baseR[a]})</small>` : ''}</span>${editing ? `<input type="number" class="rating-edit" data-attr="${a}" min="40" max="99" value="${p.r[a]}" style="width:4.5rem;padding:.2rem .4rem;text-align:right">` : `<b>${p.r[a]}</b>`}</div><div class="bar"><i style="width:${p.r[a]}%"></i></div></div>`).join('');
  const m = modal(html`
    <div class="row between"><h2 style="margin:0">${p.name}</h2><button class="btn sm ghost" data-close>✕</button></div>
    <p class="muted">${def.name} · ${p.generated ? `generated rookie, class of ${p.season}` : `${p.season} ${p.team} · ${eraOf(p.season)}`} · Overall <span id="ovrNow">${ovrBadge(p)}</span></p>
    ${p.retired ? html`<p class="muted" style="margin:-.3rem 0 0">Retired at ${p.age}. He stays in the record books; he cannot be signed.</p>`
      : p.age != null ? html`<p class="muted" style="margin:-.3rem 0 0">Age ${p.age}, ${careerPhase(p.pos, p.age)}${p.base && overall(p) !== overall(p.base) ? ` · ${overall(p) > overall(p.base) ? 'up' : 'down'} ${Math.abs(overall(p) - overall(p.base))} from the ${p.base.season} version you signed` : ''}.</p>` : ''}
    ${raw(rows)}
    ${editing ? html`<small class="muted">Rating editor is on (settings). Edits apply everywhere at once and export as a diff.</small>` : ''}
    ${raw(extra)}
  `);
  if (editing) {
    m.el.addEventListener('change', (e) => {
      const input = e.target.closest('.rating-edit');
      if (!input) return;
      update((s) => { s.prefs.ratingOverrides = setOverride(s.prefs.ratingOverrides || {}, p, input.dataset.attr, input.value); }, { silent: true });
      input.value = p.r[input.dataset.attr];
      input.closest('.slider-row').querySelector('.bar i').style.width = `${p.r[input.dataset.attr]}%`;
      m.el.querySelector('#ovrNow').innerHTML = ovrBadge(p).__raw;
    });
  }
  return m;
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

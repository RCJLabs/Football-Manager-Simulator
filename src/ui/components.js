import { html, raw, esc, textOn } from '../util.js';
import { fmtWeeks } from '../engine/injuries.js';
import { overall } from '../engine/ratings.js';
import { getState, update } from '../store.js';
import { setOverride } from '../data/tuning.js';
import { POSITIONS, eraOf, edgeness, ratedAsEdge } from '../data/positions.js';
import { careerPhase } from '../engine/careers.js';
import { hallScore, HOF_THRESHOLD, HOF_MIN_SEASONS } from '../engine/awards.js';
import { scoutReport, coarseAttrs, scoutLabel, shownOverall, readyLabel } from '../engine/scouting.js';

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
    const when = readyLabel(rep);
    return html`<span class="ovr range" title="Projection, not a measurement: ${scoutLabel(rep)}${when ? `, ${when}` : ''}. He has not played yet.">${rep.low}–${rep.high}</span>`;
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
export function playerItem(p, { action = '', meta = '', cls = '', attrs = true, era = true, pos = true } = {}) {
  return `<li class="prow ${cls}" data-id="${esc(p.id)}">
    ${ovrBadge(p).__raw}
    <div class="who">
      <div class="nm"><button type="button" class="tap" data-show="${esc(p.id)}">${esc(p.name)}</button>${pos ? posBadge(p.pos).__raw : ''}</div>
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
/**
 * Run work that blocks, after the button has had a chance to say so.
 *
 * Javascript is single threaded, so a handler that takes a second takes the
 * whole interface with it: the tap does not depress, the button does not
 * change, nothing scrolls. The player reads that as the game having hung,
 * which is exactly the report that led here — press a button, wait, and then
 * it works. Yielding once before starting costs a frame and buys a label that
 * says what is happening, which is the difference between a slow button and a
 * broken one.
 *
 * This does not make anything faster and is not a substitute for doing so. It
 * is for the handful of actions that are genuinely a lot of work and that the
 * player asked for on purpose — completing an auction, drafting out a whole
 * board. Anything that runs on a redraw belongs off the render path instead.
 */
export function withBusy(btn, fn, label = 'Working…') {
  if (!btn) { fn(); return; }
  const text = btn.textContent;
  const wasDisabled = btn.disabled;
  btn.textContent = label;
  btn.disabled = true;
  setTimeout(() => {
    try {
      fn();
    } finally {
      // The view usually redraws out from under it, which is why this checks.
      if (btn.isConnected) { btn.textContent = text; btn.disabled = wasDisabled; }
    }
  }, 20);
}

/**
 * The game's whole feedback channel — a deal going through, a claim refused, a
 * rating edit saved — and it was invisible to a screen reader, because a
 * `hidden` element is not announced and unhiding one is not reliably a change
 * worth announcing either.
 *
 * The fix is not to make the toast itself a live region but to mirror it into a
 * permanently-present one. Announcement then has nothing to do with whether the
 * visible toast is up, which is the part that was fragile.
 */
export function announce(msg) {
  const live = document.getElementById('srlive');
  if (!live) return;
  // Same message twice in a row is not a change, so nothing is read. A
  // zero-width space that alternates makes it one.
  live.textContent = live.textContent === msg ? `${msg}\u200b` : msg;
}

export function toast(msg, ms = 2200) {
  announce(msg);
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A dialog that a keyboard can actually get out of.
 *
 * `aria-modal` is a promise to assistive technology that nothing behind the
 * dialog is reachable, and the browser does not keep that promise on its own:
 * without a trap, Tab walks straight out of the panel and into the page
 * underneath, which is still scrolled to wherever it was and still looks
 * interactive. So focus moves in on open, cycles inside, and goes back to
 * whatever opened it on close — the last part matters most, because a player
 * modal opened from the fortieth row of the pool used to dump you at the top
 * of the document.
 */
export function modal(contentHtml, { onClose, label = 'Dialog' } = {}) {
  const opener = document.activeElement;
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(label)}" tabindex="-1">${contentHtml.__raw ?? contentHtml}</div>`;
  const panel = back.firstElementChild;
  const close = () => {
    back.remove();
    document.removeEventListener('keydown', onKey);
    // Only take focus back if it is still ours to give; a close that navigates
    // has already put it somewhere better.
    if (opener && opener.isConnected && (document.activeElement === document.body || !document.activeElement)) opener.focus();
    onClose && onClose();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'Tab') return;
    const items = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === panel);
    if (!items.length) { e.preventDefault(); panel.focus(); return; }
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(back);
  // The panel itself, not its first button: landing on ✕ reads the dialog as
  // one thing you can do, which is to leave. A dialog with `tabindex="-1"` and
  // a label reads its name and then its contents, which is the whole point.
  panel.focus();
  return { el: back, close };
}

/**
 * Why a linebacker who cannot cover is rated highly anyway.
 *
 * `edgeness` blends his rating between the off-ball and edge weight vectors,
 * which is invisible in the attribute bars: a man with 58 coverage reading 89
 * overall looks like a mistake unless the screen says what job he is being
 * rated for. Only shown when it is actually deciding something.
 */
function roleLine(p) {
  if (!ratedAsEdge(p.pos, p.r)) return '';
  const e = edgeness(p.pos, p.r);
  const how = e >= 0.99 ? 'A pure edge rusher' : e >= 0.6 ? 'Mostly an edge rusher' : 'Part edge rusher, part off-ball';
  return html`<p class="muted" style="margin:.2rem 0 0">${how} — rated on getting to the quarterback rather than on coverage, and he rushes instead of dropping on a passing down.</p>`;
}

/**
 * How soon a prospect arrives, which is the half of a projection the band has
 * never carried. Two men can read 70-86 and be four years apart; before `pace`
 * existed they could not, because every prospect arrived in about five seasons
 * whoever he was. Shown only while he is still a projection.
 */
function scoutPaceLine(p) {
  const v = scoutView();
  if (!v) return '';
  const rep = scoutReport(v.league, p, v.observer);
  const when = readyLabel(rep);
  if (!when) return '';
  const sure = rep.late - rep.soon <= 1;
  return html`<p class="muted" style="margin:.2rem 0 0">Your scouts have him ${when}${sure ? ' and are fairly sure of it' : ''} — the range is how little anyone knows, not how good he is.</p>`;
}

/**
 * What a man has actually done, out of `league.careers`.
 *
 * That table has been filled in since awards shipped — seasons, games, yards,
 * touchdowns, sacks, interceptions, honours, titles, the clubs he played for —
 * and until now the only thing that ever read it was Hall of Fame membership.
 * Twelve seasons into a dynasty you could not look at your own quarterback and
 * see what he had done for you. Nothing is stored for this; it was all already
 * there.
 *
 * Read from the store rather than threaded through `playerModal`'s ten call
 * sites, the same way the rating editor and the scouting view already are.
 */
const CAREER_LINES = {
  QB: (c) => [c.passYds && `${c.passYds.toLocaleString()} pass yds`, c.passTd && `${c.passTd} TD`, c.rushYds > 200 && `${c.rushYds.toLocaleString()} rush yds`],
  RB: (c) => [c.rushYds && `${c.rushYds.toLocaleString()} rush yds`, c.rushTd && `${c.rushTd} TD`, c.recYds > 200 && `${c.recYds.toLocaleString()} rec yds`],
  WR: (c) => [c.recYds && `${c.recYds.toLocaleString()} rec yds`, c.recTd && `${c.recTd} TD`],
  TE: (c) => [c.recYds && `${c.recYds.toLocaleString()} rec yds`, c.recTd && `${c.recTd} TD`],
  OL: (c) => [],
  DL: (c) => [c.sacks && `${c.sacks} sacks`, c.tackles && `${c.tackles} tackles`],
  LB: (c) => [c.sacks && `${c.sacks} sacks`, c.tackles && `${c.tackles} tackles`, c.interceptions && `${c.interceptions} INT`],
  CB: (c) => [c.interceptions && `${c.interceptions} INT`, c.tackles && `${c.tackles} tackles`],
  S: (c) => [c.interceptions && `${c.interceptions} INT`, c.tackles && `${c.tackles} tackles`],
  K: (c) => [c.fieldGoals && `${c.fieldGoals} field goals`],
  P: (c) => [],
};

export function careerBlock(p) {
  const lg = getState().league;
  const c = lg?.careers?.[p.id];
  if (!c || !c.seasons) return '';
  const stats = (CAREER_LINES[p.pos] || (() => []))(c).filter(Boolean);
  const honours = [
    c.mvp && `${c.mvp}\u00d7 MVP`,
    c.opoy && `${c.opoy}\u00d7 Offensive Player of the Year`,
    c.dpoy && `${c.dpoy}\u00d7 Defensive Player of the Year`,
    c.allLeague && `${c.allLeague}\u00d7 All-League`,
    c.leader && `led the league ${c.leader}\u00d7`,
    c.titles && `${c.titles} title${c.titles === 1 ? '' : 's'}`,
  ].filter(Boolean);
  const clubs = (c.teams || []).map((i) => lg.teams?.[i]?.abbr).filter(Boolean);
  const hof = c.seasons >= HOF_MIN_SEASONS && hallScore(c) >= HOF_THRESHOLD;
  return `<div class="card tight" style="margin:.6rem 0 0">
    <h3>Career <small class="muted" style="text-transform:none;letter-spacing:0">\u00b7 ${c.seasons} season${c.seasons === 1 ? '' : 's'}, ${c.games} game${c.games === 1 ? '' : 's'}${clubs.length > 1 ? ` \u00b7 ${clubs.join(', ')}` : ''}</small></h3>
    ${stats.length ? `<p style="margin:.2rem 0 0;font-size:.92rem">${esc(stats.join(' \u00b7 '))}</p>` : ''}
    ${honours.length ? `<p style="margin:.2rem 0 0;font-size:.92rem"><b>${esc(honours.join(' \u00b7 '))}</b></p>` : ''}
    ${hof ? '<p class="muted" style="margin:.2rem 0 0;font-size:.85rem">In the Hall of Fame.</p>' : ''}
  </div>`;
}

export function playerModal(p, extra = '') {
  const def = POSITIONS[p.pos];
  const editing = !!getState().prefs?.ratingEditor;
  const rows = def.attrs.map((a) => `<div class="slider-row"><div class="lbl"><span>${ATTR_NAMES[a] || a}${p.baseR && p.baseR[a] !== p.r[a] ? ` <small class="muted">(was ${p.baseR[a]})</small>` : ''}</span>${editing ? `<input type="number" class="rating-edit" data-attr="${a}" min="40" max="99" value="${p.r[a]}" style="width:4.5rem;padding:.2rem .4rem;text-align:right">` : `<b>${p.r[a]}</b>`}</div><div class="bar"><i style="width:${p.r[a]}%"></i></div></div>`).join('');
  const m = modal(html`
    <div class="row between"><h2 style="margin:0">${p.name}</h2><span class="row" style="gap:.35rem">${raw(compareButton(p))}<button class="btn sm ghost" data-close aria-label="Close">✕</button></span></div>
    <p class="muted">${def.name} · ${p.generated ? `generated rookie, class of ${p.season}` : `${p.season} ${p.team} · ${eraOf(p.season)}`} · Overall <span id="ovrNow">${ovrBadge(p)}</span></p>
    ${p.retired ? html`<p class="muted" style="margin:-.3rem 0 0">Retired at ${p.age}. He stays in the record books; he cannot be signed.</p>`
      : p.age != null ? html`<p class="muted" style="margin:-.3rem 0 0">Age ${p.age}, ${careerPhase(p.pos, p.age)}${p.base && overall(p) !== overall(p.base) ? ` · ${overall(p) > overall(p.base) ? 'up' : 'down'} ${Math.abs(overall(p) - overall(p.base))}${p.seasons ? ` in ${p.seasons} season${p.seasons === 1 ? '' : 's'}` : ''} from the ${p.base.season} version you signed` : ''}.</p>` : ''}
    ${p.knocks ? html`<p class="muted" style="margin:.2rem 0 0">Came back from ${p.knocks === 1 ? 'a season-ending injury' : `${p.knocks} season-ending injuries`} — a step slower, and ${p.knocks === 1 ? 'a year' : `${p.knocks} years`} off the end of his career.</p>` : ''}
    ${roleLine(p)}
    ${scoutPaceLine(p)}
    ${raw(careerBlock(p))}
    ${raw(rows)}
    ${editing ? html`<small class="muted">Rating editor is on (settings). Edits apply everywhere at once and export as a diff.</small>` : ''}
    ${raw(extra)}
  `);
  // Comparing is a two-tap gesture: arm it on one player, and the next player
  // modal you open offers to finish it. Deliberately not a route and not app
  // state — it is a half-finished gesture, so it dies with the session.
  m.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-cmp-start]')) { setPendingCompare(p); m.close(); toast(`Now pick someone to compare with ${p.name}`); return; }
    if (e.target.closest('[data-cmp-cancel]')) { clearPendingCompare(); m.close(); return; }
    if (e.target.closest('[data-cmp-with]')) {
      const other = pendingCompare();
      clearPendingCompare();
      m.close();
      if (other && other.id !== p.id) compareModal(other, p);
    }
  });
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

// Imported at the foot on purpose. compare.js imports from this file, so the
// two form a cycle; both sides only touch the other inside function bodies,
// which is what keeps it safe.
import { compareButton, compareModal, pendingCompare, setPendingCompare, clearPendingCompare } from './compare.js';

// The pick-trading room, opened from the draft screen.
//
// Deliberately a two-step: pick the sides, then ask what it is worth. Valuing
// a deal drafts the whole board twice, which costs about four hundred
// milliseconds, and a cost like that belongs behind a button the user meant to
// press rather than behind every tick of a checkbox.

import { html, raw } from '../util.js';
import { modal, teamChip, toast, esc } from './components.js';
import {
  remainingPicks, validatePickTrade, projectPickTrade, proposePickTrade,
  needSummary, MAX_PICK_SIDE,
} from '../engine/draftpicks.js';
import { TOTAL_ROUNDS } from '../engine/draft.js';

const POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K', 'P'];

/** "R3 P7" — where a pick actually falls, which is what a drafter thinks in. */
function pickLabel(draft, p) {
  return `R${p.round} · #${p.overall}`;
}

const needChips = (team) => {
  const open = needSummary(team);
  const bits = POS_ORDER.filter((pos) => open[pos]).map((pos) => `<span class="badge need">${pos}${open[pos] > 1 ? ` ×${open[pos]}` : ''}</span>`);
  return bits.length ? bits.join(' ') : '<span class="muted">roster full</span>';
};

/**
 * Open the room. `onDone` is called after a deal goes through so the draft
 * screen can redraw — a swap can move who is on the clock.
 */
export function openPickTrade({ league, draft, pool, byId, userIdx, onDone }) {
  const sel = { partner: league.teams.findIndex((t, i) => i !== userIdx && remainingPicks(draft, i).length), mine: new Set(), theirs: new Set() };
  let valued = null;   // the last projection, cleared whenever the sides change
  let busy = false;
  let m = null;

  const pickRow = (draftPick, side, chosen) => `
    <li class="prow pick-row ${chosen ? 'me' : ''}">
      <div class="who"><div class="nm">${pickLabel(draft, draftPick)}</div>
        <div class="meta">${draftPick.from !== (side === 'mine' ? userIdx : sel.partner) ? `<span class="badge block">from ${esc(league.teams[draftPick.from].abbr)}</span>` : `<span class="muted">round ${draftPick.round} of ${TOTAL_ROUNDS}</span>`}</div>
      </div>
      <div class="act"><button class="btn sm ${chosen ? 'primary' : ''}" data-${side}="${draftPick.overall}">${chosen ? 'In' : 'Add'}</button></div>
    </li>`;

  function body() {
    const partner = league.teams[sel.partner];
    const mine = remainingPicks(draft, userIdx);
    const theirs = remainingPicks(draft, sel.partner);
    const aGives = mine.filter((p) => sel.mine.has(p.overall));
    const bGives = theirs.filter((p) => sel.theirs.has(p.overall));
    const v = aGives.length || bGives.length ? validatePickTrade(league, draft, userIdx, sel.partner, aGives, bGives) : null;
    const ready = !!(v && v.ok);
    const verdict = valued
      ? html`<b style="color:${valued.b > 0 ? 'var(--good)' : valued.b < 0 ? 'var(--bad)' : 'var(--muted)'}">${valued.b > 0 ? '+' : ''}${valued.b}</b> to your finished roster · ${partner.abbr} ${valued.a > 0 ? '+' : ''}${valued.a}`
      : ready ? html`<span class="muted">${aGives.length} for ${bGives.length}. Ask what it is worth.</span>`
      : v ? html`<span style="color:var(--bad)">${v.reason}</span>`
      : html`<span class="muted">Add picks to both sides.</span>`;

    return html`
      <div class="row between"><h2 style="margin:0">Trade picks</h2><button class="btn sm ghost" data-close>✕</button></div>
      <p class="muted" style="margin:.2rem 0 .5rem;font-size:.85rem">A club drafts as many times as it has slots, so picks go one for one — up to ${MAX_PICK_SIDE} a side. To move up, send two near picks for an early one and a late one.</p>
      <div class="row" style="gap:.5rem;align-items:center">
        <label style="margin:0">With</label>
        <select id="pkPartner" style="max-width:16rem">${league.teams.map((t, i) => (i === userIdx || !remainingPicks(draft, i).length ? '' : html`<option value="${i}" ${i === sel.partner ? 'selected' : ''}>${t.abbr} · ${t.name}</option>`))}</select>
      </div>
      <div class="row between" style="margin-top:.4rem;gap:.5rem;flex-wrap:wrap">
        <small class="muted">You still need ${raw(needChips(league.teams[userIdx]))}</small>
        <small class="muted">${teamChip(partner, { abbr: true })} need ${raw(needChips(partner))}</small>
      </div>
      <div class="grid grid-2" style="margin-top:.5rem">
        <div class="card tight"><h3>You give</h3><ul class="plist pick-list">${raw(mine.slice(0, 14).map((p) => pickRow(p, 'mine', sel.mine.has(p.overall))).join(''))}</ul></div>
        <div class="card tight"><h3>You get</h3><ul class="plist pick-list">${raw(theirs.slice(0, 14).map((p) => pickRow(p, 'theirs', sel.theirs.has(p.overall))).join(''))}</ul></div>
      </div>
      <div class="card tight" style="margin-top:.5rem">
        <div class="row between" style="gap:.5rem;flex-wrap:wrap">
          <div style="font-size:.85rem">${busy ? html`<span class="spinner"></span> <span class="muted">drafting both boards…</span>` : verdict}</div>
          <div class="btn-group">
            <button class="btn ghost sm" id="pkClear">Clear</button>
            <button class="btn sm" id="pkValue" ${ready && !busy ? '' : 'disabled'}>Value this deal</button>
            <button class="btn primary" id="pkPropose" ${valued && !busy ? '' : 'disabled'}>Propose</button>
          </div>
        </div>
        ${valued ? html`<p class="muted" style="margin:.4rem 0 0;font-size:.78rem">Both boards were drafted to the last pick, with the model's randomness switched off, and the finished rosters compared. It is the likeliest draft, not the average of every draft.</p>` : ''}
      </div>`;
  }

  function redraw() {
    const wrap = m.el.querySelector('.modal');
    wrap.innerHTML = body().__raw ?? body();
    wire();
  }

  function wire() {
    const el = m.el;
    el.querySelector('#pkPartner')?.addEventListener('change', (e) => {
      sel.partner = Number(e.target.value); sel.theirs.clear(); valued = null; redraw();
    });
    el.querySelector('#pkClear')?.addEventListener('click', () => { sel.mine.clear(); sel.theirs.clear(); valued = null; redraw(); });
    el.querySelector('#pkValue')?.addEventListener('click', () => {
      const mine = remainingPicks(draft, userIdx).filter((p) => sel.mine.has(p.overall));
      const theirs = remainingPicks(draft, sel.partner).filter((p) => sel.theirs.has(p.overall));
      busy = true; redraw();
      // Let the spinner paint before the main thread disappears for a while.
      setTimeout(() => {
        try {
          valued = projectPickTrade(league, draft, pool, byId, sel.partner, userIdx, theirs, mine);
        } catch (err) { toast(err.message); }
        busy = false; redraw();
      }, 20);
    });
    el.querySelector('#pkPropose')?.addEventListener('click', () => {
      const mine = remainingPicks(draft, userIdx).filter((p) => sel.mine.has(p.overall));
      const theirs = remainingPicks(draft, sel.partner).filter((p) => sel.theirs.has(p.overall));
      // Proposing costs the same draft-long projection that valuing does — the
      // club has to work out whether it wants the deal — so it gets the same
      // spinner. Without it the button simply did not respond for a second or
      // two, which read as the game having frozen.
      busy = true; redraw();
      setTimeout(() => {
        let r;
        try {
          r = proposePickTrade(league, draft, pool, byId, userIdx, sel.partner, mine, theirs);
        } catch (err) { busy = false; redraw(); toast(err.message); return; }
        busy = false; redraw();
        if (!r.ok || !r.accepted) { toast(r.reason); return; }
        toast(`Deal: ${league.teams[sel.partner].abbr} take #${mine.map((p) => p.overall).join(', #')}`);
        m.close();
        onDone && onDone(r);
      }, 20);
    });
  }

  /**
   * The rows are rebuilt on every redraw, so they are handled by delegation on
   * the backdrop — which is *not* rebuilt, and so is bound exactly once. Doing
   * it inside `wire` stacked a listener per redraw, and two listeners toggling
   * the same set meant a pick was added and immediately taken off again.
   */
  function bindRows() {
    m.el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-mine]');
      if (a) {
        const n = Number(a.dataset.mine);
        if (sel.mine.has(n)) sel.mine.delete(n);
        else if (sel.mine.size >= MAX_PICK_SIDE) toast(`${MAX_PICK_SIDE} picks a side at most`);
        else sel.mine.add(n);
        valued = null; redraw(); return;
      }
      const b = e.target.closest('[data-theirs]');
      if (b) {
        const n = Number(b.dataset.theirs);
        if (sel.theirs.has(n)) sel.theirs.delete(n);
        else if (sel.theirs.size >= MAX_PICK_SIDE) toast(`${MAX_PICK_SIDE} picks a side at most`);
        else sel.theirs.add(n);
        valued = null; redraw(); return;
      }
    });
  }

  m = modal(body());
  bindRows();
  wire();
  return m;
}

/**
 * A club ringing during the draft. Shown as a card the user answers, the same
 * shape the in-season offers use.
 */
export function pickOfferCard(league, offer) {
  const them = league.teams[offer.from];
  const verdict = offer.userDelta > 4 ? ['Helps your draft', 'var(--good)'] : offer.userDelta >= -2 ? ['About even', 'var(--muted)'] : ['Costs your draft', 'var(--bad)'];
  return `<div class="card tight pick-offer">
    <div class="row between"><b>${teamChip(them).__raw} are on the phone</b><small class="muted">round ${offer.round}</small></div>
    <p class="muted" style="margin:.2rem 0 .4rem;font-size:.85rem">${esc(offer.note)}</p>
    <div class="row between" style="gap:.5rem;flex-wrap:wrap">
      <small style="color:${verdict[1]}">${verdict[0]} <span class="muted">(${offer.userDelta > 0 ? '+' : ''}${offer.userDelta} to your finished roster)</span></small>
      <span class="btn-group"><button class="btn primary sm" data-pkaccept="${esc(offer.id)}">Accept</button><button class="btn sm" data-pkdecline="${esc(offer.id)}">Decline</button></span>
    </div>
  </div>`;
}

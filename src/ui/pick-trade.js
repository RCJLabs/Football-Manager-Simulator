// The pick-trading room, opened from the draft screen.
//
// Deliberately a two-step: pick the sides, then ask what it is worth. Valuing
// a deal drafts the whole board twice, which costs about four hundred
// milliseconds, and a cost like that belongs behind a button the user meant to
// press rather than behind every tick of a checkbox.

import { html, raw } from '../util.js';
import { modal, teamChip, toast, esc } from './components.js';
import {
  usablePicks, validatePickTrade, projectPickTrade, proposePickTrade,
  needSummary, MAX_PICK_SIDE,
} from '../engine/draftpicks.js';
import {
  futureHand, futurePicksOpen, futureSeason, futureLabel, slotBand, projectedSlots,
  FUTURE_ROUNDS,
} from '../engine/futurepicks.js';
import { draftRounds } from '../engine/draft.js';

const POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K', 'P'];

/** "R3 P7" — where a pick actually falls, which is what a drafter thinks in. */
function pickLabel(league, draft, p) {
  return p.future ? futureLabel(league, p) : `R${p.round} · #${p.overall}`;
}

/**
 * One key space for both kinds, because the selection is one list per side and
 * a future pick has no pick number to key on.
 */
const keyOf = (p) => (p.future ? p.key : `n${p.overall}`);

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
  const openFuture = futurePicksOpen(league);
  const canDeal = (i) => i !== userIdx && (usablePicks(league, draft, i).length > 0 || (openFuture && futureHand(league, i).length > 0));
  const sel = { partner: league.teams.findIndex((t, i) => canDeal(i)), mine: new Set(), theirs: new Set() };
  let valued = null;   // the last projection, cleared whenever the sides change
  let busy = false;
  let m = null;

  const pickRow = (draftPick, side, chosen, slots) => {
    const owner = side === 'mine' ? userIdx : sel.partner;
    const meta = draftPick.future
      ? `<span class="muted">${esc(slotBand(league, byId, draftPick.from, slots))}${draftPick.round > 1 ? ` · round ${draftPick.round}` : ''}</span>`
      : draftPick.from !== owner
        ? `<span class="badge block">from ${esc(league.teams[draftPick.from].abbr)}</span>`
        : `<span class="muted">round ${draftPick.round} of ${draftRounds(draft)}</span>`;
    return `
    <li class="prow pick-row ${chosen ? 'me' : ''}">
      <div class="who"><div class="nm">${esc(pickLabel(league, draft, draftPick))}</div>
        <div class="meta">${meta}</div>
      </div>
      <div class="act"><button class="btn sm ${chosen ? 'primary' : ''}" data-${side}="${esc(keyOf(draftPick))}">${chosen ? 'In' : 'Add'}</button></div>
    </li>`;
  };

  /**
   * Both kinds on one side, this year's first, which is the order a GM reads.
   *
   * `usablePicks` rather than everything a club holds: a keeper draft leaves a
   * club with twenty-seven picks and three slots, and listing the twenty-four
   * it will never make buries the three that matter.
   */
  const sidePicks = (idx) => [...usablePicks(league, draft, idx).slice(0, 14), ...(openFuture ? futureHand(league, idx) : [])];

  function body() {
    const partner = league.teams[sel.partner];
    const slots = openFuture ? projectedSlots(league, byId) : null;
    const mine = sidePicks(userIdx);
    const theirs = sidePicks(sel.partner);
    const aGives = mine.filter((p) => sel.mine.has(keyOf(p)));
    const bGives = theirs.filter((p) => sel.theirs.has(keyOf(p)));
    const v = aGives.length || bGives.length ? validatePickTrade(league, draft, userIdx, sel.partner, aGives, bGives) : null;
    const ready = !!(v && v.ok);
    const futureBit = valued?.future
      ? html` <span class="muted">(${valued.future.b > 0 ? '+' : ''}${valued.future.b} of it next year)</span>`
      : '';
    const verdict = valued
      ? html`<b style="color:${valued.b > 0 ? 'var(--good)' : valued.b < 0 ? 'var(--bad)' : 'var(--muted)'}">${valued.b > 0 ? '+' : ''}${valued.b}</b> to your finished roster${futureBit} · ${partner.abbr} ${valued.a > 0 ? '+' : ''}${valued.a}`
      : ready ? html`<span class="muted">${aGives.length} for ${bGives.length}. Ask what it is worth.</span>`
      : v ? html`<span style="color:var(--bad)">${v.reason}</span>`
      : html`<span class="muted">Add picks to both sides.</span>`;

    return html`
      <div class="row between"><h2 style="margin:0">Trade picks</h2><button class="btn sm ghost" data-close>✕</button></div>
      <p class="muted" style="margin:.2rem 0 .5rem;font-size:.85rem">Up to ${MAX_PICK_SIDE} picks a side, and the sides need not match. Send more than you take and you draft that many times fewer, signing the difference off what is left when the season starts.
      <b>Uneven deals are hard to get signed</b>, and the reason is worth knowing: a club cannot use more picks than it has slots, so the spare ones are simply never made. Quantity is worth nothing to whoever receives it, which is why a club will take your two good picks for one of its own and refuse the same trade with your two worst. Value the deal before you send it.</p>
      <div class="row" style="gap:.5rem;align-items:center">
        <label style="margin:0">With</label>
        <select id="pkPartner" style="max-width:16rem">${league.teams.map((t, i) => (canDeal(i) ? html`<option value="${i}" ${i === sel.partner ? 'selected' : ''}>${t.abbr} · ${t.name}</option>` : ''))}</select>
      </div>
      <div class="row between" style="margin-top:.4rem;gap:.5rem;flex-wrap:wrap">
        <small class="muted">You still need ${raw(needChips(league.teams[userIdx]))}</small>
        <small class="muted">${teamChip(partner, { abbr: true })} need ${raw(needChips(partner))}</small>
      </div>
      <div class="grid grid-2" style="margin-top:.5rem">
        <div class="card tight"><h3>You give</h3><ul class="plist pick-list">${raw(mine.map((p) => pickRow(p, 'mine', sel.mine.has(keyOf(p)), slots)).join(''))}</ul></div>
        <div class="card tight"><h3>You get</h3><ul class="plist pick-list">${raw(theirs.map((p) => pickRow(p, 'theirs', sel.theirs.has(keyOf(p)), slots)).join(''))}</ul></div>
      </div>
      ${openFuture ? html`<p class="muted" style="margin:.4rem 0 0;font-size:.78rem">${futureSeason(league)} picks are in the lists too, first ${FUTURE_ROUNDS} rounds only. Where they fall is a <b>guess</b>, made from the roster each club finishes this draft with — not from how it did last year, which barely predicts anything. Both sides guess the same way, so a future pick is a gamble rather than a trap. Only next year's first is worth much: a league that keeps eighteen drafts about nine rounds, so by the second round there is little left worth having. <b>Shop one around</b> — clubs chasing a title now pay the most for this year and least for next, so the same pick fetches different answers.</p>` : ''}
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
      const mine = sidePicks(userIdx).filter((p) => sel.mine.has(keyOf(p)));
      const theirs = sidePicks(sel.partner).filter((p) => sel.theirs.has(keyOf(p)));
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
      const mine = sidePicks(userIdx).filter((p) => sel.mine.has(keyOf(p)));
      const theirs = sidePicks(sel.partner).filter((p) => sel.theirs.has(keyOf(p)));
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
        toast(`Deal: ${league.teams[sel.partner].abbr} take ${mine.map((p) => (p.future ? futureLabel(league, p) : `#${p.overall}`)).join(', ')}`);
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
        const k = a.dataset.mine;
        if (sel.mine.has(k)) sel.mine.delete(k);
        else if (sel.mine.size >= MAX_PICK_SIDE) toast(`${MAX_PICK_SIDE} picks a side at most`);
        else sel.mine.add(k);
        valued = null; redraw(); return;
      }
      const b = e.target.closest('[data-theirs]');
      if (b) {
        const k = b.dataset.theirs;
        if (sel.theirs.has(k)) sel.theirs.delete(k);
        else if (sel.theirs.size >= MAX_PICK_SIDE) toast(`${MAX_PICK_SIDE} picks a side at most`);
        else sel.theirs.add(k);
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

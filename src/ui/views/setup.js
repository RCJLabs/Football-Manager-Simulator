import { html, render, raw } from '../../util.js';
import { createLeague, startSeason, FANTASY_SIZES } from '../../engine/season.js';
import { ROSTER_SLOTS } from '../../data/positions.js';
import { INJURY_LEVEL_LABELS, DEFAULT_INJURY_LEVEL } from '../../engine/injuries.js';
import { defaultKeepers } from '../../engine/season.js';
import { openNewSlot } from '../../store.js';
import { decodeLeagueCode, leagueFromSnapshot } from '../../engine/share.js';
import { autoDraftAll, RNG } from '../../engine/draft.js';
import { autoCompleteAll } from '../../engine/auction.js';
import { PRO_TEAMS, CONFERENCES, DIVISIONS } from '../../data/pro.js';

export function view(root, params, ctx) {
  const hasLeague = !!ctx.getState().league;
  const existing = ctx.getState().league;
  const franchiseOptions = CONFERENCES.map((c, ci) => DIVISIONS.map((d, di) => {
    const opts = PRO_TEAMS.map((t, i) => (t.conf === ci && t.div === di ? `<option value="${i}">${t.name}</option>` : '')).join('');
    return `<optgroup label="${c} ${d}">${opts}</optgroup>`;
  }).join('')).join('');

  render(root, html`
    <div class="card" style="max-width:640px;margin:0 auto">
      <h1>New league</h1>
      ${existing ? html`<div class="notice">Starting a new league replaces your current one (${existing.name}). Export it from Settings first if you want to keep it.</div>` : ''}
      <form id="setup" class="stack" style="margin-top:1rem">
        <div>
          <label>League</label>
          <label class="check"><input type="radio" name="mode" value="fantasy" checked> <span><b>Fantasy league</b> — 8, 10 or 12 clubs, 13 to 14 games, a short bracket.</span></label>
          <label class="check"><input type="radio" name="mode" value="pro"> <span><b>Pro league</b> — the full 32 teams in two conferences of four divisions, a 17-game season, seven playoff seeds per conference with a bye for the top seed.</span></label>
        </div>
        <div id="fantasyOpts" class="form-row">
          <div><label>League name</label><input type="text" name="league" value="All-Time League" maxlength="40"></div>
          <div><label>Teams</label>
            <select name="teams">${raw(FANTASY_SIZES.map((n) => `<option value="${n}" ${n === 8 ? 'selected' : ''}>${n} teams · ${n === 8 ? 14 : 13} games${n === 12 ? ', 6 make the playoffs' : ''}</option>`).join(''))}</select>
            <small class="muted">More teams means thinner rosters. In a 12-team league the bottom of the pool starts every week.</small></div>
        </div>
        <div id="proOpts" hidden>
          <label>Your franchise</label>
          <select name="franchise">${raw(franchiseOptions)}</select>
          <small class="muted">You take over that club. Leave the name fields below blank to keep its identity, or rename it.</small>
        </div>
        <div class="form-row">
          <div><label id="nameLbl">Your team name</label><input type="text" name="name" value="Time Travelers" maxlength="28"></div>
          <div class="row" style="align-items:flex-end">
            <div style="flex:1"><label>Abbreviation</label><input type="text" name="abbr" value="TTV" maxlength="4" pattern="[A-Za-z]{0,4}"></div>
            <div><label>Color</label><input type="color" name="color" value="#e63946"></div>
          </div>
        </div>
        <div>
          <label>How you build your team</label>
          <label class="check"><input type="radio" name="type" value="auction" checked> <span><b>Auction</b> — $200 cap, bid against the other GMs. Star names cost star money, so you cannot have everything.</span></label>
          <label class="check"><input type="radio" name="type" value="snake"> <span><b>Draft</b> — take turns picking, ${ROSTER_SLOTS.length} rounds. The pro league's natural fit: you make ${ROSTER_SLOTS.length} picks and the other 31 rooms pick around you.</span></label>
          <small class="muted" id="typeNote" hidden>A 32-team auction is 832 lots. It works, but set the "only ask me about players rated" slider high or it is a long evening.</small>
        </div>
        <div>
          <label>Who builds it</label>
          <label class="check"><input type="radio" name="draft" value="manual" checked> I'll do it myself</label>
          <label class="check"><input type="radio" name="draft" value="auto"> Fill my roster automatically and jump to the season</label>
        </div>
        <div>
          <label>Injuries</label>
          <div class="row" style="gap:.25rem .9rem;flex-wrap:wrap">
            ${Object.entries(INJURY_LEVEL_LABELS).map(([k, label]) => html`<label class="check" style="margin:0"><input type="radio" name="injuries" value="${k}" ${k === DEFAULT_INJURY_LEVEL ? 'checked' : ''}> ${label}</label>`)}
          </div>
          <small class="muted">Normal costs a club about one starter a week, well under the real league's rate. High is closer to it. Hurt players sit out and the next man on the depth chart plays; the waiver wire is where you find cover.</small>
        </div>
        <div>
          <label>Keepers per club</label>
          <select name="keepers" style="max-width:12rem">${[0, 3, 6, 9, 12, 18, 22].map((n) => html`<option value="${n}" ${n === defaultKeepers('fantasy') ? 'selected' : ''}>${n === 0 ? 'None: full re-auction every year' : `${n} players`}</option>`)}</select>
          <small class="muted">Each offseason a club keeps this many players (a keeper costs last year's price plus 15% or $3; three years running at most) and the rest go back to the pool. Fantasy leagues default to 6, the pro league to 18.</small>
        </div>
        <div>
          <label>Game control</label>
          <label class="check"><input type="checkbox" name="coach"> Coach mode: I call the offensive plays in my games</label>
          <label class="check"><input type="checkbox" name="coachDef"> …and the defensive calls too</label>
        </div>
        <div class="row" style="margin-top:.5rem">
          <button class="btn primary lg" type="submit">Create league</button>
          <a class="btn ghost" href="#/">Cancel</a>
        </div>
        ${hasLeague ? html`<small class="muted" style="display:block;margin-top:.5rem">Your current league stays saved in its own slot; this one gets a new slot.</small>` : ''}
      </form>
    </div>
    <details class="card" style="margin-top:.75rem"><summary style="cursor:pointer"><b>Have a league code?</b> <span class="muted">Open a friend's league with the same rosters.</span></summary>
      <textarea id="code" rows="3" placeholder="Paste the code here" style="margin-top:.5rem"></textarea>
      <div class="row" style="margin-top:.5rem"><button class="btn" id="openCode" type="button">Open from code</button></div>
      <small class="muted" id="codeNote"></small>
    </details>
  `);
  root.querySelector('#openCode').addEventListener('click', async () => {
    const note = root.querySelector('#codeNote');
    try {
      const snap = await decodeLeagueCode(root.querySelector('#code').value);
      const league = leagueFromSnapshot(snap, ctx.players, ctx.byId);
      if (hasLeague) openNewSlot(league.name);
      ctx.update((s) => { s.league = league; s.game = null; }, { silent: true });
      ctx.toast('League opened from code');
      ctx.navigate('#/season');
    } catch (err) { note.textContent = err.message; }
  });

  const form = root.querySelector('#setup');
  const modeInputs = form.querySelectorAll('input[name="mode"]');
  const syncMode = () => {
    const pro = form.mode.value === 'pro';
    form.querySelector('#fantasyOpts').hidden = pro;
    form.querySelector('#proOpts').hidden = !pro;
    form.querySelector('#nameLbl').textContent = pro ? 'Rename the franchise (optional)' : 'Your team name';
    form.name.placeholder = pro ? 'Leave blank to keep the franchise name' : '';
    form.querySelector('#typeNote').hidden = !pro;
    if (pro && !form.dataset.touchedType) form.querySelector('input[name="type"][value="snake"]').checked = true;
    if (!form.dataset.touchedKeepers) form.keepers.value = String(defaultKeepers(pro ? 'pro' : 'fantasy'));
    if (!pro && !form.dataset.touchedType) form.querySelector('input[name="type"][value="auction"]').checked = true;
    if (pro) { form.name.value = form.name.value === 'Time Travelers' ? '' : form.name.value; form.abbr.value = form.abbr.value === 'TTV' ? '' : form.abbr.value; }
    else { if (!form.name.value) form.name.value = 'Time Travelers'; if (!form.abbr.value) form.abbr.value = 'TTV'; }
  };
  modeInputs.forEach((i) => i.addEventListener('change', syncMode));
  form.querySelectorAll('input[name="type"]').forEach((i) => i.addEventListener('change', () => { form.dataset.touchedType = '1'; }));

  form.keepers.addEventListener('change', () => { form.dataset.touchedKeepers = '1'; });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const mode = f.get('mode') === 'pro' ? 'pro' : 'fantasy';
    const draftType = f.get('type') === 'snake' ? 'snake' : 'auction';
    const name = (f.get('name') || '').trim();
    const abbr = (f.get('abbr') || '').trim();
    const user = mode === 'pro'
      ? { name: name || undefined, abbr: abbr || undefined, color: form.dataset.touchedColor ? f.get('color') : undefined }
      : { name: name || 'My Team', abbr: abbr || 'ME', color: f.get('color') };
    const league = createLeague({
      name: mode === 'pro' ? 'Pro League' : ((f.get('league') || '').trim() || 'All-Time League'),
      mode,
      numTeams: Number(f.get('teams')),
      franchise: Number(f.get('franchise')),
      draftType,
      user,
      injuries: f.get('injuries') || DEFAULT_INJURY_LEVEL,
      keepers: Number(f.get('keepers')),
    });
    league.settings.coachMode = f.get('coach') === 'on';
    league.settings.coachDefense = f.get('coachDef') === 'on';
    const auto = f.get('draft') === 'auto';
    if (auto) {
      const rng = new RNG(league.rngState);
      if (draftType === 'auction') autoCompleteAll(league.auction, league, ctx.players, rng, ctx.byId);
      else autoDraftAll(league, league.draft, ctx.players, rng);
      league.rngState = rng.state;
      startSeason(league, ctx.byId);
    }
    if (hasLeague) openNewSlot(league.name);
    ctx.update((s) => { s.league = league; s.game = null; }, { silent: true });
    ctx.navigate(auto ? '#/season' : (draftType === 'auction' ? '#/auction' : '#/draft'));
  });
  form.color.addEventListener('input', () => { form.dataset.touchedColor = '1'; });
}

import { html, render, raw } from '../../util.js';
import { createLeague, startSeason, FANTASY_SIZES } from '../../engine/season.js';
import { ROSTER_SLOTS } from '../../data/positions.js';
import { INJURY_LEVEL_LABELS, DEFAULT_INJURY_LEVEL } from '../../engine/injuries.js';
import { defaultKeepers } from '../../engine/season.js';
import { openNewSlot, hasEmptySlot, listSlots } from '../../store.js';
import { decodeLeagueCode, leagueFromSnapshot } from '../../engine/share.js';
import { autoDraftAll, RNG } from '../../engine/draft.js';
import { autoCompleteAll, BUDGET_SPREADS} from '../../engine/auction.js';
import { PRO_TEAMS, CONFERENCES, DIVISIONS } from '../../data/pro.js';
import { DIFFICULTY, LEVELS, DEFAULT_DIFFICULTY } from '../../engine/difficulty.js';

export function view(root, params, ctx) {
  const hasLeague = !!ctx.getState().league;
  const existing = ctx.getState().league;
  const franchiseOptions = CONFERENCES.map((c, ci) => DIVISIONS.map((d, di) => {
    const opts = PRO_TEAMS.map((t, i) => (t.conf === ci && t.div === di ? `<option value="${i}">${t.name}</option>` : '')).join('');
    return `<optgroup label="${c} ${d}">${opts}</optgroup>`;
  }).join('')).join('');

  render(root, html`
    <div class="has-actionbar">
    <div class="card" style="max-width:640px;margin:0 auto">
      <h1>New league</h1>
      ${existing ? html`<p class="muted" style="margin:.25rem 0 0;font-size:.9rem">${existing.name} stays saved in its own slot; switch between them from the home screen.</p>` : ''}
      <form id="setup" class="stack" style="margin-top:1rem">
        <div>
          <label>League</label>
          <label class="check"><input type="radio" name="mode" value="fantasy" checked> <span><b>Fantasy league</b> — 8 to 12 clubs, a 14-game season.</span></label>
          <label class="check"><input type="radio" name="mode" value="pro"> <span><b>Pro league</b> — all 32 teams, divisions, a 17-game season.</span></label>
        </div>
        <div><label>League name</label><input type="text" name="league" value="All-Time League" maxlength="40"></div>
        <div id="fantasyOpts" class="form-row">
          <div><label>Teams</label>
            <select name="teams">${raw(FANTASY_SIZES.map((n) => `<option value="${n}" ${n === 8 ? 'selected' : ''}>${n} teams · ${n === 8 ? 14 : 13} games${n === 12 ? ', 6 make the playoffs' : ''}</option>`).join(''))}</select>
            <small class="muted">More teams means thinner rosters.</small></div>
        </div>
        <div id="proOpts" hidden>
          <label>Your franchise</label>
          <select name="franchise">${raw(franchiseOptions)}</select>
          <small class="muted">You take over that club. Leave the fields below blank to keep its identity.</small>
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
          <label class="check"><input type="radio" name="type" value="auction" checked> <span><b>Auction</b> — $200 cap, bid against the other GMs.</span></label>
          <label class="check"><input type="radio" name="type" value="snake"> <span><b>Draft</b> — take turns picking, ${ROSTER_SLOTS.length} rounds.</span></label>
          <small class="muted" id="typeNote" hidden>A 32-team auction is 832 lots. It works, but set the "only ask me about players rated" slider high or it is a long evening.</small>
          <div id="spreadRow" style="margin-top:.5rem">
            <label for="spread">Cap room</label>
            <select name="spread" id="spread">
              <option value="even" selected>Same for everyone — $200</option>
              <option value="mild">A little uneven — $180–$220</option>
              <option value="wide">Uneven — $160–$240</option>
            </select>
            <small class="muted">Drawn at random, yours included. The room holds the same money either way — it is just shared out unevenly. Uneven roughly doubles how far the best squad finishes ahead of the worst.</small>
          </div>
        </div>
        <div>
          <label>Who builds it</label>
          <label class="check"><input type="radio" name="draft" value="manual" checked> I'll do it myself</label>
          <label class="check"><input type="radio" name="draft" value="auto"> Fill my roster automatically and jump to the season</label>
        </div>
        <div>
          <label>How good the opposition is</label>
          <select name="difficulty" style="max-width:14rem">${LEVELS.map((k) => html`<option value="${k}" ${k === DEFAULT_DIFFICULTY ? 'selected' : ''}>${DIFFICULTY[k].label}</option>`)}</select>
          <small class="muted" id="diffNote">${DIFFICULTY[DEFAULT_DIFFICULTY].blurb}</small>
          <small class="muted" style="display:block;margin-top:.3rem">It moves how the other clubs bid, scout and trade — never the simulation.</small>
        </div>
        <details id="moreOpts" class="fold">
          <summary><b>More options</b> <span class="muted">— injuries, keepers, ageing, chemistry, scouting, coach mode. Every one has a sensible default.</span></summary>
          <div class="stack" style="margin-top:.75rem">
            <div>
              <label>Injuries</label>
              <div class="row" style="gap:.25rem .9rem;flex-wrap:wrap">
                ${Object.entries(INJURY_LEVEL_LABELS).map(([k, label]) => html`<label class="check" style="margin:0"><input type="radio" name="injuries" value="${k}" ${k === DEFAULT_INJURY_LEVEL ? 'checked' : ''}> ${label}</label>`)}
              </div>
              <small class="muted">Normal costs a club about one starter a week, well under the real league's rate. High is closer to it. Hurt players sit out and the next man on the depth chart plays; the waiver wire is where you find cover.</small>
            </div>
            <div id="proKeeperNote" hidden>
              <label>Keepers per club</label>
              <small class="muted">A pro league has no keeper quota. Every man under contract stays; the salary cap and the length of his deal decide who you can afford to keep, which turns over about nine slots a club a year. Two mechanisms of attrition would double-count, so there is nothing to set here.</small>
            </div>
            <div id="keeperOpt">
              <label>Keepers per club</label>
              <select name="keepers" style="max-width:12rem">${[0, 3, 6, 9, 12, 18, 22].map((n) => html`<option value="${n}" ${n === defaultKeepers('fantasy') ? 'selected' : ''}>${n === 0 ? 'None: full re-auction every year' : `${n} players`}</option>`)}</select>
              <small class="muted">Each offseason a club keeps this many players (a keeper costs last year's price plus 15% or $3; three years running at most) and the rest go back to the pool. Fantasy leagues default to 6. A pro league does not use this: the salary cap decides who stays.</small>
            </div>
            <div>
              <label>Careers</label>
              <label class="check"><input type="checkbox" name="careers" checked> Players age: rostered men get a year older each offseason, rookies develop, the old retire</label>
              <label class="check"><input type="checkbox" name="chemistry" checked> Chemistry: a settled squad from a tight era band plays a little better</label>
              <label class="check"><input type="checkbox" name="scouting" checked> Scouting: a rookie shows a projected range until he has played a season</label>
              <label class="check"><input type="checkbox" name="focus" checked> Development focus: name up to three men a season for your staff to develop, at a cost to the rest</label>
              <label class="check" id="positionsOpt" hidden><input type="checkbox" name="positions" checked> Position changes: move a man to a position his skills translate to, safety to corner and the like (pro league only)</label>
              <label class="check" id="jobsOpt" hidden><input type="checkbox" name="jobs" checked> Coaching jobs: an owner with expectations, rivals who get sacked, and a career you can be moved around (pro league only)</label>
              <small class="muted">The pool stays frozen at its prime until you sign a man — the auction is the same puzzle either way. It is what happens after that changes: a keeper's third year is not his first, and a 63-overall rookie can become an 80 if you are patient.</small>
            </div>
            <div>
              <label>Game control</label>
              <label class="check"><input type="checkbox" name="coach"> Coach mode: I call the offensive plays in my games</label>
              <label class="check"><input type="checkbox" name="coachDef"> …and the defensive calls too</label>
            </div>
          </div>
        </details>
        <!-- Sticky, because every field above it has a working default and a
             first-time player should never have to read the whole form to find
             out they could have started immediately. Measured before this: the
             button sat 1.6 screens down at phone height. -->
        <div class="actionbar">
          <a class="btn ghost" href="#/">Cancel</a>
          <button class="btn primary lg" type="submit">Create league</button>
        </div>
      </form>
    </div>
    <details id="codeBlock" class="card" style="margin-top:.75rem"><summary style="cursor:pointer"><b>Have a league code?</b> <span class="muted">Open a friend's league with the same rosters.</span></summary>
      <textarea id="code" rows="3" placeholder="Paste the code here" style="margin-top:.5rem"></textarea>
      <div class="row" style="margin-top:.5rem"><button class="btn" id="openCode" type="button">Open from code</button></div>
      <small class="muted" id="codeNote"></small>
    </details>
    </div>
  `);
  root.querySelector('#openCode').addEventListener('click', async () => {
    const note = root.querySelector('#codeNote');
    try {
      const snap = await decodeLeagueCode(root.querySelector('#code').value);
      const league = leagueFromSnapshot(snap, ctx.players, ctx.byId);
      if (hasLeague && !hasEmptySlot()) { note.textContent = 'All three save slots are full — delete one on the home screen first.'; return; }
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
    form.querySelector('#jobsOpt').hidden = !pro;
    form.querySelector('#positionsOpt').hidden = !pro;
    if (pro && !form.dataset.touchedType) form.querySelector('input[name="type"][value="snake"]').checked = true;
    // A pro league keeps whoever it can afford, so the quota is meaningless
    // there: `keeperLimit` returns the whole roster under a cap. The control
    // used to be shown anyway, defaulted to 18, and silently ignored.
    form.querySelector('#keeperOpt').hidden = pro;
    form.querySelector('#proKeeperNote').hidden = !pro;
    if (!pro && !form.dataset.touchedKeepers) form.keepers.value = String(defaultKeepers('fantasy'));
    if (!pro && !form.dataset.touchedType) form.querySelector('input[name="type"][value="auction"]').checked = true;
    if (!form.dataset.touchedLeague) form.league.value = pro ? 'Pro League' : 'All-Time League';
    if (pro) { form.name.value = form.name.value === 'Time Travelers' ? '' : form.name.value; form.abbr.value = form.abbr.value === 'TTV' ? '' : form.abbr.value; }
    else { if (!form.name.value) form.name.value = 'Time Travelers'; if (!form.abbr.value) form.abbr.value = 'TTV'; }
  };
  // Cap room is an auction idea; a snake draft has no money in it. The row
  // starts visible because auction is the default, which is the same way the
  // rest of this form's conditional bits are set up.
  const syncType = () => { form.querySelector('#spreadRow').hidden = form.type.value !== 'auction'; };
  modeInputs.forEach((i) => i.addEventListener('change', () => { syncMode(); syncType(); }));
  form.querySelectorAll('input[name="type"]').forEach((i) => i.addEventListener('change', () => { form.dataset.touchedType = '1'; syncType(); }));

  form.keepers.addEventListener('change', () => { form.dataset.touchedKeepers = '1'; });
  form.league.addEventListener('input', () => { form.dataset.touchedLeague = '1'; });
  form.difficulty.addEventListener('change', () => { form.querySelector('#diffNote').textContent = DIFFICULTY[form.difficulty.value].blurb; });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    // Three saves, and a new league needs one of them. Refusing here is the
    // whole point of a fixed number of slots: the alternative is writing over
    // a dynasty somebody has been playing for nine seasons.
    if (hasLeague && !hasEmptySlot()) {
      const { max } = listSlots();
      ctx.toast(`All ${max} save slots are full — delete one on the home screen first`);
      ctx.navigate('#/');
      return;
    }
    const f = new FormData(form);
    const mode = f.get('mode') === 'pro' ? 'pro' : 'fantasy';
    const draftType = f.get('type') === 'snake' ? 'snake' : 'auction';
    const name = (f.get('name') || '').trim();
    const abbr = (f.get('abbr') || '').trim();
    const user = mode === 'pro'
      ? { name: name || undefined, abbr: abbr || undefined, color: form.dataset.touchedColor ? f.get('color') : undefined }
      : { name: name || 'My Team', abbr: abbr || 'ME', color: f.get('color') };
    const league = createLeague({
      name: (f.get('league') || '').trim() || (mode === 'pro' ? 'Pro League' : 'All-Time League'),
      mode,
      numTeams: Number(f.get('teams')),
      franchise: Number(f.get('franchise')),
      draftType,
      user,
      injuries: f.get('injuries') || DEFAULT_INJURY_LEVEL,
      keepers: Number(f.get('keepers')),
      budgetSpread: draftType === 'auction' ? (BUDGET_SPREADS[f.get('spread')] ?? 0) : 0,
    });
    league.settings.coachMode = f.get('coach') === 'on';
    league.settings.coachDefense = f.get('coachDef') === 'on';
    league.settings.careers = f.get('careers') === 'on';
    league.settings.chemistry = f.get('chemistry') === 'on';
    league.settings.scouting = f.get('scouting') === 'on';
    league.settings.focus = f.get('focus') === 'on';
    league.settings.jobs = mode === 'pro' && f.get('jobs') === 'on';
    league.settings.positions = mode === 'pro' && f.get('positions') === 'on';
    league.settings.difficulty = LEVELS.includes(f.get('difficulty')) ? f.get('difficulty') : DEFAULT_DIFFICULTY;
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

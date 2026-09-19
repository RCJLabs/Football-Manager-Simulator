import { html, render, raw } from '../../util.js';
import { teamChip, esc } from '../components.js';
import { userTeamIndex, isPro } from '../../engine/season.js';
import { jobsOn, careerSummary, yourCoach, coachOf, seatWarmth, goalFor } from '../../engine/jobs.js';

const pct = (w, l, t) => { const g = w + l + t; return g ? ((w + t * 0.5) / g * 100).toFixed(1) : '0.0'; };

export function view(root, params, ctx) {
  const { league } = ctx.getState();
  if (!league) { ctx.navigate('#/new'); return; }
  if (!jobsOn(league)) {
    render(root, html`<div id="career-view"><div class="card">
      <h1>No coaching career here</h1>
      <p class="muted">${isPro(league) ? 'This league has coaching jobs switched off; you can turn them on in settings.' : 'Coaching jobs run in the pro league only. An eight or twelve club league has no job market worth the name — a handful of clubs and no carousel to speak of.'}</p>
      <div class="row" style="margin-top:.5rem"><a class="btn" href="#/season">Back to the season</a></div>
    </div></div>`);
    return;
  }

  const c = careerSummary(league);
  const you = yourCoach(league);
  const u = userTeamIndex(league);
  const seat = league.jobs.status === 'employed' ? seatWarmth(league, u) : null;
  const goal = league.jobs.status === 'employed' ? goalFor(league, u, ctx.byId) : null;

  // Everyone else in the job, longest-serving first, so the carousel is a thing
  // you can read rather than something that happens offscreen.
  const rivals = league.teams
    .map((t, i) => ({ t, i, coach: coachOf(league, i) }))
    .filter((r) => r.coach && !r.coach.you)
    .sort((a, b) => b.coach.rep - a.coach.rep);

  const log = (league.jobs.log || []).slice().reverse().slice(0, 12);

  render(root, html`<div id="career-view">
    <div class="card">
      <h1 style="margin:0">Your coaching career</h1>
      <p class="muted" style="margin:.3rem 0 0">
        ${c.status === 'retired' ? 'Finished.' : `${c.seasons} season${c.seasons === 1 ? '' : 's'} in the job, currently with ${league.teams[u].name}.`}
        Reputation <b>${c.rep}</b>.
      </p>
      ${seat ? html`<p class="muted" style="font-size:.9rem;margin:.4rem 0 0"><span class="seat ${seat.band}">${seat.band === 'hot' ? 'Hot seat' : seat.band === 'warm' ? 'Under pressure' : 'Secure'}</span> ${seat.text} The owner wants you to <b>${goal.text}</b>.</p>` : ''}
      <div class="table-wrap" style="margin-top:.6rem"><table><tbody>
        <tr><td>Record</td><td class="num"><b>${c.w}-${c.l}${c.t ? `-${c.t}` : ''}</b> · ${pct(c.w, c.l, c.t)}%</td></tr>
        <tr><td>Titles</td><td class="num"><b>${c.titles}</b></td></tr>
        <tr><td>Times sacked</td><td class="num"><b>${c.sacked}</b></td></tr>
      </tbody></table></div>
    </div>

    <div class="grid grid-2" style="margin-top:.75rem">
      <div class="card tight">
        <h3>Where you have worked</h3>
        <div class="table-wrap"><table><thead><tr><th>Club</th><th class="num">Seasons</th></tr></thead><tbody>
          ${c.clubs.map((j) => html`<tr><td>${j.name}</td><td class="num">${j.from}${j.to ? `–${j.to}` : ' – now'}</td></tr>`)}
        </tbody></table></div>
      </div>
      <div class="card tight">
        <h3>The carousel</h3>
        ${log.length ? html`<ul class="log">${log.map((l) => html`<li><span class="muted">S${l.season}</span> ${l.text}</li>`)}</ul>`
    : html`<p class="muted" style="font-size:.9rem">Nobody has moved yet.</p>`}
      </div>
    </div>

    <div class="card tight" style="margin-top:.75rem">
      <h3>Coaches around the league <small class="muted" style="text-transform:none;letter-spacing:0">· by reputation</small></h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Coach</th><th>Club</th><th class="num">Rep</th><th class="num hide-sm">Record</th><th class="num hide-sm">Titles</th><th class="num">Seat</th></tr></thead>
        <tbody>${raw(rivals.map((r) => {
    const w = seatWarmth(league, r.i);
    return `<tr><td>${esc(r.coach.name)}</td><td>${teamChip(r.t, { responsive: true }).__raw}</td><td class="num">${r.coach.rep}</td><td class="num hide-sm">${r.coach.w}-${r.coach.l}</td><td class="num hide-sm">${r.coach.titles}</td><td class="num"><span class="seat ${w.band}">${w.band}</span></td></tr>`;
  }).join(''))}</tbody>
      </table></div>
      <small class="muted">Every one of them is under the same pressure you are. When one goes, his job is on the market — which is the only reason anybody would ever call you.</small>
    </div>
  </div>`);
}

// The race: how each club's chances have moved week by week, and the reading
// the hub leads with. The readings are odds.js's, kept on the league by week.

import { esc } from '../util.js';
import { oddsPoints } from '../engine/odds.js';
import { isPro } from '../engine/season.js';

/**
 * A share in thousandths as the screen shows it. Never 0% or 100% unless the
 * clinch markers say so, because a thousand finishes can miss a chance that
 * is small without it being none: `sure` and `gone` are the markers' word.
 */
export function fmtShare(mille, { sure = false, gone = false } = {}) {
  if (gone) return 'Out';
  if (sure) return 'In';
  if (mille == null) return '—';
  if (mille >= 995) return '>99%';
  if (mille < 5) return '<1%';
  return `${Math.round(mille / 10)}%`;
}

/** The club's line for the hub: "Playoffs 64% ▲6 · Division 22% · Title 5%". */
export function oddsLine(league, u, marks = {}) {
  const pts = oddsPoints(league);
  const now = pts[pts.length - 1];
  if (!now) return '';
  const m = marks[u] || {};
  if (now.key.startsWith('p')) {
    const alive = (league.playoffs?.pools || []).some((p) => p.alive.includes(u));
    return alive ? `Title <b>${fmtShare(now.title[u])}</b>` : '';
  }
  const prev = [...pts].reverse().find((p) => p !== now && p.key.startsWith('w'));
  const move = prev ? Math.round((now.playoff[u] - prev.playoff[u]) / 10) : 0;
  const arrow = !m.playoff && !m.eliminated && Math.abs(move) >= 1
    ? ` <span class="odds-move ${move > 0 ? 'up' : 'down'}" title="since last week">${move > 0 ? '▲' : '▼'}${Math.abs(move)}</span>` : '';
  const parts = [`Playoffs <b>${fmtShare(now.playoff[u], { sure: m.playoff, gone: m.eliminated })}</b>${arrow}`];
  if (isPro(league)) parts.push(`Division <b>${m.division ? 'Won' : fmtShare(now.division[u], { gone: m.eliminated })}</b>`);
  parts.push(`Title <b>${m.eliminated ? 'Out' : fmtShare(now.title[u])}</b>`);
  return parts.join(' · ');
}

// Lines other than the human's, in an order that stays readable on the dark
// ground; the human's own is the accent.
const PALETTE = ['#7cc4f5', '#57cc99', '#f4a261', '#c3a6ff', '#ef6461'];

/**
 * Who the chart follows beside the human: a pro club's own division, or in a
 * fantasy league the three clubs whose latest chance is nearest the human's.
 */
function rivalsOf(league, u, latest, metric) {
  const t = league.teams[u];
  if (isPro(league)) return league.teams.map((x, i) => i).filter((i) => i !== u && league.teams[i].conf === t.conf && league.teams[i].div === t.div);
  return league.teams.map((_, i) => i).filter((i) => i !== u)
    .sort((a, b) => Math.abs(latest[metric][a] - latest[metric][u]) - Math.abs(latest[metric][b] - latest[metric][u]) || a - b)
    .slice(0, 3);
}

/** The metrics the season so far can draw: the playoff race, and the title once there are two readings of it. */
export function raceMetrics(league) {
  const pts = oddsPoints(league);
  const out = [];
  if (pts.filter((p) => p.key.startsWith('w')).length >= 2) out.push('playoff');
  if (pts.length >= 2) out.push('title');
  return out;
}

/**
 * The race chart: a chance by week for the human's club and its rivals, the
 * human's line drawn last and thickest, each labelled where it ends.
 */
export function raceChart(league, u, metric = 'playoff') {
  const pts = oddsPoints(league).filter((p) => metric === 'title' || p.key.startsWith('w'));
  if (pts.length < 2) return '';
  const latest = pts[pts.length - 1];
  const clubs = [...rivalsOf(league, u, latest, metric), u];
  const W = 600, H = 180, padL = 58, padR = 56, padT = 12, padB = 26;
  const x = (i) => padL + (i / (pts.length - 1)) * (W - padL - padR);
  const y = (mille) => padT + (1 - mille / 1000) * (H - padT - padB);
  const label = (p) => (p.key.startsWith('w') ? `W${p.key.slice(1)}` : `PO${p.key.slice(1)}`);
  const grid = [0, 500, 1000].map((v) => `<line x1="${padL}" x2="${W - padR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--line)" stroke-width="1"${v === 500 ? ' stroke-dasharray="4 4"' : ''}/><text x="${padL - 6}" y="${(y(v) + 5).toFixed(1)}" text-anchor="end" class="race-axis">${v / 10}%</text>`).join('');
  const ticks = [0, Math.floor((pts.length - 1) / 2), pts.length - 1].filter((v, i, a) => a.indexOf(v) === i)
    .map((i) => `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="race-axis">${label(pts[i])}</text>`).join('');
  const colour = (i, k) => (i === u ? 'var(--accent)' : PALETTE[k % PALETTE.length]);
  const lines = clubs.map((i, k) => {
    const d = pts.map((p, j) => `${j ? 'L' : 'M'}${x(j).toFixed(1)},${y(p[metric][i]).toFixed(1)}`).join(' ');
    return `<path d="${d}" fill="none" stroke="${colour(i, k)}" stroke-width="${i === u ? 3 : 1.6}" stroke-linejoin="round"${i === u ? '' : ' stroke-opacity="0.9"'}/>`;
  }).join('');
  // End labels, pushed apart where lines finish close together.
  const ends = clubs.map((i, k) => ({ i, k, y: y(latest[metric][i]) })).sort((a, b) => a.y - b.y);
  for (let j = 1; j < ends.length; j++) if (ends[j].y - ends[j - 1].y < 20) ends[j].y = ends[j - 1].y + 20;
  const over = ends.length ? ends[ends.length - 1].y - (H - 8) : 0;
  if (over > 0) for (const e of ends) e.y -= over;
  const tags = ends.map((e) => `<text x="${W - padR + 6}" y="${(e.y + 5).toFixed(1)}" class="race-tag${e.i === u ? ' me' : ''}" fill="${colour(e.i, e.k)}">${esc(league.teams[e.i].abbr)}</text>`).join('');
  const what = metric === 'title' ? 'Title chances' : 'Playoff chances';
  const said = clubs.map((i) => `${league.teams[i].abbr} ${Math.round(latest[metric][i] / 10)} percent`).join(', ');
  return `<svg class="chart race" viewBox="0 0 ${W} ${H}" role="img" aria-label="${what} by week: ${esc(said)}">${grid}${ticks}${lines}${tags}</svg>`;
}

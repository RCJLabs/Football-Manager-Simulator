// Small inline-SVG charts for the game screens. Everything scales with the
// viewBox, so a chart is as wide as its card on a phone and on a desktop.
import { esc } from '../util.js';
import { fmtClock, fmtQuarter } from '../engine/stats.js';
import { TURNING_POINT, FAINT_TURN } from '../engine/winprob.js';

const clampPct = (p) => Math.max(0, Math.min(1, p));

/**
 * Win probability over the game for the home side, drawn as a filled band
 * around the 50% line with quarter markers. `events` are log entries that
 * carry `wp` (see winprob.js); entries without it are skipped.
 */
export function wpChart(events, teams, { height = 90 } = {}) {
  const pts = events.filter((e) => typeof e.wp === 'number');
  if (pts.length < 2) return '';
  const W = 600, H = height, padL = 4, padR = 4, padT = 6, padB = 6;
  const n = pts.length;
  const x = (i) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (p) => padT + (1 - clampPct(p)) * (H - padT - padB);
  const path = pts.map((e, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(e.wp).toFixed(1)}`).join(' ');
  const area = `${path} L${x(n - 1).toFixed(1)},${y(0.5).toFixed(1)} L${x(0).toFixed(1)},${y(0.5).toFixed(1)} Z`;
  // Quarter boundaries.
  const marks = [];
  for (let i = 1; i < n; i++) if (pts[i].q !== pts[i - 1].q) marks.push({ i, q: pts[i].q });
  const [home, away] = teams;
  const last = pts[n - 1].wp;
  return `<svg class="chart wp" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Win probability, ${esc(home.abbr)} ${Math.round(last * 100)} percent">
    <defs><clipPath id="wpTop"><rect x="0" y="0" width="${W}" height="${y(0.5)}"/></clipPath><clipPath id="wpBot"><rect x="0" y="${y(0.5)}" width="${W}" height="${H - y(0.5)}"/></clipPath></defs>
    <line x1="${padL}" x2="${W - padR}" y1="${y(0.5)}" y2="${y(0.5)}" stroke="var(--line)" stroke-width="1"/>
    ${marks.map((m) => `<line x1="${x(m.i).toFixed(1)}" x2="${x(m.i).toFixed(1)}" y1="${padT}" y2="${H - padB}" stroke="var(--line)" stroke-dasharray="3 3"/>`).join('')}
    <path d="${area}" fill="${esc(home.color)}" fill-opacity="0.35" clip-path="url(#wpTop)"/>
    <path d="${area}" fill="${esc(away.color)}" fill-opacity="0.35" clip-path="url(#wpBot)"/>
    <path d="${path}" fill="none" stroke="var(--text)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

/** Text for the live readout: "TTV 63%" from the home side's probability. */
export function wpLabel(wp, teams) {
  if (typeof wp !== 'number') return '';
  const homeFav = wp >= 0.5;
  const t = homeFav ? teams[0] : teams[1];
  const p = Math.round((homeFav ? wp : 1 - wp) * 100);
  return `${t.abbr} ${p}%`;
}

const RESULT_LABEL = {
  TD: 'TD', FG: 'FG', 'missed FG': 'FG miss', punt: 'Punt', interception: 'INT', fumble: 'Fumble',
  'turnover on downs': 'Downs', safety: 'Safety', 'end of half': 'Half', 'end of game': 'End', 'end of regulation': 'End', 'end of quarter': '',
};

/**
 * Drive chart: one row per drive, drawn on a 100-yard field from the offense's
 * own goal line (left) to the opponent's (right). Bar colour is the club,
 * length is yards gained, and the result sits at the end of the bar.
 */
export function driveChart(drives, teams, { rowH = 14 } = {}) {
  const list = (drives || []).filter((d) => d.result && d.result !== 'end of quarter');
  if (!list.length) return '';
  const W = 600, padL = 36, padR = 46, H = list.length * rowH + 22;
  const fx = (yd) => padL + (Math.max(0, Math.min(100, yd)) / 100) * (W - padL - padR);
  const rows = list.map((d, i) => {
    const t = teams[d.team];
    const y0 = 16 + i * rowH;
    const start = d.startBallOn, end = Math.max(0, Math.min(100, d.endBallOn ?? d.startBallOn + d.yards));
    const x1 = fx(Math.min(start, end)), x2 = fx(Math.max(start, end));
    const label = RESULT_LABEL[d.result] ?? d.result;
    const score = d.result === 'TD' || d.result === 'FG';
    return `<g>
      <text x="${padL - 4}" y="${y0 + rowH * 0.7}" text-anchor="end" font-size="9" fill="var(--muted)">${esc(t.abbr)}</text>
      <rect x="${x1.toFixed(1)}" y="${y0 + 2}" width="${Math.max(2, x2 - x1).toFixed(1)}" height="${rowH - 4}" rx="2" fill="${esc(t.color)}" fill-opacity="${score ? 0.95 : 0.55}"/>
      <text x="${(x2 + 4).toFixed(1)}" y="${y0 + rowH * 0.7}" font-size="9" fill="${score ? 'var(--accent)' : 'var(--muted)'}" font-weight="${score ? 700 : 400}">${esc(label)}</text>
    </g>`;
  }).join('');
  const ticks = [0, 25, 50, 75, 100].map((yd) => `<line x1="${fx(yd)}" x2="${fx(yd)}" y1="12" y2="${H - 6}" stroke="var(--line)" stroke-dasharray="${yd === 50 ? '0' : '2 3'}"/><text x="${fx(yd)}" y="9" text-anchor="middle" font-size="8" fill="var(--muted)">${yd === 0 ? 'own goal' : yd === 100 ? 'goal' : yd === 50 ? '50' : ''}</text>`).join('');
  return `<svg class="chart drives" viewBox="0 0 ${W} ${H}" role="img" aria-label="Drive chart, ${list.length} drives">${ticks}${rows}</svg>`;
}

/**
 * The story of a game from its log and stats: the result, the biggest
 * swings in win probability, the stars, and who got hurt.
 */
/**
 * Who is having the game, for one club: the leading passer, rusher, receiver
 * and defender, with the line each of them has put up.
 *
 * Ranked on yards for the three offensive slots, because that is what a leader
 * board means, and on a weighted count for the defender — sacks, interceptions
 * and forced fumbles are the things a defensive player does that a spectator
 * remembers, and tackles are not, since the leading tackler is usually just
 * whoever plays the most snaps against the run.
 *
 * Nobody with a zero appears: early in a game most of these are empty, and a
 * list of players who have done nothing is worse than a short list.
 */
const DEF_WEIGHT = { sck: 2, int: 3, ff: 2 };

export function statLeaders(players, byId) {
  if (!players) return [];
  const rows = Object.entries(players).map(([id, s]) => ({ p: byId?.get(id), s })).filter((r) => r.p);
  const pick = (kind, rank, fmt) => {
    const best = rows.filter((r) => rank(r.s) > 0).sort((x, y) => rank(y.s) - rank(x.s))[0];
    return best ? { kind, name: best.p.name, id: best.p.id, line: fmt(best.s) } : null;
  };
  return [
    pick('pass', (s) => s.pass.yds, (s) => `${s.pass.cmp}/${s.pass.att}, ${s.pass.yds} yds, ${s.pass.td} TD${s.pass.int ? `, ${s.pass.int} INT` : ''}`),
    pick('rush', (s) => s.rush.yds, (s) => `${s.rush.att} car, ${s.rush.yds} yds${s.rush.td ? `, ${s.rush.td} TD` : ''}`),
    pick('rec', (s) => s.rec.yds, (s) => `${s.rec.rec} rec, ${s.rec.yds} yds${s.rec.td ? `, ${s.rec.td} TD` : ''}`),
    pick('def', (s) => s.def.sck * DEF_WEIGHT.sck + s.def.int * DEF_WEIGHT.int + s.def.ff * DEF_WEIGHT.ff,
      (s) => [s.def.sck ? `${s.def.sck} sck` : '', s.def.int ? `${s.def.int} INT` : '', s.def.ff ? `${s.def.ff} FF` : ''].filter(Boolean).join(', ')),
  ].filter(Boolean);
}

/** "Legion of Boom beat Time Travelers 35-25." — or null before the final whistle. */
export function resultLine(box) {
  if (!box.final) return null;
  const [home, away] = box.teams;
  const [h, a] = box.score;
  if (h === a) return `${home.name} and ${away.name} tie ${h}-${a}${box.overtime ? ' after overtime' : ''}.`;
  const w = h > a ? home : away, l = h > a ? away : home;
  const ws = Math.max(h, a), ls = Math.min(h, a);
  const how = ws - ls >= 21 ? 'rout' : ws - ls >= 10 ? 'beat' : ws - ls >= 4 ? 'edge' : 'hold off';
  return `${w.name} ${how} ${l.name} ${ws}-${ls}${box.overtime ? ' in overtime' : ''}.`;
}

/**
 * The plays that turned a game, biggest first: up to three that moved win
 * probability by `TURNING_POINT` or more, or in a game that never turned the
 * single biggest, if it reached `FAINT_TURN`. `k` is the play's place in the
 * log and `delta` the swing, from the home side.
 */
export function turningPoints(log) {
  const swings = [];
  let prev = null;
  (log || []).forEach((e, k) => {
    if (typeof e.wp !== 'number') return;
    if (prev != null && e.situation) swings.push({ k, e, delta: e.wp - prev });
    prev = e.wp;
  });
  swings.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  // The same two numbers `thinLog` keeps its plays by, imported rather than
  // repeated: if these drifted apart the archive would quietly stop containing
  // the plays this wants to name.
  let top = swings.slice(0, 3).filter((s) => Math.abs(s.delta) >= TURNING_POINT);
  if (!top.length && swings.length && Math.abs(swings[0].delta) >= FAINT_TURN) top = swings.slice(0, 1);
  return top;
}

/** A play's text without the score the engine appends to a scoring play. */
export const playText = (e) => (e.text || '').replace(/\s*[A-Z]{2,4} \d+, [A-Z]{2,4} \d+\.$/, '');

/** Each side's leaders in one line: "LOB: Joe Burrow 23/32, 292 yds, 2 TD; …". */
export function starLines(box, byId) {
  if (!box.players) return [];
  const out = [];
  for (const side of [0, 1]) {
    const line = statLeaders(box.players[side], byId).map((l) => `${l.name} ${l.line}`);
    if (line.length) out.push(`${box.teams[side].abbr}: ${line.join('; ')}`);
  }
  return out;
}

/** Who got hurt, in one line, or null. */
export function injuryLine(box, byId) {
  const hurt = (box.injuries || []).flatMap((list, side) => list.map((x) => ({ side, x })));
  if (!hurt.length) return null;
  return `Injuries: ${hurt.map(({ side, x }) => `${byId.get(x.id)?.name || x.name || x.id} (${box.teams[side].abbr}, ${x.kind}${x.weeks ? `, out ${x.weeks >= 50 ? 'for the season' : `${x.weeks} wk`}` : ''})`).join(', ')}.`;
}

export function gameStory(box, byId) {
  const [home, away] = box.teams;
  const out = [];
  const result = resultLine(box);
  if (result) out.push(result);
  const top = turningPoints(box.log);
  if (top.length) {
    out.push(`${top.length > 1 ? 'Turning points' : 'Turning point'}: ${top.map((s) => {
      const gain = s.delta > 0 ? home : away;
      return `${fmtQuarter(s.e.q)} ${fmtClock(s.e.clock)} — ${playText(s.e)} (${gain.abbr} +${Math.round(Math.abs(s.delta) * 100)}%)`;
    }).join(' · ')}`);
  }
  const stars = starLines(box, byId);
  if (stars.length) out.push(`Stars — ${stars.join(' · ')}.`);
  const hurt = injuryLine(box, byId);
  if (hurt) out.push(hurt);
  return out;
}

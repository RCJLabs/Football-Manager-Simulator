// Stat containers, box-score aggregation, fantasy scoring.

export function emptyPlayerStats() {
  return {
    pass: { att: 0, cmp: 0, yds: 0, td: 0, int: 0, sck: 0, sckYds: 0, lng: 0 },
    rush: { att: 0, yds: 0, td: 0, fum: 0, lng: 0 },
    rec: { tgt: 0, rec: 0, yds: 0, td: 0, lng: 0 },
    def: { tkl: 0, sck: 0, int: 0, ff: 0, fr: 0, pd: 0, td: 0 },
    k: { fga: 0, fgm: 0, xpa: 0, xpm: 0, lng: 0 },
    p: { n: 0, yds: 0, in20: 0, lng: 0 },
    ret: { kr: 0, krYds: 0, pr: 0, prYds: 0, td: 0 },
    games: 0,
  };
}

export function emptyTeamStats() {
  return {
    plays: 0, passAtt: 0, passCmp: 0, passYds: 0, rushAtt: 0, rushYds: 0, totalYds: 0,
    firstDowns: 0, thirdAtt: 0, thirdConv: 0, fourthAtt: 0, fourthConv: 0,
    turnovers: 0, sacksAllowed: 0, top: 0, drives: 0, redZoneAtt: 0, redZoneTd: 0,
    penalties: 0, penYds: 0, points: 0,
  };
}

export function statFor(stats, playerId) {
  return (stats.players[playerId] ??= emptyPlayerStats());
}

/** Add `src` stat lines into `dst` (both player-stat shaped). */
export function addPlayerStats(dst, src) {
  for (const group of Object.keys(src)) {
    if (group === 'games') { dst.games += src.games; continue; }
    const d = dst[group], s = src[group];
    for (const k of Object.keys(s)) {
      if (k === 'lng') d.lng = Math.max(d.lng, s.lng);
      else d[k] += s[k];
    }
  }
}

export function addTeamStats(dst, src) {
  for (const k of Object.keys(src)) dst[k] = (dst[k] || 0) + src[k];
}

/** PPR fantasy points from a player stat line. */
export function fantasyPoints(s) {
  let pts = 0;
  pts += s.pass.yds * 0.04 + s.pass.td * 4 - s.pass.int * 2;
  pts += s.rush.yds * 0.1 + s.rush.td * 6 - s.rush.fum * 2;
  pts += s.rec.rec * 1 + s.rec.yds * 0.1 + s.rec.td * 6;
  pts += s.def.tkl * 1 + s.def.sck * 2 + s.def.int * 3 + s.def.ff * 2 + s.def.fr * 2 + s.def.pd * 0.5 + s.def.td * 6;
  pts += s.k.fgm * 3 + s.k.xpm * 1 - (s.k.fga - s.k.fgm) * 1;
  pts += s.ret.td * 6;
  return Math.round(pts * 10) / 10;
}

export function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function fmtQuarter(q) {
  if (q <= 4) return ['1st', '2nd', '3rd', '4th'][q - 1];
  return q === 5 ? 'OT' : `OT${q - 4}`;
}

export function shortName(p) {
  if (p.replacement) return p.name;
  const parts = p.name.split(' ');
  if (parts.length === 1) return p.name;
  const suffix = /^(Jr\.?|Sr\.?|II|III|IV)$/.test(parts[parts.length - 1]) ? ` ${parts.pop()}` : '';
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}${suffix}`;
}

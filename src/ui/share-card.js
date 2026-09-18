// A roster card drawn to a canvas: club, record, the starters with overalls.
// Shared through the Web Share API where it exists, downloaded otherwise.
import { ROSTER_SLOTS } from '../data/positions.js';
import { overall } from '../engine/ratings.js';

function roundRect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

export function drawRosterCard(league, team, byId, { title } = {}) {
  const W = 720, rowH = 30;
  const starters = ROSTER_SLOTS.filter((s) => s.starter).map((s) => ({ slot: s, p: byId.get(team.slots[s.id]) })).filter((x) => x.p);
  const H = 150 + starters.length * rowH + 60;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const c = canvas.getContext('2d');
  c.fillStyle = '#0f1a12'; c.fillRect(0, 0, W, H);
  c.fillStyle = team.color || '#e63946'; c.fillRect(0, 0, W, 10);
  c.fillStyle = '#e8efe9'; c.font = 'bold 34px system-ui, sans-serif'; c.textBaseline = 'top';
  c.fillText(team.name, 28, 34);
  c.fillStyle = '#9db3a3'; c.font = '18px system-ui, sans-serif';
  const r = team.record;
  c.fillText(`${title || league.name} · Season ${league.season} · ${r.w}-${r.l}${r.t ? `-${r.t}` : ''} · PF ${r.pf} PA ${r.pa}`, 28, 78);
  c.fillText('Starters', 28, 116);
  let y = 146;
  for (const { slot, p } of starters) {
    const o = overall(p);
    c.fillStyle = o >= 90 ? '#57cc99' : o >= 85 ? '#7fb3d5' : '#9db3a3';
    roundRect(c, 28, y, 44, rowH - 6, 6); c.fill();
    c.fillStyle = '#0f1a12'; c.font = 'bold 16px system-ui, sans-serif'; c.fillText(String(o), 38, y + 4);
    c.fillStyle = '#9db3a3'; c.font = '14px ui-monospace, monospace'; c.fillText(slot.id, 84, y + 6);
    c.fillStyle = '#e8efe9'; c.font = '18px system-ui, sans-serif'; c.fillText(p.name, 140, y + 3);
    c.fillStyle = '#9db3a3'; c.font = '15px system-ui, sans-serif'; c.fillText(`${p.season} ${p.team}`, 480, y + 5);
    y += rowH;
  }
  c.fillStyle = '#9db3a3'; c.font = '14px system-ui, sans-serif';
  c.fillText('Gridiron Eras · all-time fantasy football', 28, H - 34);
  return canvas;
}

export async function shareCanvas(canvas, filename) {
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('Could not render the card');
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: filename });
    return 'shared';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}

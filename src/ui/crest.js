// Club crests: a shape, the club's colour, a second colour and a monogram,
// drawn wherever a club is named (`teamChip`). Every club used to be a single
// coloured dot, and a club stored one colour.
//
// Nothing here is stored for the computer clubs: the crest is worked out from
// the name and colour every time, so every save and every league code already
// has one. The human's club can choose its own shape and second colour
// (`team.crest`), which the league code carries.
//
// Legibility at chip size (about 16 pixels) decides the design. Four plain
// silhouettes that read as different at that size, a single letter, and the
// letter at 4.5:1 or better against the field it sits on, the contrast WCAG
// asks of text. A thin rim keeps a crest visible against the page: light on
// the dark theme, so a dark crest shows, and dark on the light one, so a light
// crest does (styles.css, --crest-rim). The share cards are always dark and
// draw the light rim.

import { esc, contrast, rgbOf } from '../util.js';
import { hashSeed } from '../engine/rng.js';

export const CREST_SHAPES = ['shield', 'round', 'diamond', 'badge'];
export const CREST_NAMES = { shield: 'Shield', round: 'Roundel', diamond: 'Diamond', badge: 'Badge' };

const PATHS = {
  shield: 'M2.5 2.5H17.5V11.5C17.5 16.8 14.1 20 10 22C5.9 20 2.5 16.8 2.5 11.5Z',
  round: 'M10 3A8.8 8.8 0 1 1 9.99 3Z',
  diamond: 'M10 1.8L18.6 12L10 22.2L1.4 12Z',
  badge: 'M6 3H14A4 4 0 0 1 18 7V17A4 4 0 0 1 14 21H6A4 4 0 0 1 2 17V7A4 4 0 0 1 6 3Z',
};

/** White or black, whichever stands further from `hex`. */
const inkOn = (hex) => (contrast(hex, '#ffffff') >= contrast(hex, '#000000') ? '#ffffff' : '#000000');

/** A colour `share` of the way from `hex` to white. */
function tint(hex, share) {
  const [r, g, b] = rgbOf(hex);
  const mixc = (c) => Math.round(c + (255 - c) * share).toString(16).padStart(2, '0');
  return `#${mixc(r)}${mixc(g)}${mixc(b)}`;
}

/**
 * A club's crest: its shape, colours and letter. The second colour is the
 * club's own choice if it made one, otherwise the first of white, gold,
 * silver, a pale tint of its colour and near-black, in an order the club's
 * name decides, that stands 4.5:1 against its colour, because the letter is
 * drawn in it. A mid-tone colour can miss with all five; then it is white or
 * black, and one of those two always clears 4.5:1 (about 4.58 at worst).
 */
export function crestOf(team) {
  const primary = rgbOf(team?.color) ? team.color : '#7a8a80';
  const h = hashSeed(`crest:${team?.name || team?.abbr || ''}`);
  const own = team?.crest || {};
  const shape = CREST_SHAPES.includes(own.shape) ? own.shape : CREST_SHAPES[h % CREST_SHAPES.length];
  let secondary = rgbOf(own.color2) ? own.color2 : null;
  if (!secondary) {
    const pool = ['#ffffff', '#f2c14e', '#c9d1d9', tint(primary, 0.72), '#111111'];
    const start = (h >>> 3) % pool.length;
    const order = pool.map((_, i) => pool[(start + i) % pool.length]);
    secondary = order.find((c) => contrast(primary, c) >= 4.5) || inkOn(primary);
  }
  // A second colour the human chose too close to the first still gets a
  // readable letter.
  const ink = contrast(primary, secondary) >= 4.5 ? secondary : inkOn(primary);
  const letter = ((team?.abbr || team?.name || '?').trim()[0] || '?').toUpperCase();
  return { shape, primary, secondary, ink, letter };
}

/** The crest as inline SVG, sized by CSS; `label` names it for screen readers where no text beside it does. */
export function crestSvg(team, { label = null, cls = '' } = {}) {
  const c = crestOf(team);
  const a11y = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
  return `<svg class="crest${cls ? ` ${cls}` : ''}" viewBox="0 0 20 24" ${a11y} focusable="false">`
    + `<path class="rim" d="${PATHS[c.shape]}" fill="${esc(c.primary)}" stroke="rgba(255,255,255,.55)" stroke-width="1"/>`
    + `<path d="${PATHS[c.shape]}" fill="none" stroke="${esc(c.secondary)}" stroke-width="1.6" transform="translate(10 12) scale(.8) translate(-10 -12)"/>`
    + `<text x="10" y="12.6" text-anchor="middle" dominant-baseline="middle" font-size="10.5" font-weight="800" font-family="system-ui,sans-serif" fill="${esc(c.ink)}">${esc(c.letter)}</text>`
    + '</svg>';
}

/** The crest picker: a preview, the four shapes, and a second colour. */
export function crestEditor(team) {
  const c = crestOf(team);
  const shapes = CREST_SHAPES.map((s) => `<label class="crest-shape"><input type="radio" name="crestShape" value="${s}"${s === c.shape ? ' checked' : ''}><span>${crestSvg({ ...team, crest: { ...(team.crest || {}), shape: s } })}${CREST_NAMES[s]}</span></label>`).join('');
  return `<div class="crest-edit">
    <span class="crest-preview">${crestSvg(team, { cls: 'lg', label: `Crest preview: ${CREST_NAMES[c.shape]}` })}</span>
    <div class="crest-fields">
      <div class="crest-shapes" role="radiogroup" aria-label="Crest shape">${shapes}</div>
      <label class="crest-color">Second colour <input type="color" name="color2" value="${esc(c.secondary)}"></label>
    </div>
  </div>`;
}

/**
 * Keeps an editor live. `teamNow()` is the club as the form has it, and
 * `onChange(crest)` hears each change. A shape or second colour counts as
 * chosen only once it has been touched: until then it follows what the name
 * and colour give, so a club that picks only a shape keeps the colour worked
 * out for it, and the crest tracks a name still being typed.
 */
export function wireCrestEditor(el, teamNow, onChange = () => {}) {
  const own = teamNow().crest || {};
  const touched = { shape: !!own.shape, color2: !!own.color2 };
  const read = () => {
    const crest = {};
    if (touched.shape) crest.shape = el.querySelector('input[name="crestShape"]:checked')?.value;
    if (touched.color2) crest.color2 = el.querySelector('input[name="color2"]').value;
    return crest;
  };
  const refresh = () => {
    const crest = read();
    const team = { ...teamNow(), crest };
    const c = crestOf(team);
    if (!touched.shape) el.querySelectorAll('input[name="crestShape"]').forEach((i) => { i.checked = i.value === c.shape; });
    if (!touched.color2) el.querySelector('input[name="color2"]').value = c.secondary;
    el.querySelector('.crest-preview').innerHTML = crestSvg(team, { cls: 'lg', label: `Crest preview: ${CREST_NAMES[c.shape]}` });
    el.querySelectorAll('.crest-shape').forEach((lab) => {
      const s = lab.querySelector('input').value;
      lab.querySelector('svg').outerHTML = crestSvg({ ...team, crest: { ...crest, shape: s } });
    });
    return crest;
  };
  const changed = (e) => {
    if (e.target.name === 'crestShape') touched.shape = true;
    else if (e.target.name === 'color2') touched.color2 = true;
    else return;
    onChange(refresh());
  };
  el.addEventListener('change', changed);
  el.addEventListener('input', changed);
  return { refresh, read };
}

/** The crest on a canvas, `h` pixels tall with its top-left at (x, y): for the share cards. */
export function drawCrest(g, team, x, y, h) {
  const k = crestOf(team);
  const path = new Path2D(PATHS[k.shape]);
  g.save();
  g.translate(x, y);
  g.scale(h / 24, h / 24);
  g.fillStyle = k.primary; g.fill(path);
  g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,.55)'; g.stroke(path);
  g.save();
  g.translate(10, 12); g.scale(0.8, 0.8); g.translate(-10, -12);
  g.lineWidth = 1.6; g.strokeStyle = k.secondary; g.stroke(path);
  g.restore();
  g.fillStyle = k.ink; g.font = '800 10.5px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(k.letter, 10, 12.6);
  g.restore();
}

/** A club's two colours as a band: most of it the first, a stripe of the second. */
export function kitBand(g, team, w, h = 10) {
  const k = crestOf(team);
  g.fillStyle = k.primary; g.fillRect(0, 0, w, Math.round(h * 0.7));
  g.fillStyle = k.secondary; g.fillRect(0, Math.round(h * 0.7), w, h - Math.round(h * 0.7));
}

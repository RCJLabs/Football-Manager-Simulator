/** Escape text for safe insertion into HTML templates. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Tagged template that escapes interpolations unless wrapped with raw(). */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) {
      const v = vals[i];
      // Test for the marker, not its truthiness: raw('') is a legitimate value
      // and must render as nothing rather than as a stringified object.
      if (isRaw(v)) out += v.__raw;
      else if (Array.isArray(v)) out += v.map((x) => (isRaw(x) ? x.__raw : esc(x))).join('');
      else if (v === false || v == null) out += '';
      else out += esc(v);
    }
  });
  return { __raw: out };
}

export const raw = (s) => ({ __raw: String(s) });

/** True for a value produced by raw() or html(), including an empty one. */
export const isRaw = (v) => !!v && typeof v === 'object' && typeof v.__raw === 'string';

export function render(root, tpl) {
  root.innerHTML = isRaw(tpl) ? tpl.__raw : String(tpl ?? '');
}

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function pct(n, d, digits = 0) {
  return d ? `${((n / d) * 100).toFixed(digits)}%` : '—';
}

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Relative luminance of an sRGB colour, per WCAG. */
function relLum([r, g, b]) {
  const ch = [r, g, b].map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/**
 * Contrasting text colour for a background hex: whichever of near-black or
 * white actually contrasts better, measured rather than guessed.
 *
 * This used to weight the RAW channel values — `0.2126 * r + ...` on 0..255 —
 * and switch at 150. That is the usual shortcut and it is wrong near the
 * boundary, because sRGB is gamma-encoded: the channels have to be linearised
 * before they mean anything. Measured across the club colours, it chose white
 * on `#e63946` for 4.17:1 where black gives 4.53, and white on `#2a9d8f` for
 * 3.32:1 where black gives 5.68 — below AA on a label that names a team.
 *
 * Every club colour in the game clears 4.5:1 with the right ink; the shortcut
 * was the only thing standing between them and that. Checked in util.test.js
 * against `TEAMS` and `PRO_TEAMS` rather than a sample, so a colour added later
 * cannot quietly fail.
 */
export function textOn(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#fff';
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const n = parseInt(h, 16);
  const L = relLum([(n >> 16) & 255, (n >> 8) & 255, n & 255]);
  const INK = relLum([17, 17, 17]);          // #111
  const onWhite = 1.05 / (L + 0.05);
  const onInk = (L + 0.05) / (INK + 0.05);
  return onInk >= onWhite ? '#111' : '#fff';
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

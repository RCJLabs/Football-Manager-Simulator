// How a save is written down: deflated, then packed fifteen bits to a
// character, because localStorage holds strings and counts characters.
//
// The origin's room is the constraint. Chromium gives localStorage 5.24
// million characters, shared by every slot, and a pro league as JSON peaks at
// 2.64 million — a season played, the offseason not yet thinning its logs — so
// two pro leagues overflowed it by their second or third season and the third
// slot was a promise the browser could not keep. Deflated, the same save is
// 392,000 bytes, and at fifteen bits a character 209,000 characters: a
// twelfth. A packed character costs the origin what an ASCII one does
// (measured: it holds 5,242,546 of either).
//
// Fifteen bits and not sixteen, offset past the control characters, so every
// character is a code unit below 0x8020 — never half of a surrogate pair,
// which a browser is free to mangle. Base64 would have been simpler and a
// third larger again.
//
// A save written before this is plain JSON and still reads: `decode` hands
// back anything not marked as packed untouched, and the next save packs it.
import { deflateSync, inflateSync } from './vendor/fflate.js';

/** Marks a packed save. JSON never starts with a control character. */
export const PACKED = '\u0001GE1:';

export function isPacked(raw) {
  return typeof raw === 'string' && raw.startsWith(PACKED);
}

/**
 * JSON to a packed string. `level` is deflate's: 6 is a third smaller than 1
 * and about twice the work, so the background worker uses 6 and a save that
 * has to land before the page goes away uses 1.
 */
export function encode(json, level = 6) {
  const bytes = deflateSync(new TextEncoder().encode(json), { level });
  return `${PACKED}${bytes.length.toString(36)}:${pack(bytes)}`;
}

/** A packed string, or a plain one from before packing, back to JSON. */
export function decode(raw) {
  if (!isPacked(raw)) return raw;
  const at = raw.indexOf(':', PACKED.length);
  const n = parseInt(raw.slice(PACKED.length, at), 36);
  return new TextDecoder().decode(inflateSync(unpack(raw, at + 1, n)));
}

const OFFSET = 0x20;
const CHUNK = 0x4000;

function pack(u8) {
  const out = new Uint16Array(Math.ceil((u8.length * 8) / 15));
  let acc = 0, bits = 0, k = 0;
  for (let i = 0; i < u8.length; i++) {
    acc = (acc << 8) | u8[i];
    bits += 8;
    if (bits >= 15) {
      bits -= 15;
      out[k++] = ((acc >>> bits) & 0x7fff) + OFFSET;
      acc &= (1 << bits) - 1;
    }
  }
  if (bits > 0) out[k++] = ((acc << (15 - bits)) & 0x7fff) + OFFSET;
  let s = '';
  for (let i = 0; i < k; i += CHUNK) s += String.fromCharCode.apply(null, out.subarray(i, Math.min(k, i + CHUNK)));
  return s;
}

function unpack(s, from, n) {
  const u8 = new Uint8Array(n);
  let acc = 0, bits = 0, j = 0;
  for (let i = from; i < s.length && j < n; i++) {
    acc = (acc << 15) | (s.charCodeAt(i) - OFFSET);
    bits += 15;
    while (bits >= 8 && j < n) {
      bits -= 8;
      u8[j++] = (acc >>> bits) & 0xff;
    }
    acc &= (1 << bits) - 1;
  }
  return u8;
}

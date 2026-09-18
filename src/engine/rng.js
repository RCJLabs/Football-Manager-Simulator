// Small seeded PRNG (mulberry32). State is a single 32-bit int so a game can be
// paused, serialized, and resumed while staying deterministic.

export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export class RNG {
  constructor(seed) {
    this.state = (typeof seed === 'string' ? hashSeed(seed) : (seed >>> 0)) || 0x9e3779b9;
  }

  /** Uniform float in [0, 1). */
  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [a, b] inclusive. */
  int(a, b) {
    return a + Math.floor(this.next() * (b - a + 1));
  }

  chance(p) {
    return this.next() < p;
  }

  /** Approximately normal via Box-Muller. */
  normal(mean = 0, sd = 1) {
    let u = 0, v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Exponential with the given mean. */
  exp(mean) {
    return -Math.log(1 - this.next()) * mean;
  }

  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Pick an item proportionally to weights[i]. */
  weighted(items, weights) {
    let total = 0;
    for (const w of weights) total += Math.max(0, w);
    if (total <= 0) return this.pick(items);
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= Math.max(0, weights[i]);
      if (r < 0) return items[i];
    }
    return items[items.length - 1];
  }

  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** Derive a child RNG from this one plus a label (for independent streams). */
  fork(label) {
    return new RNG((hashSeed(String(label)) ^ Math.floor(this.next() * 4294967296)) >>> 0);
  }
}

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** Logistic on a difference: 0.5 at parity, ~0.73 when a beats b by k. */
export const edge = (a, b, k = 10) => 1 / (1 + Math.exp(-(a - b) / k));

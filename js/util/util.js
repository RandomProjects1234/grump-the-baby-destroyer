// Deterministic randomness + small math helpers.
// The school layout is regenerated from the seed on every machine, so anything
// that shapes the building must be reproducible bit-for-bit.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = t => t * t * (3 - 2 * t);
export const TAU = Math.PI * 2;

// Shortest signed difference between two angles.
export function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function approachAngle(a, b, step) {
  const d = angDiff(a, b);
  if (Math.abs(d) <= step) return b;
  return a + Math.sign(d) * step;
}

export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

// Small mutable PRNG. Seeded generators walk this in a fixed order so every
// client ends up with the same school.
export function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Convenience wrapper: rng.int(a,b) inclusive, rng.pick(arr), rng.chance(p)
export function makeRng(seed) {
  const r = mulberry(seed);
  r.int = (a, b) => a + Math.floor(r() * (b - a + 1));
  r.range = (a, b) => a + r() * (b - a);
  r.pick = arr => arr[Math.floor(r() * arr.length) % arr.length];
  r.chance = p => r() < p;
  r.shuffle = arr => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  return r;
}

export function fmtTime(sec) {
  const m = Math.floor(Math.max(0, sec) / 60), s = Math.floor(Math.max(0, sec) % 60);
  return m + ':' + String(s).padStart(2, '0');
}

// Distance on the horizontal plane -- the whole school is one flat storey, so
// vertical distance never matters for gameplay checks.
export function dist2(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}
export function distSq2(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return dx * dx + dz * dz;
}

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

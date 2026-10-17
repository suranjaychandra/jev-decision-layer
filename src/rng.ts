/**
 * A small seeded random number generator (mulberry32), shared by both scenes.
 * Why not Math.random(): the same seed must always produce the same customers and ads, so a
 * benchmark can be rerun and checked by anyone.
 */
export function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Small helpers on top of a generator, so data generators read like a description of the data.
 * Why one place: both scenes draw numbers the same way, and a fix here applies to both.
 */
export function randomTools(rnd: () => number) {
  return {
    /** A whole number from lo to hi, inclusive. */
    int: (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1)),
    /** A number from lo up to (not including) hi. */
    between: (lo: number, hi: number) => lo + rnd() * (hi - lo),
    /** True with probability p. */
    chance: (p: number) => rnd() < p,
    /** One element of a list. */
    one: <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!,
  };
}

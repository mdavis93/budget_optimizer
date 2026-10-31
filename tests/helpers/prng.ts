export type Prng = () => number;

/** mulberry32. Same seed, same sequence. No external dependency. */
export function mulberry32(seed: number): Prng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in `[minInclusive, maxExclusive)`. */
export function randomInt(prng: Prng, minInclusive: number, maxExclusive: number): number {
  const span = maxExclusive - minInclusive;
  return minInclusive + Math.floor(prng() * span);
}

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*-_=+';
const ALL_CHARS = UPPER + LOWER + DIGITS + SYMBOLS;
const UINT32_RANGE = 0x100000000;

function unbiasedIndex(maxExclusive: number): number {
  const cutoff = Math.floor(UINT32_RANGE / maxExclusive) * maxExclusive;
  let x = crypto.getRandomValues(new Uint32Array(1))[0];
  while (x >= cutoff) {
    x = crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return x % maxExclusive;
}

function pickRandomChar(pool: string): string {
  return pool[unbiasedIndex(pool.length)];
}

function shuffle(chars: string[]): string[] {
  const result = [...chars];
  for (let i = result.length - 1; i > 0; i--) {
    const j = unbiasedIndex(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function generateSecurePassword(length = 20): string {
  const minLength = 12;
  const targetLength = Math.max(length, minLength);

  const required = [
    pickRandomChar(UPPER),
    pickRandomChar(LOWER),
    pickRandomChar(DIGITS),
    pickRandomChar(SYMBOLS),
  ];

  const remaining = targetLength - required.length;
  const chars = [...required];
  for (let i = 0; i < remaining; i++) {
    chars.push(pickRandomChar(ALL_CHARS));
  }

  return shuffle(chars).join('');
}

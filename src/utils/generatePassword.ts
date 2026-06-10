const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*-_=+';
const ALL_CHARS = UPPER + LOWER + DIGITS + SYMBOLS;

function pickRandomChar(pool: string): string {
  const index = crypto.getRandomValues(new Uint32Array(1))[0] % pool.length;
  return pool[index];
}

function shuffle(chars: string[]): string[] {
  const result = [...chars];
  for (let i = result.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function generateSecurePassword(length = 20): string {
  const minLength = 8;
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

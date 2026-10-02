export const MAX_FORTUNE_AMOUNT = 1000000000;

export function normalizeFortuneCode(value) {
  const code = String(value ?? '').trim().toUpperCase();
  return /^FORT-[A-Z0-9]{1,15}$/.test(code) ? code : null;
}

export function normalizeFortuneAmount(value) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 && amount <= MAX_FORTUNE_AMOUNT
    ? amount
    : null;
}
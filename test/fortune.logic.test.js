import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_FORTUNE_AMOUNT, normalizeFortuneAmount, normalizeFortuneCode } from '../fortuneLogic.js';

test('fortune codes are trimmed and normalized to uppercase', () => {
  assert.equal(normalizeFortuneCode(' fort-ab12 '), 'FORT-AB12');
});

test('fortune code validation rejects malformed and overlong codes', () => {
  for (const code of ['', 'FORT-', 'OTHER-AB12', 'FORT-AB_12', `FORT-${'A'.repeat(16)}`]) {
    assert.equal(normalizeFortuneCode(code), null, `expected ${code} to be rejected`);
  }
});

test('fortune amounts accept positive whole UGX values within the configured cap', () => {
  assert.equal(normalizeFortuneAmount('100'), 100);
  assert.equal(normalizeFortuneAmount(MAX_FORTUNE_AMOUNT), MAX_FORTUNE_AMOUNT);
});

test('fortune amounts reject zero, negative, fractional, nonnumeric, and excessive values', () => {
  for (const amount of [0, -1, 1.5, 'not-money', MAX_FORTUNE_AMOUNT + 1]) {
    assert.equal(normalizeFortuneAmount(amount), null, `expected ${amount} to be rejected`);
  }
});
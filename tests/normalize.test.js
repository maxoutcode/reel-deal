import assert from 'node:assert/strict';
import test from 'node:test';

const api = await import('../dist/index.es.js').catch(() => null);

test('build artifacts present', { skip: api === null }, () => {
  assert.ok(api);
});

if (api) {
  const {
    normalizeSpinConfig,
    normalizeSpinBlur,
    normalizeIdleBob,
    normalizeMaxDpr,
  } = api;

  test('normalizeSpinConfig clamps and fills defaults', () => {
    const normalized = normalizeSpinConfig({ minSpins: -5, durationMs: -10, speedPxS: 0 });
    assert.equal(normalized.minSpins, 2);
    assert.equal(normalized.durationMs, 1200);
    assert.equal(normalized.speedPxS, 0);
  });

  test('normalizeSpinBlur clamps negatives to defaults', () => {
    const blur = normalizeSpinBlur({ maxPx: -1, speedAtMax: -100 });
    assert.equal(blur.maxPx, 4);
    assert.equal(blur.speedAtMax, 2200);
  });

  test('normalizeIdleBob handles false and overrides', () => {
    assert.equal(normalizeIdleBob(false), null);
    const idle = normalizeIdleBob({ amplitudePx: -5, speedHz: 2 });
    assert.ok(idle);
    assert.equal(idle.amplitudePx, 9);
    assert.equal(idle.speedHz, 2);
  });

  test('normalizeMaxDpr clamps minimum to 1', () => {
    assert.equal(normalizeMaxDpr(0.5), 1);
    assert.equal(normalizeMaxDpr(3), 3);
  });
}

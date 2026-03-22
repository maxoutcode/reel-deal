import assert from 'node:assert/strict';
import test from 'node:test';

const api = await import('../dist/index.es.js').catch(() => null);

test('build artifacts present', () => {
  assert.ok(api);
});

if (api) {
  test('public API exports ReelDeal class', () => {
    assert.equal(typeof api.ReelDeal, 'function');
  });

  test('ReelDeal exposes queue and spin controls', () => {
    assert.equal(typeof api.ReelDeal.prototype.spin, 'function');
    assert.equal(typeof api.ReelDeal.prototype.enqueueSpin, 'function');
    assert.equal(typeof api.ReelDeal.prototype.clearQueuedSpins, 'function');
    assert.equal(typeof api.ReelDeal.prototype.hasPendingSpins, 'function');
  });
}

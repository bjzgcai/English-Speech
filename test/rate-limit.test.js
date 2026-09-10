const test = require('node:test');
const assert = require('node:assert/strict');
const { clientIp, createFailureLimiter, isLoopback } = require('../src/rate-limit');

function clock() {
  let value = 1_000_000;
  return { now: () => value, advance: ms => { value += ms; } };
}

function limiter(overrides = {}) {
  const time = clock();
  return { time, instance: createFailureLimiter({ limit: 3, windowMs: 1000, blockBaseMs: 5000, blockGrowth: 3, blockMaxMs: 60000, now: time.now, ...overrides }) };
}

test('failures below the budget are free and the last one starts a cooldown', () => {
  const { instance } = limiter();
  assert.deepEqual(instance.fail('ip'), { blocked: false, retryAfterSeconds: 0 });
  assert.deepEqual(instance.check('ip'), { blocked: false, retryAfterSeconds: 0 });
  assert.deepEqual(instance.fail('ip'), { blocked: false, retryAfterSeconds: 0 });
  assert.deepEqual(instance.fail('ip'), { blocked: true, retryAfterSeconds: 5 });
  assert.deepEqual(instance.check('ip'), { blocked: true, retryAfterSeconds: 5 });

  // An unknown key is never blocked, and checking does not create state.
  assert.deepEqual(instance.check('other'), { blocked: false, retryAfterSeconds: 0 });
  assert.equal(instance.size(), 1);
});

test('the cooldown expires and each repeat offence grows it up to the cap', () => {
  const { instance, time } = limiter({ limit: 2, blockBaseMs: 1000, blockGrowth: 3, blockMaxMs: 9000 });
  const trip = () => { instance.fail('k'); return instance.fail('k'); };

  assert.equal(trip().retryAfterSeconds, 1);
  time.advance(1000);
  assert.deepEqual(instance.check('k'), { blocked: false, retryAfterSeconds: 0 });
  assert.equal(trip().retryAfterSeconds, 3);
  time.advance(3000);
  assert.equal(trip().retryAfterSeconds, 9);
  time.advance(9000);
  // Growth is capped, so a persistent attacker converges on the ceiling.
  assert.equal(trip().retryAfterSeconds, 9);
  assert.equal(trip().retryAfterSeconds, 9);
});

test('failures age out of the window instead of accumulating forever', () => {
  const { instance, time } = limiter({ limit: 3, windowMs: 1000 });
  instance.fail('k');
  instance.fail('k');
  time.advance(1001);
  instance.fail('k');
  time.advance(1001);
  // Only the two oldest aged out; the third is still counted, so the next two
  // failures stay free.
  assert.deepEqual(instance.fail('k'), { blocked: false, retryAfterSeconds: 0 });
  assert.deepEqual(instance.fail('k'), { blocked: false, retryAfterSeconds: 0 });
  assert.deepEqual(instance.fail('k'), { blocked: true, retryAfterSeconds: 5 });
});

test('keys are independent and reset clears only its own key', () => {
  const { instance } = limiter({ limit: 2 });
  instance.fail('a');
  instance.fail('b');
  assert.deepEqual(instance.fail('a'), { blocked: true, retryAfterSeconds: 5 });
  assert.deepEqual(instance.check('b'), { blocked: false, retryAfterSeconds: 0 });
  instance.reset('a');
  assert.deepEqual(instance.check('a'), { blocked: false, retryAfterSeconds: 0 });
});

test('only a loopback peer may supply the client address', () => {
  const request = peer => ({ socket: { remoteAddress: peer }, get: name => (name === 'x-real-ip' ? '203.0.113.5' : name === 'x-forwarded-for' ? '198.51.100.7' : '') });
  // Behind the site proxy the peer is loopback, so the forwarded address wins.
  assert.equal(clientIp(request('127.0.0.1')), '203.0.113.5');
  assert.equal(clientIp(request('::ffff:127.0.0.1')), '203.0.113.5');
  assert.equal(clientIp(request('::1')), '203.0.113.5');
  // A direct caller cannot spoof its way around the throttle with headers.
  assert.equal(clientIp(request('10.1.130.9')), '10.1.130.9');
  assert.equal(clientIp(request('203.0.113.9')), '203.0.113.9');
  assert.equal(clientIp({ socket: {} }), 'unknown');
  assert.equal(isLoopback('::1'), true);
  assert.equal(isLoopback('::ffff:127.0.0.1'), true);
  assert.equal(isLoopback('127.0.0.1'), true);
  assert.equal(isLoopback('10.1.130.9'), false);
  assert.equal(isLoopback(''), false);
});

test('a forwarded header with no usable value falls back to the peer', () => {
  const request = peer => ({ socket: { remoteAddress: peer }, get: () => '   ' });
  assert.equal(clientIp(request('127.0.0.1')), '127.0.0.1');
});

test('idle keys are dropped once the map is over budget', () => {
  const { instance, time } = limiter({ limit: 2, maxKeys: 2, windowMs: 100, blockBaseMs: 1 });
  instance.fail('a');
  time.advance(1000);
  instance.fail('b');
  instance.fail('c');
  assert.equal(instance.size(), 2);
  assert.deepEqual(instance.check('a'), { blocked: false, retryAfterSeconds: 0 });
});

test('the key map stays bounded even while every key is actively blocked', () => {
  const { instance, time } = limiter({ limit: 1, maxKeys: 4, blockBaseMs: 1000 });
  for (let index = 0; index < 20; index += 1) {
    instance.fail(`key-${index}`);
    time.advance(1);
  }
  assert.equal(instance.size(), 4);
  // The most recent offender is the one still tracked and blocked.
  assert.equal(instance.check('key-19').blocked, true);
});

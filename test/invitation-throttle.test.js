// Redeeming is the only unauthenticated write path, so failed attempts are
// throttled: per client address (code enumeration) and per invitation record
// (guessing the name that unlocks a used code). The budgets are tightened here
// through the environment so the cooldowns are observable; the production
// defaults are wider (see src/app.js). Requests carry X-Real-IP because the
// suite connects over loopback, where the proxy headers are trusted.
const { listenForTest } = require('../scripts/test-http');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'invitation-throttle-test-'));
Object.assign(process.env, { NODE_ENV: 'test', DATA_DIR: data, QUEUE_ENABLED: 'false', DINGTALK_APP_KEY: 'test', DINGTALK_APP_SECRET: 'test', DINGTALK_CORP_ID: 'test', SESSION_SECRET: 'invitation-throttle-secret', COOKIE_SECURE: 'false', APP_BASE_URL: 'https://english.example.test/service/', INVITATION_REDEEM_IP_LIMIT: '6', INVITATION_REDEEM_NAME_LIMIT: '3' });
const { app, testHelpers } = require('../src/app');
const { invitationsMetadataFile } = require('../src/config');
const { readJsonLines } = require('../src/storage');
let server, base;
test.before(async () => { server = await listenForTest(app); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(data, { recursive: true, force: true }); });
function member(owner) { return { Cookie: `englisheval_session=${testHelpers.createSessionToken({ openId: owner, name: 'Member' })}`, 'X-Expected-Owner': owner }; }
async function issue(owner) { const response = await fetch(base + '/api/invitation-codes', { method: 'POST', headers: member(owner) }); assert.equal(response.status, 201); return response.json(); }
function redeem(code, name, ip, cookie = '') {
  return fetch(base + '/api/invitation/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-Real-IP': ip }, body: JSON.stringify({ code, name }) });
}
function cookieOf(response) { return response.headers.getSetCookie().map(value => value.split(';')[0]).join('; '); }
function claims(id) { return readJsonLines(invitationsMetadataFile).filter(row => row.id === id && row.usedAt); }

test('wrong names lock the code, and the right name cannot bypass the lock', async () => {
  const { code, record } = await issue('throttle-owner-1');
  const ip = '198.51.100.10';
  const first = await redeem(code, 'Alice', ip);
  assert.equal(first.status, 200);
  assert.equal(claims(record.id).length, 1);

  for (const name of ['Bob', 'Carol', 'Dave']) {
    const wrong = await redeem(code, name, ip);
    assert.equal(wrong.status, 409, name);
    assert.equal((await wrong.json()).code, 'INVITATION_NAME_MISMATCH');
    assert.equal(wrong.headers.get('set-cookie'), null);
  }

  const locked = await redeem(code, 'Alice', ip);
  assert.equal(locked.status, 429);
  const body = await locked.json();
  assert.equal(body.code, 'INVITATION_NAME_LOCKED');
  assert.equal(Number(locked.headers.get('retry-after')) >= 1, true);
  assert.equal(locked.headers.get('set-cookie'), null);
  // A rejected guess must never claim the code or leak a session.
  assert.equal(claims(record.id).length, 1);
});

test('the signed-in owner is never locked out of their own invitation', async () => {
  const { code, record } = await issue('throttle-owner-2');
  const ip = '198.51.100.11';
  const claimed = await redeem(code, 'Alice', ip);
  assert.equal(claimed.status, 200);
  const cookie = cookieOf(claimed);
  for (const name of ['Bob', 'Carol', 'Dave']) assert.equal((await redeem(code, name, ip)).status, 409);
  assert.equal((await redeem(code, 'Alice', ip)).status, 429);
  // The owner holds the signed guest session, so they come straight back...
  const returning = await redeem(code, 'irrelevant', ip, cookie);
  assert.equal(returning.status, 200);
  assert.equal((await returning.json()).user.name, 'Alice');
  // ...and their return clears the guesses against the code, so an honest
  // recovery from a second browser works again immediately.
  assert.equal((await redeem(code, 'alice', ip)).status, 200);
  assert.equal(claims(record.id).length, 1);
});

test('a successful recovery resets the wrong-name budget', async () => {
  const { code } = await issue('throttle-owner-3');
  const ip = '198.51.100.12';
  assert.equal((await redeem(code, 'Alice', ip)).status, 200);
  for (const name of ['Bob', 'Carol']) assert.equal((await redeem(code, name, ip)).status, 409);
  assert.equal((await redeem(code, 'ALICE', ip)).status, 200);
  for (const name of ['Bob', 'Carol']) assert.equal((await redeem(code, name, ip)).status, 409);
  assert.equal((await redeem(code, '  alice  ', ip)).status, 200);
});

test('failed attempts from one address are capped, and only that address', async () => {
  const ip = '198.51.100.13';
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const response = await redeem('NOT-A-CODE', 'Alice', ip);
    assert.equal(response.status, 400, `failed attempt ${attempt}`);
    assert.equal(response.headers.get('set-cookie'), null);
  }

  const blocked = await redeem('NOT-A-CODE', 'Alice', ip);
  assert.equal(blocked.status, 429);
  const body = await blocked.json();
  assert.equal(body.code, 'INVITATION_RATE_LIMITED');
  assert.equal(Number(blocked.headers.get('retry-after')) >= 1, true);
  assert.equal(blocked.headers.get('set-cookie'), null);

  // While the address is throttled even a well-formed redemption is refused,
  // so probing cannot be hidden behind valid-looking traffic.
  const { code } = await issue('throttle-owner-4');
  const valid = await redeem(code, 'Alice', ip);
  assert.equal(valid.status, 429);
  assert.equal((await valid.json()).code, 'INVITATION_RATE_LIMITED');

  // Another address is untouched by the first one's failures.
  const elsewhere = await redeem(code, 'Alice', '198.51.100.14');
  assert.equal(elsewhere.status, 200);
});

const { listenForTest } = require('../scripts/test-http');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const QRCode = require('qrcode');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'invitation-test-'));
// The redeem throttle budgets are widened here: these tests exercise claim
// semantics from a single address and would otherwise trip the limiter
// mid-suite. test/invitation-throttle.test.js covers the limiter itself.
Object.assign(process.env, { NODE_ENV: 'test', DATA_DIR: data, QUEUE_ENABLED: 'false', DINGTALK_APP_KEY: 'test', DINGTALK_APP_SECRET: 'test', DINGTALK_CORP_ID: 'test', SESSION_SECRET: 'invitation-test-secret', COOKIE_SECURE: 'false', APP_BASE_URL: 'https://english.example.test/service/', INVITATION_REDEEM_IP_LIMIT: '10000', INVITATION_REDEEM_NAME_LIMIT: '10000' });
const { app, testHelpers } = require('../src/app');
const { invitationsMetadataFile } = require('../src/config');
const { readJsonLines } = require('../src/storage');
let server, base;
test.before(async () => { server = await listenForTest(app); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(data, { recursive: true, force: true }); });
function member(owner = 'inviter') { return { Cookie: `englisheval_session=${testHelpers.createSessionToken({ openId: owner, name: 'Member' })}`, 'X-Expected-Owner': owner }; }
async function issue() { const response = await fetch(base + '/api/invitation-codes', { method: 'POST', headers: member() }); assert.equal(response.status, 201); return response.json(); }
function redeem(code, name = 'Alice', cookie = '') { return fetch(base + '/api/invitation/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ code, name }) }); }
function cookies(response) { return response.headers.getSetCookie().map(value => value.split(';')[0]).join('; '); }
function claims(id) { return readJsonLines(invitationsMetadataFile).filter(row => row.id === id && row.usedAt); }
test('QR is owner-only PNG with configured URL, and viewing never claims it', async () => {
  const { record, code } = await issue();
  const route = base + `/api/invitation-codes/${record.id}/qr`;
  assert.equal((await fetch(route)).status, 401);
  assert.equal((await fetch(route, { headers: member('other') })).status, 404);
  const response = await fetch(route, { headers: member() });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), await QRCode.toBuffer(`https://english.example.test/service/invite#code=${code}`, { type: 'png', width: 480, margin: 4, errorCorrectionLevel: 'M' }));
  await fetch(base + `/invite#code=${code}`);
  assert.equal(readJsonLines(invitationsMetadataFile).find(row => row.id === record.id).usedAt, null);
  assert.equal((await fetch(base + `/api/invitation-codes/${record.id}`, { method: 'DELETE', headers: member() })).status, 200);
  assert.equal((await fetch(route, { headers: member() })).status, 404);
  assert.equal((await redeem(code)).status, 400);
});
test('the shareable link matches the QR payload and is listed for its owner', async () => {
  const { record, code } = await issue();
  const expected = `https://english.example.test/service/invite#code=${code}`;
  assert.equal(record.shareUrl, expected);
  const listed = await (await fetch(base + '/api/invitation-codes', { headers: member() })).json();
  const row = listed.codes.find(entry => entry.id === record.id);
  // The inviter copies this exact string, so it must not drift from what the QR encodes.
  assert.equal(row.shareUrl, expected);
  // The code rides in the fragment: the part before it carries no secret.
  const parsed = new URL(row.shareUrl);
  assert.equal(parsed.search, '');
  assert.equal(parsed.pathname, '/service/invite');
  assert.equal(new URLSearchParams(parsed.hash.slice(1)).get('code'), code);
  assert.equal((await fetch(base + `/api/invitation-codes/${record.id}`, { method: 'DELETE', headers: member() })).status, 200);
});
test('first claim stores the name, and a blank name cannot claim an unused code', async () => {
  const { code, record } = await issue();
  const omitted = await fetch(base + '/api/invitation/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
  assert.equal(omitted.status, 400);
  assert.equal((await omitted.json()).code, 'INVITATION_NAME_REQUIRED');
  for (const name of ['', '   ', null]) {
    const rejected = await redeem(code, name);
    assert.equal(rejected.status, 400, JSON.stringify(name));
    assert.equal((await rejected.json()).code, 'INVITATION_NAME_REQUIRED');
    assert.equal(rejected.headers.get('set-cookie'), null);
  }
  assert.equal(claims(record.id).length, 0);
  const tooLong = await redeem(code, 'x'.repeat(31));
  assert.equal(tooLong.status, 400);
  assert.equal((await tooLong.json()).code, 'INVITATION_NAME_TOO_LONG');
  assert.equal(tooLong.headers.get('set-cookie'), null);
  const first = await redeem(code, '  Alice  ');
  assert.equal(first.status, 200);
  assert.equal((await first.json()).user.name, 'Alice');
  assert.equal(claims(record.id)[0].guestName, 'Alice');
  const { code: limitCode } = await issue();
  const atLimit = await redeem(limitCode, 'x'.repeat(30));
  assert.equal(atLimit.status, 200);
  assert.equal((await atLimit.json()).user.name, 'x'.repeat(30));
});
test('first claimant can return; others need the name, and failures set no session', async () => {
  const { code, record } = await issue();
  const first = await redeem(code.toLowerCase());
  assert.equal(first.status, 200);
  const cookie = cookies(first), user = (await first.json()).user;
  const before = readJsonLines(invitationsMetadataFile).length;
  const repeat = await redeem(code, 'anything', cookie);
  assert.equal(repeat.status, 200);
  assert.equal((await repeat.json()).user.openId, user.openId);
  assert.equal(readJsonLines(invitationsMetadataFile).length, before);
  const missing = await redeem(code, '');
  assert.equal(missing.status, 409);
  assert.equal((await missing.json()).code, 'INVITATION_NAME_REQUIRED');
  assert.equal(missing.headers.get('set-cookie'), null);
  const wrong = await redeem(code, 'Bob');
  assert.equal(wrong.status, 409);
  assert.equal((await wrong.json()).code, 'INVITATION_NAME_MISMATCH');
  assert.equal(wrong.headers.get('set-cookie'), null);
  // A forged cookie carries no weight: it neither grants the owner identity nor skips the name check.
  const forged = cookie.replace('englisheval_guest=', 'englisheval_guest=forged');
  assert.equal((await redeem(code, 'Bob', forged)).status, 409);
  assert.equal((await redeem('invalid', cookie)).headers.get('set-cookie'), null);
  assert.equal((await fetch(base + `/api/invitation-codes/${record.id}/qr`, { headers: member() })).status, 200);
});
test('another browser recovers the same identity with the name, ignoring case and surrounding space', async () => {
  const { code } = await issue();
  const first = await redeem(code, 'Alice');
  const owner = (await first.json()).user.openId;
  for (const name of ['Alice', '  alice  ', 'ALICE', '\tAlIcE\n']) {
    const recovered = await redeem(code, name);
    assert.equal(recovered.status, 200, name);
    const body = await recovered.json();
    assert.equal(body.user.openId, owner);
    assert.equal(body.user.name, 'Alice');
    assert.equal(body.user.identityType, 'guest');
  }
  assert.equal((await fetch(base + '/api/me', { headers: { Cookie: cookies(await redeem(code, 'alice')) } }).then(response => response.json())).user.name, 'Alice');
});
test('used codes without a stored name cannot be recovered, but their own browser keeps access', async () => {
  const { code, record } = await issue();
  const first = await redeem(code, 'Alice');
  const cookie = cookies(first);
  fs.appendFileSync(invitationsMetadataFile, JSON.stringify({ ...readJsonLines(invitationsMetadataFile).pop(), guestName: undefined, guestNameHash: undefined }) + '\n');
  const returning = await redeem(code, 'Alice', cookie);
  assert.equal(returning.status, 200);
  assert.equal((await returning.json()).user.openId, (await first.json()).user.openId);
  const stranger = await redeem(code, 'Alice');
  assert.equal(stranger.status, 409);
  assert.equal((await stranger.json()).code, 'INVITATION_NAME_REQUIRED');
  assert.equal(record.id.length > 0, true);
});
test('invalid and deleted codes are rejected before any name check', async () => {
  const { record, code } = await issue();
  assert.equal((await redeem('nope', 'Alice')).status, 400);
  assert.equal((await fetch(base + `/api/invitation-codes/${record.id}`, { method: 'DELETE', headers: member() })).status, 200);
  const deleted = await redeem(code, 'Alice');
  assert.equal(deleted.status, 400);
  assert.deepEqual(await deleted.json(), { error: 'Invalid invitation code.' });
});
test('simultaneous first claims produce exactly one owner', async () => {
  const { code, record } = await issue();
  const responses = await Promise.all(Array.from({ length: 8 }, (_, index) => redeem(code, `Guest ${index}`)));
  assert.equal(responses.filter(response => response.status === 200).length, 1);
  assert.equal(responses.filter(response => response.status === 409).length, 7);
  const rows = claims(record.id);
  assert.equal(rows.length, 1);
  assert.match(rows[0].guestName, /^Guest \d$/);
  const owners = new Set((await Promise.all(responses.map(response => response.json()))).map(body => body.user?.openId).filter(Boolean));
  assert.equal(owners.size, 1);
});
test('the stored name is returned and visible to the invitation owner', async () => {
  const { code, record } = await issue();
  const claimed = await redeem(code, 'Alice');
  assert.equal((await claimed.json()).user.name, 'Alice');
  const listed = await (await fetch(base + '/api/invitation-codes', { headers: member() })).json();
  const row = listed.codes.find(entry => entry.id === record.id);
  assert.equal(row.guestName, 'Alice');
  assert.equal(row.usedAt !== null, true);
  assert.equal(row.hash, undefined);
  assert.equal(row.guestNameHash, undefined);
  const stranger = await (await fetch(base + '/api/invitation-codes', { headers: member('other') })).json();
  assert.equal(stranger.codes.some(entry => entry.id === record.id), false);
  assert.equal((await fetch(base + `/api/invitation-codes/${record.id}`, { method: 'DELETE', headers: member() })).status, 409);
});
test('each DingTalk member can generate at most 100 invitation codes', async () => {
  const owner = 'quota-owner';
  const create = () => fetch(base + '/api/invitation-codes', { method: 'POST', headers: member(owner) });
  for (let index = 0; index < 100; index += 1) {
    assert.equal((await create()).status, 201, `invitation ${index + 1}`);
  }

  const limited = await create();
  assert.equal(limited.status, 429);
  const body = await limited.json();
  assert.equal(body.code, 'INVITATION_QUOTA_EXCEEDED');
  assert.deepEqual(body.quota, { issued: 100, limit: 100, remaining: 0 });

  const listed = await (await fetch(base + '/api/invitation-codes', { headers: member(owner) })).json();
  assert.deepEqual(listed.quota, { issued: 100, limit: 100, remaining: 0 });
  assert.equal(listed.codes.length, 100);

  // Deleting an unused code must not hand the quota back.
  const unused = listed.codes.find(entry => !entry.usedAt);
  assert.equal((await fetch(base + `/api/invitation-codes/${unused.id}`, { method: 'DELETE', headers: member(owner) })).status, 200);
  assert.equal((await create()).status, 429);
  assert.equal((await (await fetch(base + '/api/invitation-codes', { headers: member(owner) })).json()).quota.issued, 100);

  // The cap is per member, so another inviter is unaffected.
  assert.equal((await fetch(base + '/api/invitation-codes', { method: 'POST', headers: member('other-member') })).status, 201);
});

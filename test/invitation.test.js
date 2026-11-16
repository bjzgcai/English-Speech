const { listenForTest } = require('../scripts/test-http');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const QRCode = require('qrcode');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'invitation-test-'));
// The redeem throttle budgets are widened here: these tests exercise claim
// semantics from a single address and would otherwise trip the limiter
// mid-suite. test/invitation-throttle.test.js covers the limiter itself.
Object.assign(process.env, { NODE_ENV: 'test', DATA_DIR: data, QUEUE_ENABLED: 'false', DINGTALK_CLIENT_ID: 'test', DINGTALK_CLIENT_SECRET: 'test', DINGTALK_CORP_ID: 'test', SESSION_SECRET: 'invitation-test-secret', COOKIE_SECURE: 'false', APP_BASE_URL: 'https://english.example.test/service/', INVITATION_REDEEM_IP_LIMIT: '10000', INVITATION_REDEEM_NAME_LIMIT: '10000', INVITATION_ADMIN_NAMES: 'Admin User,Teacher Beta,Teacher Alpha,Inviter Admin', INVITER_OPEN_IDS: '' });
const { app, testHelpers } = require('../src/app');
const { invitationsMetadataFile } = require('../src/config');
const { readJsonLines } = require('../src/storage');
let server, base;
test.before(async () => { server = await listenForTest(app); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(data, { recursive: true, force: true }); });
function member(owner = 'inviter', name = 'Teacher Alpha') { return { Cookie: `englisheval_session=${testHelpers.createSessionToken({ openId: owner, name })}`, 'X-Expected-Owner': owner }; }
async function issue() { const response = await fetch(base + '/api/invitation-codes', { method: 'POST', headers: member() }); assert.equal(response.status, 201); return response.json(); }
function campaignBody(overrides = {}) {
  return {
    name: 'Autumn English Test',
    max_uses: 200,
    start_time: new Date(Date.now() - 60_000).toISOString(),
    end_time: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}
async function issueCampaign(owner = 'inviter', overrides = {}) {
  const response = await fetch(base + '/api/invitation-campaigns', {
    method: 'POST',
    headers: { ...member(owner), 'Content-Type': 'application/json' },
    body: JSON.stringify(campaignBody(overrides)),
  });
  assert.equal(response.status, 201);
  return response.json();
}
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
test('a campaign owns one reusable QR and only its creator can inspect registrations', async () => {
  const { record } = await issueCampaign();
  assert.equal(record.max_uses, 200);
  assert.equal(record.registered, 0);
  assert.equal(record.status, 'open');
  assert.equal(record.shareUrl, `https://english.example.test/service/invite#code=${record.code}`);

  const route = base + `/api/invitation-campaigns/${record.id}/qr`;
  assert.equal((await fetch(route)).status, 401);
  assert.equal((await fetch(route, { headers: member('other') })).status, 404);
  const qr = await fetch(route, { headers: member() });
  assert.equal(qr.status, 200);
  assert.deepEqual(
    Buffer.from(await qr.arrayBuffer()),
    await QRCode.toBuffer(record.shareUrl, { type: 'png', width: 480, margin: 4, errorCorrectionLevel: 'M' }),
  );

  const listed = await (await fetch(base + '/api/invitation-campaigns', { headers: member() })).json();
  assert.equal(listed.campaigns.some(entry => entry.id === record.id), true);
  const hidden = await (await fetch(base + '/api/invitation-campaigns', { headers: member('other') })).json();
  assert.equal(hidden.campaigns.some(entry => entry.id === record.id), false);
  assert.equal((await fetch(base + `/api/invitation-campaigns/${record.id}/accounts`, { headers: member('other') })).status, 404);
});
test('only the designated DingTalk administrators may open invitation management', async () => {
  for (const [index, name] of ['Admin User', 'Teacher Beta', 'Teacher Alpha', 'Inviter Admin'].entries()) {
    const headers = member(`admin-${index}`, name);
    assert.equal((await fetch(base + '/api/invitation-campaigns', { headers })).status, 200, name);
    assert.equal((await fetch(base + '/invitation-codes', { headers, redirect: 'manual' })).status, 200, name);
  }
  const denied = member('unexpected-member', '普通成员');
  assert.equal((await fetch(base + '/api/invitation-campaigns', { headers: denied })).status, 403);
  const page = await fetch(base + '/invitation-codes', { headers: denied, redirect: 'manual' });
  assert.equal(page.status, 302);
  assert.equal(page.headers.get('location'), '/leaderboard');
});
test('campaign creation validates its name, seat count, and registration window', async () => {
  const create = body => fetch(base + '/api/invitation-campaigns', {
    method: 'POST',
    headers: { ...member('validation-owner'), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let response = await create(campaignBody({ name: '   ' }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'CAMPAIGN_NAME_REQUIRED');
  response = await create(campaignBody({ max_uses: 10000 }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'CAMPAIGN_WINDOW_INVALID');
  const start = new Date(Date.now() + 60_000).toISOString();
  const end = new Date(Date.now() + 120_000).toISOString();
  response = await create(campaignBody({ start_time: end, end_time: start }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'CAMPAIGN_WINDOW_INVALID');
  response = await create(campaignBody({ start_time: 'not-a-date' }));
  assert.equal(response.status, 400);
  const withoutLimit = campaignBody();
  delete withoutLimit.max_uses;
  const defaultCampaign = await create(withoutLimit);
  assert.equal(defaultCampaign.status, 201);
  assert.equal((await defaultCampaign.json()).record.max_uses, 200);
  const maximum = await create(campaignBody({ max_uses: 9999 }));
  assert.equal(maximum.status, 201);
  assert.equal((await maximum.json()).record.max_uses, 9999);
});
test('a campaign enforces its start and end times for new accounts', async () => {
  const upcoming = await issueCampaign('window-owner', {
    start_time: new Date(Date.now() + 60_000).toISOString(),
    end_time: new Date(Date.now() + 120_000).toISOString(),
  });
  const early = await redeem(upcoming.record.code, 'Early');
  assert.equal(early.status, 403);
  assert.equal((await early.json()).code, 'INVITATION_NOT_STARTED');

  const expired = await issueCampaign('window-owner', {
    start_time: new Date(Date.now() - 120_000).toISOString(),
    end_time: new Date(Date.now() - 60_000).toISOString(),
  });
  const late = await redeem(expired.record.code, 'Late');
  assert.equal(late.status, 403);
  assert.equal((await late.json()).code, 'INVITATION_EXPIRED');
});
test('the 山东大学 campaign assigns g3 to its personal invitation accounts', async () => {
  const code = '1B5190BE4F1F';
  const now = Date.now();
  fs.appendFileSync(invitationsMetadataFile, JSON.stringify({
    id: 'shandong-campaign',
    kind: 'campaign',
    name: '山东大学',
    code,
    hash: crypto.createHash('sha256').update(code).digest('hex'),
    codePreview: code.slice(-4),
    max_uses: 2,
    start_time: new Date(now - 60_000).toISOString(),
    end_time: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
    inviterOpenId: 'shandong-inviter',
    inviterName: '山东大学',
    createdAt: new Date(now - 120_000).toISOString(),
    deletedAt: null,
  }) + '\n');

  const first = await redeem(code, '山大同学');
  assert.equal(first.status, 201);
  const firstBody = await first.json();
  assert.equal(firstBody.gameGroup, 'g3');
  assert.equal(firstBody.user.identityType, 'guest');

  const identity = await fetch(base + '/api/me', { headers: { Cookie: cookies(first) } });
  assert.equal(identity.status, 200);
  assert.equal((await identity.json()).gameGroup, 'g3');

  const personalCode = new URL(firstBody.loginUrl).hash
    .split('&')
    .find(part => part.startsWith('#code='))
    .slice(6);
  const returning = await redeem(personalCode, '山大同学');
  assert.equal(returning.status, 200);
  assert.equal((await returning.json()).gameGroup, 'g3');

  const claim = readJsonLines(invitationsMetadataFile)
    .find(row => row.kind === 'campaign-account' && row.campaignId === 'shandong-campaign');
  assert.equal(claim.gameGroup, 'g3');
});
test('a campaign seat creates a personal code, allows duplicate names, and survives campaign expiry', async () => {
  const { record } = await issueCampaign('personal-owner', { max_uses: 2 });
  const first = await redeem(record.code, '同名用户');
  const second = await redeem(record.code, '同名用户');
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const firstBody = await first.json();
  const secondBody = await second.json();
  assert.notEqual(firstBody.user.openId, secondBody.user.openId);
  assert.match(firstBody.loginUrl, /#code=[0-9A-F]+&name=/);
  assert.match(secondBody.loginUrl, /#code=[0-9A-F]+&name=/);
  assert.notEqual(firstBody.loginUrl, secondBody.loginUrl);

  const full = await redeem(record.code, 'Third');
  assert.equal(full.status, 409);
  assert.equal((await full.json()).code, 'INVITATION_FULL');

  // Ends the campaign after both accounts exist. New registrations stop, but
  // each account's personal code remains a valid login credential.
  const stored = readJsonLines(invitationsMetadataFile).find(row => row.id === record.id);
  fs.appendFileSync(invitationsMetadataFile, JSON.stringify({
    ...stored,
    end_time: new Date(Date.now() - 1_000).toISOString(),
  }) + '\n');
  assert.equal((await redeem(record.code, 'Another')).status, 403);
  const personalCode = new URL(firstBody.loginUrl).hash.split('&').find(part => part.startsWith('#code=')).slice(6);
  const returning = await redeem(personalCode, '同名用户');
  assert.equal(returning.status, 200);
  assert.equal((await returning.json()).user.openId, firstBody.user.openId);
  const wrongName = await redeem(personalCode, 'Wrong Name');
  assert.equal(wrongName.status, 409);
  assert.equal((await wrongName.json()).code, 'INVITATION_NAME_MISMATCH');

  const ownLink = await fetch(base + '/api/me/login-link', { headers: { Cookie: cookies(await redeem(personalCode, '同名用户')) } });
  assert.equal(ownLink.status, 200);
  assert.equal((await ownLink.json()).url, firstBody.loginUrl);

  const accounts = await fetch(base + `/api/invitation-campaigns/${record.id}/accounts`, { headers: member('personal-owner') });
  assert.equal(accounts.status, 200);
  const accountRows = (await accounts.json()).accounts;
  assert.equal(accountRows.length, 2);
  assert.deepEqual(accountRows.map(row => row.name), ['同名用户', '同名用户']);
  assert.deepEqual(new Set(accountRows.map(row => row.loginUrl)), new Set([firstBody.loginUrl, secondBody.loginUrl]));
});
test('200 concurrent campaign registrations claim exactly 200 seats', async () => {
  const { record } = await issueCampaign('capacity-owner');
  const responses = await Promise.all(Array.from({ length: 200 }, (_, index) =>
    redeem(record.code, `Learner ${index}`)
  ));
  assert.equal(responses.filter(response => response.status === 201).length, 200);
  const bodies = await Promise.all(responses.filter(response => response.status === 201).map(response => response.json()));
  assert.equal(new Set(bodies.map(body => body.user.openId)).size, 200);
  assert.equal(new Set(bodies.map(body => body.loginUrl)).size, 200);
  assert.equal(claims(record.id).length, 0, 'campaign claims use account rows rather than mutating the campaign row');
  assert.equal(readJsonLines(invitationsMetadataFile).filter(row => row.kind === 'campaign-account' && row.campaignId === record.id).length, 200);

  const overflow = await redeem(record.code, 'Learner 201');
  assert.equal(overflow.status, 409);
  assert.equal((await overflow.json()).code, 'INVITATION_FULL');
  const listed = await (await fetch(base + '/api/invitation-campaigns', { headers: member('capacity-owner') })).json();
  const listedCampaign = listed.campaigns.find(entry => entry.id === record.id);
  assert.equal(listedCampaign.registered, 200);
  assert.equal(listedCampaign.remaining, 0);
  assert.equal(listedCampaign.status, 'full');
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

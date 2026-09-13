const { listenForTest } = require("../scripts/test-http");
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-guests-"));
Object.assign(process.env, {
  NODE_ENV: "test", DATA_DIR: dataDir, SESSION_SECRET: "guest-test-secret",
  DINGTALK_APP_KEY: "", DINGTALK_APP_SECRET: "", DINGTALK_CORP_ID: "",
  COOKIE_SECURE: "false", QUEUE_ENABLED: "false", PARTNER_API_KEY: "guest-test-partner",
});
const { app, testHelpers } = require("../src/app");
const config = require("../src/config");
const { appendJsonLine } = require("../src/storage");
let server;
let base;
test.before(async () => {
  server = await listenForTest(app);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});
async function guest(cookie = "") {
  const response = await fetch(base + "/api/me", { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const data = await response.json();
  const cookies = new Map(cookie.split("; ").filter(Boolean).map(value => [value.slice(0, value.indexOf("=")), value]));
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(";")[0];
    cookies.set(pair.slice(0, pair.indexOf("=")), pair);
  }
  return { ...data, cookie: [...cookies.values()].join("; "), setCookie: response.headers.get("set-cookie") };
}
function headers(person) {
  return { Cookie: person.cookie, ...(person.user ? { "X-Expected-Owner": person.user.openId } : {}), "Content-Type": "application/json" };
}
function call(person, route, body) {
  return fetch(base + route, { headers: headers(person), method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body) });
}
async function consent(person) {
  assert.equal((await call(person, "/api/privacy-consent", { privacyAgreed: true, sensitiveInfoAgreed: true })).status, 201);
}
async function invitedGuest() {
  const code = crypto.randomUUID().toUpperCase();
  appendJsonLine(config.invitationsMetadataFile, { id: crypto.randomUUID(), hash: crypto.createHash("sha256").update(code).digest("hex") });
  const response = await fetch(base + "/api/invitation/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, name: "Invited Guest" }) });
  assert.equal(response.status, 200);
  const cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const repeated = await fetch(base + "/api/invitation/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, name: "Someone Else" }) });
  assert.equal(repeated.status, 409);
  assert.equal((await repeated.json()).code, "INVITATION_NAME_MISMATCH");
  const recovered = await fetch(base + "/api/invitation/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, name: "invited guest" }) });
  assert.equal(recovered.status, 200);
  const person = await guest(cookie);
  person.cookie = cookie;
  assert.equal(person.hasAccess, true);
  return person;
}

test("anonymous identity queries are stateless and disclose no corpId", async () => {
  for (let i = 0; i < 3; i++) {
    const person = await guest();
    assert.equal(person.configured, false);
    assert.equal(person.identityType, null);
    assert.equal(person.user, null);
    assert.equal(person.hasAccess, false);
    assert.equal(person.setCookie, null);
    assert.equal(Object.hasOwn(person.inAppAuth, "corpId"), false);
    assert.equal((await call(person, "/api/game/identity")).status, 401);
  }
});

test("invited identities persist without creating or renewing cookies on reads", async () => {
  const first = await invitedGuest();
  const second = await invitedGuest();
  assert.notEqual(first.user.openId, second.user.openId);
  assert.equal((await guest(first.cookie)).user.openId, first.user.openId);
  assert.equal((await guest(first.cookie)).setCookie, null);
});

test("tampered, expired, malformed, and unredeemed cookies cannot claim an identity", async () => {
  const first = await invitedGuest();
  const id = first.user.openId;
  const sign = payload => crypto.createHmac("sha256", process.env.SESSION_SECRET).update(`guest\0${payload}`).digest("base64url");
  const payload = Buffer.from(JSON.stringify({ id, exp: Date.now() - 1 })).toString("base64url");
  const forged = testHelpers.createSessionToken({ openId: id, identityType: "guest" });
  for (const cookie of [
    first.cookie + "x",
    "englisheval_guest=%invalid",
    `englisheval_guest=${payload}.${sign(payload)}; englisheval_access=${id}.${sign(id)}`,
    `englisheval_session=${forged}`,
    first.cookie.split("; ")[0],
  ]) {
    const person = await guest(cookie);
    assert.equal(person.user, null);
    assert.equal(person.hasAccess, false);
    assert.equal(person.setCookie, null);
  }
});

test("missing or stale expected-owner headers are rejected before mutation or upload", async () => {
  const first = await invitedGuest();
  const second = await invitedGuest();
  for (const expected of [undefined, second.user.openId]) {
    const h = { Cookie: first.cookie, ...(expected ? { "X-Expected-Owner": expected } : {}) };
    for (const route of ["/api/privacy-consent", "/api/save-answer", "/api/evaluate-video"]) {
      const response = await fetch(base + route, { method: "POST", headers: h });
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, "IDENTITY_CHANGED");
    }
  }
  assert.deepEqual(fs.readdirSync(config.recordingTmpDir), []);
});

test("DingTalk takes precedence and logout restores guest history and consent independently", async () => {
  const first = await invitedGuest();
  await consent(first);
  const dingUser = { openId: "real-dingtalk-owner", name: "DingTalk Member" };
  const dingCookie = `englisheval_session=${testHelpers.createSessionToken(dingUser)}`;
  const loggedIn = await guest(`${first.cookie}; ${dingCookie}`);
  assert.equal(loggedIn.identityType, "dingtalk");
  assert.equal(loggedIn.user.openId, dingUser.openId);
  assert.equal((await (await call(loggedIn, "/api/privacy-consent")).json()).agreed, false);
  const stale = await fetch(base + "/api/game/question", { method: "POST", headers: { ...headers(first), Cookie: loggedIn.cookie } });
  assert.equal(stale.status, 409);
  const logout = await fetch(base + "/auth/logout", { method: "POST", headers: { Cookie: loggedIn.cookie } });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie"), /englisheval_session=;/);
  const restored = await guest(first.cookie);
  assert.equal(restored.user.openId, first.user.openId);
  assert.equal((await (await call(restored, "/api/privacy-consent")).json()).agreed, true);
});

test("guest questions and private recordings remain owned, consent-gated and outside public exports", async () => {
  const first = await invitedGuest();
  const other = await invitedGuest();
  assert.equal((await call(first, "/api/game/question", {})).status, 403);
  await consent(first);
  const generated = await call(first, "/api/game/question", { profile: { name: "Spoofed employee" } });
  assert.equal(generated.status, 201);
  const { question } = await generated.json();
  await consent(other);
  assert.equal((await call(other, "/api/save-answer", { questionId: question.id })).status, 400);
  const id = crypto.randomUUID();
  fs.writeFileSync(path.join(config.recordingsDir, `${id}.mp4`), Buffer.alloc(32, 7));
  appendJsonLine(config.metadataFile, {
    id, openId: first.user.openId, user: first.user, filename: `${id}.mp4`, hasVideo: true,
    sourceType: "upload", finishedAt: new Date().toISOString(),
    evaluation: { status: "completed", overallScore: 80, rubric: {} },
  });
  assert.equal((await (await call(first, "/api/recordings")).json()).recordings.length, 1);
  assert.equal((await (await call(other, "/api/recordings")).json()).recordings.length, 0);
  assert.equal((await call(first, `/api/recordings/${id}/video`)).status, 200);
  assert.equal((await call(other, `/api/recordings/${id}/video`)).status, 404);
  assert.equal((await fetch(base + `/api/public-evaluations/${id}/video`)).status, 404);
  assert.equal((await fetch(base + `/api/public-evaluations/${id}/poster`)).status, 404);
  assert.deepEqual((await (await fetch(base + "/api/public-evaluations")).json()).evaluations, []);
  const exported = await (await fetch(base + "/api/v1/users", { headers: { Authorization: "Bearer guest-test-partner" } })).json();
  assert.equal(exported.users.some(user => user.openId.startsWith("guest:")), false);
  const admin = await call(first, "/api/admin/statistics");
  assert.ok([401, 503].includes(admin.status));
  assert.equal((await fetch(base + "/admin", { headers: headers(first), redirect: "manual" })).status, 302);
});

test("public browsing needs no access, while private actions require login or invitation", async () => {
  const visitor = await guest();
  for (const route of ["/leaderboard", "/game", "/examine", "/methodology", "/api/game/challenge", "/api/game/leaderboard"]) {
    assert.equal((await fetch(base + route)).status, 200, route);
  }
  const board = await (await fetch(base + "/api/game/leaderboard")).json();
  assert.equal(board.viewerRank, null);
  assert.ok(board.entries.every(entry => !entry.isViewer && !entry.openId));
  for (const route of ["/api/game/question", "/api/generate-question", "/api/save-answer", "/api/evaluate-video"]) {
    const response = await call(visitor, route, {});
    assert.equal(response.status, 401, route);
    assert.equal((await response.json()).code, "AUTH_REQUIRED");
  }
  assert.equal((await call(visitor, "/api/recordings")).status, 401);
  const invalid = await fetch(base + "/api/invitation/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "INVALID" }) });
  assert.equal(invalid.status, 400);
});

test("an invited guest can sign out and loses access without losing the invitation", async () => {
  const code = crypto.randomUUID().toUpperCase();
  appendJsonLine(config.invitationsMetadataFile, { id: crypto.randomUUID(), hash: crypto.createHash("sha256").update(code).digest("hex") });
  const claimed = await fetch(base + "/api/invitation/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, name: "Ada Lovelace" }) });
  assert.equal(claimed.status, 200);
  const cookie = claimed.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const before = await guest(cookie);
  assert.equal(before.hasAccess, true);
  assert.equal(before.user.name, "Ada Lovelace");
  assert.equal(before.accessMode, "invitation");
  const logout = await fetch(base + "/auth/logout", { method: "POST", headers: { Cookie: cookie } });
  assert.equal(logout.status, 200);
  const cleared = logout.headers.getSetCookie();
  for (const name of ["englisheval_guest", "englisheval_access"]) {
    const dropped = cleared.find(value => value.startsWith(`${name}=`));
    assert.ok(dropped, `${name} should be cleared`);
    assert.match(dropped, /Expires=Thu, 01 Jan 1970|Max-Age=0/);
  }
  // Cookies are stateless, so a browser that honours the clearing loses access immediately.
  const after = await guest("");
  assert.equal(after.hasAccess, false);
  assert.equal(after.accessMode, null);
  assert.equal(after.user, null);
  assert.equal(after.setCookie, null);
  // The invitation keeps its owner, so the same name restores the same identity.
  const again = await fetch(base + "/api/invitation/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, name: "ada lovelace" }) });
  assert.equal(again.status, 200);
  assert.equal((await again.json()).user.openId, before.user.openId);
  const restored = await guest(again.headers.getSetCookie().map(value => value.split(";")[0]).join("; "));
  assert.equal(restored.hasAccess, true);
  assert.equal(restored.user.name, "Ada Lovelace");
});

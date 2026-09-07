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
const { guestTtlMs } = require("../src/visitor");
let server;
let base;
test.before(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
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
  return { ...data, cookie: response.headers.get("set-cookie")?.split(";")[0] || cookie, setCookie: response.headers.get("set-cookie") };
}
function headers(person) {
  return { Cookie: person.cookie, "X-Expected-Owner": person.user.openId, "Content-Type": "application/json" };
}
function call(person, route, body) {
  return fetch(base + route, { headers: headers(person), method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body) });
}
async function consent(person) {
  assert.equal((await call(person, "/api/privacy-consent", { privacyAgreed: true, sensitiveInfoAgreed: true })).status, 201);
}

test("guest sessions need no DingTalk, persist, renew, and do not merge browsers sharing an IP", async () => {
  const first = await guest();
  const second = await guest();
  assert.equal(first.configured, false);
  assert.equal(first.identityType, "guest");
  assert.equal(first.user.identityType, "guest");
  assert.match(first.user.openId, /^guest:/);
  assert.notEqual(first.user.openId, second.user.openId);
  assert.equal((await guest(first.cookie)).user.openId, first.user.openId);
  assert.match(first.setCookie, /HttpOnly/);
  assert.match(first.setCookie, /SameSite=Lax/);
  assert.match(first.setCookie, new RegExp(`Max-Age=${guestTtlMs / 1000}`));
  assert.equal((await call(first, "/api/game/identity")).status, 200);
});

test("tampered, expired, malformed, and cross-purpose cookies cannot claim a guest identity", async () => {
  const first = await guest();
  assert.notEqual((await guest(first.cookie + "x")).user.openId, first.user.openId);
  assert.notEqual((await guest("englisheval_guest=%invalid")).user.openId, first.user.openId);
  const payload = Buffer.from(JSON.stringify({ id: first.user.openId, exp: Date.now() - 1 })).toString("base64url");
  const signature = crypto.createHmac("sha256", process.env.SESSION_SECRET).update(`guest\0${payload}`).digest("base64url");
  assert.notEqual((await guest(`englisheval_guest=${payload}.${signature}`)).user.openId, first.user.openId);
  const forged = testHelpers.createSessionToken({ openId: first.user.openId, identityType: "guest" });
  assert.notEqual((await guest(`englisheval_session=${forged}`)).user.openId, first.user.openId);
});

test("missing or stale expected-owner headers are rejected before mutation or upload", async () => {
  const first = await guest();
  const second = await guest();
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
  const first = await guest();
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
  const first = await guest();
  const other = await guest();
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

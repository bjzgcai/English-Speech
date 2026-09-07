const assert = require("node:assert/strict");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-session-secret";
process.env.DINGTALK_APP_KEY = "test-app-key";
process.env.DINGTALK_APP_SECRET = "test-app-secret";
process.env.DINGTALK_CORP_ID = "test-corp-id";

const { app, testHelpers } = require("../src/app");

test("OAuth state is signed, nonce-bound, and expires", () => {
  const now = Date.now();
  const state = testHelpers.createOAuthState("nonce-a", "/history?from=login", now);

  assert.deepEqual(testHelpers.parseOAuthState(state, "nonce-a", now), {
    redirectPath: "/history?from=login",
  });
  assert.equal(testHelpers.parseOAuthState(state, "nonce-b", now), null);
  assert.equal(testHelpers.parseOAuthState(`${state}x`, "nonce-a", now), null);
  assert.equal(testHelpers.parseOAuthState(state, "nonce-a", now + 11 * 60 * 1000), null);
});

test("OAuth redirects remain local", () => {
  assert.equal(testHelpers.normalizeRedirectPath("/history#latest"), "/history#latest");
  assert.equal(testHelpers.normalizeRedirectPath("//attacker.example"), "/");
  assert.equal(testHelpers.normalizeRedirectPath("/\\attacker.example"), "/");
  assert.equal(testHelpers.normalizeRedirectPath("https://attacker.example"), "/");
});

test("an explicit cookie security setting supports HTTP production", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousCookieSecure = process.env.COOKIE_SECURE;
  try {
    process.env.NODE_ENV = "production";
    process.env.COOKIE_SECURE = "false";
    assert.equal(testHelpers.useSecureSessionCookie(), false);

    delete process.env.COOKIE_SECURE;
    assert.equal(testHelpers.useSecureSessionCookie(), true);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    if (previousCookieSecure === undefined) delete process.env.COOKIE_SECURE;
    else process.env.COOKIE_SECURE = previousCookieSecure;
  }
});

test("DingTalk in-app login has a stable app-scoped ownership key", () => {
  const first = testHelpers.normalizeDingTalkInAppUser({
    userid: "employee-123",
    unionid: "union-123",
    name: "In-app user",
  });
  const second = testHelpers.normalizeDingTalkInAppUser({
    userid: "employee-123",
    unionid: "union-123",
    name: "Renamed user",
  });

  assert.equal(testHelpers.isDingTalkInAppConfigured(), true);
  assert.match(first.openId, /^inapp_[A-Za-z0-9_-]{43}$/);
  assert.equal(second.openId, first.openId);
  assert.equal(first.userId, "employee-123");
  assert.equal(first.unionId, "union-123");
});

test("DingTalk in-app login rejects a missing one-time authorization code", async (context) => {
  const server = app.listen(0);
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/auth/dingtalk/in-app`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /authorization code/i);
});

test("DingTalk login sets a nonce cookie and rejects tampered callback state", async (context) => {
  const server = app.listen(0);
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const loginResponse = await fetch(`${baseUrl}/auth/dingtalk?redirect=%2F%2Fattacker.example`, {
    redirect: "manual",
  });
  assert.equal(loginResponse.status, 302);
  const nonceCookie = loginResponse.headers.get("set-cookie");
  assert.match(nonceCookie, /^englisheval_oauth_nonce=/);

  const authorizationUrl = new URL(loginResponse.headers.get("location"));
  const state = authorizationUrl.searchParams.get("state");
  const nonce = nonceCookie.match(/^englisheval_oauth_nonce=([^;]+)/)[1];
  assert.deepEqual(testHelpers.parseOAuthState(state, nonce), { redirectPath: "/" });

  const callbackResponse = await fetch(
    `${baseUrl}/auth/dingtalk/callback?code=fake&state=${encodeURIComponent(`${state}x`)}`,
    { headers: { Cookie: `englisheval_oauth_nonce=${nonce}` } },
  );
  assert.equal(callbackResponse.status, 400);
  assert.match(await callbackResponse.text(), /Invalid or expired/);
});

test("question generation is blocked until the current privacy policy is accepted", async (context) => {
  const server = app.listen(0);
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));

  const user = { openId: `privacy-test-${Date.now()}`, name: "Privacy test user" };
  const session = testHelpers.createSessionToken(user);
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/generate-question`,
    {
      method: "POST",
      headers: {
        "X-Expected-Owner": JSON.parse(Buffer.from(session.split(".")[0], "base64url")).user.openId, Cookie: `englisheval_session=${session}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ profile: { name: "Test", role: "Tester" } }),
    },
  );

  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.code, "PRIVACY_CONSENT_REQUIRED");
  assert.equal(body.privacyUrl, "/privacy");
});

test("privacy consent endpoint rejects incomplete acknowledgement", async (context) => {
  const server = app.listen(0);
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));

  const session = testHelpers.createSessionToken({
    openId: `privacy-partial-${Date.now()}`,
    name: "Privacy test user",
  });
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/privacy-consent`,
    {
      method: "POST",
      headers: {
        "X-Expected-Owner": JSON.parse(Buffer.from(session.split(".")[0], "base64url")).user.openId, Cookie: `englisheval_session=${session}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ privacyAgreed: true, sensitiveInfoAgreed: false }),
    },
  );

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Both privacy acknowledgements/);
});

test("privacy policy is available at both public routes", async (context) => {
  const server = app.listen(0);
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  for (const route of ["/privacy", "/policy"]) {
    const response = await fetch(`${baseUrl}${route}`);
    assert.equal(response.status, 200);
    const policy = await response.text();
    assert.match(policy, /Privacy/i);
    assert.doesNotMatch(policy, /OpenRouter|境外处理/);
  }
});

test("learner pages are available without DingTalk login", async (context) => {
  const server = app.listen(0);
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  for (const route of ["/", "/leaderboard", "/game", "/examine", "/practice", "/history"]) {
    const response = await fetch(`${baseUrl}${route}`, { redirect: "manual" });
    assert.equal(response.status, route === "/" ? 302 : 200);
    if (route === "/") assert.equal(response.headers.get("location"), "/leaderboard");
  }

  for (const route of ["/intro", "/methodology", "/prepare"]) {
    const response = await fetch(`${baseUrl}${route}`, { redirect: "manual" });
    assert.equal(response.status, 200);
  }
});

test("authenticated users can open protected app pages", async (context) => {
  const server = app.listen(0);
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));

  const session = testHelpers.createSessionToken({
    openId: `page-reader-${Date.now()}`,
    name: "Page Reader",
  });
  const headers = { "X-Expected-Owner": JSON.parse(Buffer.from(session.split(".")[0], "base64url")).user.openId, Cookie: `englisheval_session=${session}` };
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const rootResponse = await fetch(`${baseUrl}/`, { headers, redirect: "manual" });
  assert.equal(rootResponse.status, 302);
  assert.equal(rootResponse.headers.get("location"), "/leaderboard");

  for (const route of ["/leaderboard", "/game", "/examine", "/practice", "/history"]) {
    const response = await fetch(`${baseUrl}${route}`, { headers, redirect: "manual" });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /id="playView"/);
  }
});

test("authenticated users can read the current weekly challenge and leaderboard", async (context) => {
  const server = app.listen(0);
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));

  const session = testHelpers.createSessionToken({
    openId: `game-reader-${Date.now()}`,
    name: "Game Reader",
  });
  const headers = { "X-Expected-Owner": JSON.parse(Buffer.from(session.split(".")[0], "base64url")).user.openId, Cookie: `englisheval_session=${session}` };
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const challengeResponse = await fetch(`${baseUrl}/api/game/challenge`, { headers });
  assert.equal(challengeResponse.status, 200);
  const challengeBody = await challengeResponse.json();
  assert.match(challengeBody.challenge.id, /^weekly-\d{4}-\d{2}-\d{2}$/);
  assert.equal(challengeBody.challenge.structuralGuide.length, 4);

  const leaderboardResponse = await fetch(
    `${baseUrl}/api/game/leaderboard?challengeId=${challengeBody.challenge.id}`,
    { headers },
  );
  assert.equal(leaderboardResponse.status, 200);
  const leaderboardBody = await leaderboardResponse.json();
  assert.equal(leaderboardBody.challenge.id, challengeBody.challenge.id);
  assert.ok(Array.isArray(leaderboardBody.entries));
});

test("users can keep one leaderboard alias, rename it, and switch back to their actual name", async (context) => {
  const server = app.listen(0);
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));

  const openId = `identity-user-${Date.now()}-${Math.random()}`;
  const aliasSuffix = openId.replace(/\D/g, "").slice(-8);
  const firstAlias = `Cozy Panda ${aliasSuffix}`;
  const secondAlias = `Sunny Otter ${aliasSuffix}`;
  const session = testHelpers.createSessionToken({ openId, name: "Identity Tester" });
  const headers = {
    "X-Expected-Owner": JSON.parse(Buffer.from(session.split(".")[0], "base64url")).user.openId, Cookie: `englisheval_session=${session}`,
    "Content-Type": "application/json",
  };
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const initialResponse = await fetch(`${baseUrl}/api/game/identity`, { headers });
  assert.equal(initialResponse.status, 200);
  const initial = (await initialResponse.json()).identity;
  assert.equal(initial.actualName, "Identity Tester");
  assert.equal(initial.useAlias, false);
  assert.match(initial.alias, /\S+ \S+ \d{4}/);

  const anonymousResponse = await fetch(`${baseUrl}/api/game/identity`, {
    method: "POST",
    headers,
    body: JSON.stringify({ useAlias: true, alias: firstAlias }),
  });
  assert.equal(anonymousResponse.status, 200);
  const anonymous = (await anonymousResponse.json()).identity;
  assert.equal(anonymous.displayName, firstAlias);
  assert.equal(anonymous.saved, true);

  const identifiedResponse = await fetch(`${baseUrl}/api/game/identity`, {
    method: "POST",
    headers,
    body: JSON.stringify({ useAlias: false, alias: secondAlias }),
  });
  assert.equal(identifiedResponse.status, 200);
  const identified = (await identifiedResponse.json()).identity;
  assert.equal(identified.alias, secondAlias);
  assert.equal(identified.displayName, "Identity Tester");

  const reloaded = await fetch(`${baseUrl}/api/game/identity`, { headers });
  assert.equal((await reloaded.json()).identity.alias, secondAlias);
});

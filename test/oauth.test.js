const assert = require("node:assert/strict");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-session-secret";
process.env.DINGTALK_APP_KEY = "test-app-key";
process.env.DINGTALK_APP_SECRET = "test-app-secret";

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

// The consent record has to show which collection the user was *shown* when
// they accepted. The gate's wording follows the camera toggle (audio-only must
// not promise video and frames), but the record is gated on the policy version
// alone — one accepted record unlocks every later submission under that
// version. The stored mode is therefore the only evidence of which copy was on
// screen at the moment of consent.
const { listenForTest } = require("../scripts/test-http");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.NODE_ENV = "test";
process.env.QUEUE_ENABLED = "false";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-consent-"));
process.env.SESSION_SECRET = "consent-test-secret";
const { app, testHelpers } = require("../src/app");

const consentsFile = path.join(process.env.DATA_DIR, "consents", "metadata.jsonl");

function records() {
  if (!fs.existsSync(consentsFile)) return [];
  return fs.readFileSync(consentsFile, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));
}

function own(openId) {
  return records().filter(record => record.openId === openId);
}

function call(base, openId, body) {
  return fetch(base + "/api/privacy-consent", {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Cookie: `englisheval_session=${testHelpers.createSessionToken({ openId, name: "Consent Tester" })}`,
      // requireVisitor makes every mutation carry the caller's own identity.
      "X-Expected-Owner": openId,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("the consent record states which collection was on screen at acceptance", async t => {
  const server = await listenForTest(app);
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const policyVersion = (await (await call(base, "consent-probe")).json()).policyVersion;
  assert.match(policyVersion, /^\d{4}-\d{2}-\d{2}$/);

  // 1. Accepting under the audio-only copy records exactly that.
  const audio = "consent-audio-owner";
  const created = await call(base, audio, {
    privacyAgreed: true, sensitiveInfoAgreed: true, collectionMode: "audio",
  });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).collectionMode, "audio");
  assert.equal(own(audio).length, 1);
  assert.equal(own(audio)[0].collectionMode, "audio");
  assert.equal(own(audio)[0].policyVersion, policyVersion);

  // 2. The read side reports it too, so a caller can compare it with what it is
  // about to collect.
  const mine = await (await call(base, audio)).json();
  assert.equal(mine.agreed, true);
  assert.equal(mine.collectionMode, "audio");

  // 3. An unrecognised mode is recorded as null, never guessed — and so is a
  // client that sends nothing at all. The key stays present either way, so the
  // schema does not drift.
  const unknown = "consent-unknown-mode";
  assert.equal((await call(base, unknown, {
    privacyAgreed: true, sensitiveInfoAgreed: true, collectionMode: "audio-video",
  })).status, 201);
  assert.ok(Object.hasOwn(own(unknown)[0], "collectionMode"));
  assert.equal(own(unknown)[0].collectionMode, null);

  const silent = "consent-silent-client";
  assert.equal((await call(base, silent, {
    privacyAgreed: true, sensitiveInfoAgreed: true,
  })).status, 201);
  assert.equal(own(silent)[0].collectionMode, null);
  assert.equal((await (await call(base, silent)).json()).collectionMode, null);

  // 4. A repeat POST must not rewrite the record. It is the moment of consent
  // that matters, so the stored mode survives even if the client now sends a
  // different one.
  const repeat = await call(base, audio, {
    privacyAgreed: true, sensitiveInfoAgreed: true, collectionMode: "camera",
  });
  assert.equal(repeat.status, 200);
  assert.equal((await repeat.json()).collectionMode, "audio");
  assert.equal(own(audio).length, 1, "a repeat POST appended a second consent record");

  // 5. A record written before the field existed still unlocks the gate; its
  // mode reads back as unknown rather than failing the check.
  const before = "consent-pre-field-owner";
  fs.mkdirSync(path.dirname(consentsFile), { recursive: true });
  fs.appendFileSync(consentsFile, JSON.stringify({
    id: "pre-field", openId: before, policyVersion,
    privacyAgreed: true, sensitiveInfoAgreed: true, acceptedAt: new Date().toISOString(),
  }) + "\n");
  const legacy = await (await call(base, before)).json();
  assert.equal(legacy.agreed, true);
  assert.equal(legacy.collectionMode, null);
});

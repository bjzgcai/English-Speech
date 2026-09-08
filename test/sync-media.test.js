const { listenForTest } = require("../scripts/test-http");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

process.env.NODE_ENV = "test";
process.env.QUEUE_ENABLED = "false";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-sync-media-"));
process.env.SESSION_SECRET = "sync-test-secret";
process.env.INTERNAL_LLM_API_KEY = "test";
process.env.OPENROUTER_API_KEY = "test";
const { app } = require("../src/app");
const { runMedia } = require("../src/processing");

test("non-queue standalone upload keeps its owned MP4 and failure history when scoring fails", async t => {
  const server = await listenForTest(app);
  const originalFetch = global.fetch;
  t.after(async () => {
    global.fetch = originalFetch;
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  });
  global.fetch = async url => String(url).includes("transcriptions")
    ? new Response(JSON.stringify({ text: "I worked with my team to build a useful application." }))
    : new Response("Synthetic scoring failure", { status: 400 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const code = crypto.randomUUID().toUpperCase();
  fs.appendFileSync(path.join(process.env.DATA_DIR, "invitations", "metadata.jsonl"), JSON.stringify({ id: crypto.randomUUID(), hash: crypto.createHash("sha256").update(code).digest("hex") }) + "\n");
  const me = await originalFetch(base + "/api/invitation/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
  assert.equal(me.status, 200);
  const owner = (await me.json()).user.openId;
  const cookie = me.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const headers = { Cookie: cookie, "X-Expected-Owner": owner };
  const consent = await originalFetch(base + "/api/privacy-consent", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ privacyAgreed: true, sensitiveInfoAgreed: true }) });
  assert.equal(consent.status, 201);
  const file = path.join(process.env.DATA_DIR, "fixture.mp4");
  await runMedia(["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=10:duration=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libx264", "-threads:v", "1", "-c:a", "aac", file]);
  const form = new FormData();
  form.append("video", await fs.openAsBlob(file, { type: "video/mp4" }), "test.mp4");
  const response = await originalFetch(base + "/api/evaluate-video", { method: "POST", headers, body: form });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.evaluation.status, "failed");
  const history = await (await originalFetch(base + "/api/recordings", { headers })).json();
  assert.equal(history.recordings.length, 1);
  assert.equal(history.recordings[0].id, result.id);
  const video = await originalFetch(base + history.recordings[0].path, { headers: { ...headers, Range: "bytes=0-15" } });
  assert.equal(video.status, 206);
  await video.arrayBuffer();
});

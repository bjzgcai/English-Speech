const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const data = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-monitor-api-"));
Object.assign(process.env, { NODE_ENV: "test", DATA_DIR: data, QUEUE_ENABLED: "true", SESSION_SECRET: "monitor-test-session",
  DINGTALK_APP_KEY: "synthetic-app", DINGTALK_APP_SECRET: "synthetic-secret", ADMIN_ACCESS_TOKEN: "synthetic-admin-token" });
const { app, testHelpers } = require("../src/app");
const { AlertStore, monitorFile } = require("../src/monitoring");
test("monitor metrics require both DingTalk authentication and administrator token", async t => {
  const server = app.listen(0); await new Promise(resolve => server.once("listening", resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(data, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const cookie = `englisheval_session=${testHelpers.createSessionToken({ openId: "synthetic-admin", name: "Synthetic" })}`;
  assert.equal((await fetch(`${base}/api/admin/monitor`)).status, 401);
  assert.equal((await fetch(`${base}/api/admin/monitor`, { headers: { Cookie: cookie } })).status, 403);
  assert.equal((await fetch(`${base}/api/admin/monitor`, { headers: { Cookie: cookie, "x-admin-access-token": "wrong" } })).status, 403);
  const store = new AlertStore(monitorFile(path.join(data, "recordings"))); store.set("heartbeat", Date.now()); store.close();
  const response = await fetch(`${base}/api/admin/monitor`, { headers: { Cookie: cookie, "x-admin-access-token": process.env.ADMIN_ACCESS_TOKEN } });
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json(); assert.equal(body.stale, false);
  assert.doesNotMatch(JSON.stringify(body), /synthetic-secret|synthetic-admin/);
});

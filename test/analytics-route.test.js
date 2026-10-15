const { listenForTest } = require("../scripts/test-http");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const data = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-analytics-route-"));
Object.assign(process.env, {
  NODE_ENV: "test",
  DATA_DIR: data,
  QUEUE_ENABLED: "false",
  DINGTALK_CLIENT_ID: "test",
  DINGTALK_CLIENT_SECRET: "test",
  DINGTALK_CORP_ID: "test",
  SESSION_SECRET: "analytics-route-test",
  COOKIE_SECURE: "false",
  APP_BASE_URL: "https://english.example.test/",
});
const { app } = require("../src/app");
const config = require("../src/config");

let server, base;
test.before(async () => {
  // The events file is created by the first tracked page view; make it exist
  // up front like production does so the counter can read it.
  fs.writeFileSync(config.analyticsEventsFile, "", { mode: 0o600 });
  server = await listenForTest(app);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(data, { recursive: true, force: true });
});

function events() {
  return fs.readFileSync(config.analyticsEventsFile, "utf8").split("\n").filter(Boolean).length;
}

test("unthrottled beacons are recorded, then the per-address throttle sheds load", async () => {
  const before = events();
  const beacon = body => fetch(base + "/api/analytics/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // A normal page beacon is accepted and recorded.
  const first = await beacon({ event: "examine_enter", page: "/examine" });
  assert.equal(first.status, 204);
  assert.equal(events(), before + 1);

  // Disallowed event names are never recorded, whatever the volume.
  await beacon({ event: "made_up_event", page: "/examine" });
  assert.equal(events(), before + 1);

  // A flood from one address is throttled: the endpoint still answers 204
  // (beacons are fire-and-forget) but stops appending to the fsync'd log.
  const flood = 400;
  for (let index = 0; index < flood; index++) await beacon({ event: "game_enter", page: "/game" });
  const after = events();
  assert.ok(after < before + flood, `the flood was throttled (only ${after - before} of ${flood} appended)`);
  // ...but a meaningful number of ordinary beacons still fit in the budget.
  assert.ok(after - before > 10, `honest traffic before throttling was recorded (${after - before})`);
});

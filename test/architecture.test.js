const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { listenForTest } = require("../scripts/test-http");

const data = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-architecture-"));
Object.assign(process.env, {
  NODE_ENV: "test",
  DATA_DIR: data,
  QUEUE_ENABLED: "false",
  SESSION_SECRET: "architecture-page-test",
  COOKIE_SECURE: "false",
  APP_BASE_URL: "https://english.example.test/",
});

const { app } = require("../src/app");
const config = require("../src/config");

let server;
let base;
test.before(async () => {
  server = await listenForTest(app);
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(data, { recursive: true, force: true });
});

test("the architecture showcase is a public page", async () => {
  const response = await fetch(`${base}/architecture`, { redirect: "manual" });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);

  const html = await response.text();
  assert.match(html, /<title>技术架构 \| OScanner-Eng Architecture<\/title>/);
  assert.match(html, /id="architectureTitle"/);
  assert.match(html, /id="layers"/);
  assert.equal((html.match(/class="layer-row /g) || []).length, 5);
  for (const layer of ["L1", "L2", "L3", "L4", "L5"]) assert.match(html, new RegExp(`>${layer}<`));
  assert.equal((html.match(/role="tab"/g) || []).length, 8);
  assert.equal((html.match(/class="stage-panel"\s/g) || []).length, 8);
  assert.match(html, /id="panel-capture"[\s\S]*?<header class="stage-panel-heading">/);
  assert.match(html, /六维评分/);
});

test("the public architecture source contains no operational identifiers", async () => {
  const html = await (await fetch(`${base}/architecture`)).text();
  const forbidden = [
    /INTERNAL_LLM/i,
    /OPENROUTER/i,
    /OPENAI/i,
    /QWEN/i,
    /DINGTALK_(?:CLIENT|UNIFIED|CORP|APP)/i,
    /PARTNER_API/i,
    /TEACHER_OPEN_IDS/i,
    /CATCHUP_OPEN_IDS/i,
    /openId/,
    /x-acs-dingtalk-access-token/i,
    /(^|[^A-Za-z0-9])\/srv\//i,
    /\.env\b/i,
  ];
  for (const pattern of forbidden) {
    assert.doesNotMatch(html, pattern);
  }
});

test("architecture is linked from Intro only and page views are tracked", async () => {
  const intro = await (await fetch(`${base}/intro`)).text();
  const methodology = await (await fetch(`${base}/methodology`)).text();
  const introHeader = intro.match(/<header class="docs-nav">[\s\S]*?<\/header>/)?.[0] || "";
  assert.match(intro, /href="\/architecture"/);
  assert.doesNotMatch(introHeader, /href="\/architecture"/);
  assert.doesNotMatch(methodology, /href="\/architecture"/);

  const response = await fetch(`${base}/architecture`, {
    headers: { "User-Agent": "Architecture route test" },
  });
  assert.equal(response.status, 200);
  const events = fs.readFileSync(config.analyticsEventsFile, "utf8").trim().split("\n").map(JSON.parse);
  assert.ok(events.some(event => event.event === "page_view" && event.page === "/architecture"));
});

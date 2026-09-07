const { chromium } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const data = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-monitor-browser-"));
Object.assign(process.env, { NODE_ENV: "test", DATA_DIR: data, QUEUE_ENABLED: "true", SESSION_SECRET: "monitor-browser-test",
  DINGTALK_APP_KEY: "synthetic-app", DINGTALK_APP_SECRET: "synthetic-secret", ADMIN_ACCESS_TOKEN: "synthetic-admin-token" });
const { app, testHelpers } = require("../src/app");
const { AlertStore, applySample, monitorFile, MiB } = require("../src/monitoring");
async function main() {
  const server = app.listen(0); await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const store = new AlertStore(monitorFile(path.join(data, "recordings")));
  const sample = { at: Date.now() - 30000, memoryAvailable: 400 * MiB, cpuPercent: 30, disks: [], services: [], errors: [],
    health: { ok: true, latencyMs: 20 }, queue: { outstanding: 50, waiting: 0, workerHeartbeat: Date.now(), circuitUntil: 0 } };
  applySample(store, sample); applySample(store, { ...sample, at: Date.now() });
  store.set("notificationsEnabled", true);
  store.db.prepare("UPDATE events SET status='unknown'").run();
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport });
      await context.addCookies([{ name: "englisheval_session", value: testHelpers.createSessionToken({ openId: "synthetic-monitor-admin", name: "Synthetic Admin" }), url: base }]);
      const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
      await page.route("https://g.alicdn.com/**", route => route.abort());
      await page.goto(base + "/admin");
      await page.locator("#accessToken").fill(process.env.ADMIN_ACCESS_TOKEN);
      await page.locator("#unlockButton").click();
      await page.locator("#monitorAlerts li").waitFor();
      assert.match(await page.locator("#monitorAlerts").innerText(), /Critical/);
      assert.match(await page.locator("#monitorDelivery").innerText(), /unknown/);
      assert.equal(await page.locator("#modelBudgets li").count(), 4);
      await page.locator("#queueSummary").scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(data, `budgets-${viewport.width}.png`) });
      await page.locator("#monitorHeading").scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(data, `monitor-${viewport.width}.png`) });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ screenshots: data, errors }));
  } finally { await browser.close(); store.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

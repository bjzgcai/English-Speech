// Read-only checks against the deployed service. No admissions or submissions are created.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

async function main() {
  const base = process.argv.find(value => value.startsWith("--base="))?.slice(7) || "https://eng.lab.bza.edu.cn";
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-production-smoke-"));
  const errors = [];
  const pages = [];
  const screenshots = [];
  const health = await fetch(base + "/api/health", { signal: AbortSignal.timeout(10000) });
  assert.equal(health.status, 200);
  assert.equal((await health.json()).workerReady, true);
  const auth = await fetch(base + "/auth/dingtalk?redirect=%2Fhistory", { redirect: "manual", signal: AbortSignal.timeout(10000) });
  assert.equal(auth.status, 302);
  assert.equal(new URL(auth.headers.get("location")).hostname, "login.dingtalk.com");
  assert.match(auth.headers.get("set-cookie"), /englisheval_oauth_nonce=.*HttpOnly/);
  assert.equal((await fetch(base + "/auth/dingtalk/callback?code=invalid&state=invalid")).status, 400);
  assert.equal((await fetch(base + "/api/admin/statistics")).status, 401);
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(error.message));
      for (const route of ["/leaderboard", "/game", "/examine", "/history", "/methodology", "/prepare", "/intro", "/privacy", "/api-docs"]) {
        const response = await page.goto(base + route, { waitUntil: "networkidle", timeout: 30000 });
        assert.equal(response.status(), 200, route);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${route} overflows ${viewport.width}`);
        assert.ok((await page.locator("body").innerText()).trim().length > 50, `${route} must render content`);
        const file = path.join(data, `${route.slice(1)}-${viewport.width}.png`);
        await page.screenshot({ path: file }); screenshots.push(file);
        pages.push({ route, width: viewport.width, status: response.status() });
      }
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ base, pages, browserErrors: errors.length, screenshots, authentication: "OAuth redirect, nonce cookie, invalid callback rejection and anonymous admin denial verified; interactive DingTalk approval is not automated." }, null, 2));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

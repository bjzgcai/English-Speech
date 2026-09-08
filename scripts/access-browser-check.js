const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
const { listenForTest } = require("./test-http");

async function main() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-access-"));
  const probe = await listenForTest();
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const service = spawn("npm", ["run", "dev"], {
    detached: true, stdio: "ignore",
    env: { ...process.env, NODE_ENV: "test", DATA_DIR: data, PORT: String(port), SESSION_SECRET: "access-browser-test", DINGTALK_APP_KEY: "", DINGTALK_APP_SECRET: "", DINGTALK_CORP_ID: "", COOKIE_SECURE: "false", QUEUE_ENABLED: "false" },
  });
  let browser;
  const issue = () => {
    const code = crypto.randomUUID().toUpperCase();
    fs.appendFileSync(path.join(data, "invitations/metadata.jsonl"), JSON.stringify({ id: crypto.randomUUID(), hash: crypto.createHash("sha256").update(code).digest("hex") }) + "\n");
    return code;
  };
  try {
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(base + "/api/me")).ok) break; } catch {}
      if (i === 99) throw new Error("Dev server did not start");
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({ headless: true });
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route("https://g.alicdn.com/**", route => route.abort());
      await page.goto(base + "/leaderboard");
      await page.waitForFunction(() => document.querySelector("#leaderboardWeek").options.length > 0);
      assert.equal(await page.locator("#loginPanel").isVisible(), false);
      assert.equal(await page.locator("#leaderboardIdentitySettings").innerText(), "");
      assert.equal(await page.locator("dialog").count(), 0);
      await page.locator("#leaderboardWeek").selectOption({ index: 1 });
      await page.screenshot({ path: `/tmp/englisheval-public-${viewport.width}.png`, fullPage: true });

      await page.goto(base + "/game");
      await page.locator("#generateButton").click();
      await page.locator(".access-dialog").waitFor();
      assert.equal(await page.evaluate(() => state.stream), null);
      await page.locator("#access-code").fill("INVALID");
      await page.locator(".access-submit").click();
      await page.waitForFunction(() => document.querySelector(".access-error").textContent.includes("Invalid"));
      const bounds = await page.locator(".access-dialog").boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width);
      await page.screenshot({ path: `/tmp/englisheval-access-${viewport.width}.png` });
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector("dialog"));
      await page.goto(base + "/examine");
      await page.locator("#role").fill("Researcher");
      await page.locator("#generateButton").click();
      await page.locator("#access-code").fill(issue());
      await page.locator(".access-submit").click();
      await page.waitForFunction(() => VisitorSession.hasAccess && !document.querySelector("dialog"));
      assert.equal(await page.locator("#role").inputValue(), "Researcher");
      assert.equal(new URL(page.url()).pathname, "/examine");
      await page.waitForFunction(() => !document.querySelector("#privacyConsentModal").hidden);
      await page.goto(base + "/history");
      await page.waitForFunction(() => document.querySelector("#historyList").textContent.includes("No saved answers"));
      await context.clearCookies();
      await page.goto(base + "/history");
      await page.locator(".access-dialog").waitFor();
      await page.locator("#access-code").fill(issue());
      await page.locator(".access-submit").click();
      await page.waitForFunction(() => document.querySelector("#historyList").textContent.includes("No saved answers"));

      await context.clearCookies();
      await page.goto(base + "/methodology");
      await page.locator("#evaluationVideo").setInputFiles({ name: "test.mp4", mimeType: "video/mp4", buffer: Buffer.from("test") });
      await page.evaluate(() => { window.submissions = 0; EvaluationQueue.submit = async () => { window.submissions++; throw new Error("Test submission reached"); }; });
      await page.locator("#evaluateVideoButton").click();
      await page.locator(".access-dialog").waitFor();
      assert.equal(await page.evaluate(() => window.submissions), 0);
      const code = issue();
      await page.locator("#access-code").fill(code);
      await page.locator(".access-submit").click();
      await page.waitForFunction(() => window.submissions === 1);
      assert.equal(await page.locator("#evaluationVideo").evaluate(input => input.files[0].name), "test.mp4");
      assert.equal((await fetch(base + "/api/invitation/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) })).status, 400);

      await page.goto(base + "/history");
      await page.waitForFunction(() => document.querySelector("#historyList").textContent.includes("No saved answers"));
      await context.clearCookies();
      await page.evaluate(() => VisitorSession.refresh());
      assert.equal(new URL(page.url()).pathname, "/leaderboard");
      assert.equal(await page.locator("#historyList").innerText(), "");
      await page.locator("#loginButton").click();
      await page.locator(".access-dialog").waitFor();
      await page.keyboard.press("Escape");

      await page.route("**/api/me", route => route.fulfill({ status: 503, json: { error: "Session unavailable" } }));
      await page.goto(base + "/leaderboard");
      await page.waitForFunction(() => document.querySelector("#leaderboardWeek").options.length > 0);
      assert.equal(await page.locator("#leaderboardView").isVisible(), true);
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log("Public access browser checks passed at desktop and mobile sizes.");
  } finally {
    await browser?.close();
    process.kill(-service.pid, "SIGTERM");
    await new Promise(resolve => service.once("exit", resolve));
    fs.rmSync(data, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

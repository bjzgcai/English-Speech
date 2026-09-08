const { listenForTest } = require("./test-http");
const { chromium } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const assert = require("node:assert/strict");
async function main() {
  const root = path.resolve(__dirname, "..");
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-browser-"));
  const probe = await listenForTest();
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, NODE_ENV: "test", DATA_DIR: data, PORT: String(port), QUEUE_ENABLED: "true", SESSION_SECRET: "browser-test", DINGTALK_APP_KEY: "test", DINGTALK_APP_SECRET: "test", DINGTALK_CORP_ID: "test", COOKIE_SECURE: "false", QUEUE_START_PAUSED: "false" };
  const services = ["server.js", "worker.js"].map(file => spawn(process.execPath, [file], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] }));
  let diagnostics = "";
  for (const service of services) { service.stdout.on("data", data => { diagnostics += data; }); service.stderr.on("data", data => { diagnostics += data; }); }
  let browser;
  try {
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(base + "/api/health")).ok) break; } catch {}
      if (i === 99) throw new Error(`Services did not become ready: ${diagnostics}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const token = i => {
      const payload = Buffer.from(JSON.stringify({ user: { openId: `browser-${i}`, name: "Browser Test" }, exp: Date.now() + 3600000 })).toString("base64url");
      return `${payload}.${crypto.createHmac("sha256", env.SESSION_SECRET).update(payload).digest("base64url")}`;
    };
    for (let i = 0; i < 51; i++) {
      const headers = { "X-Expected-Owner": `browser-${i}`, Cookie: `englisheval_session=${token(i)}`, "Content-Type": "application/json" };
      await fetch(base + "/api/privacy-consent", { method: "POST", headers, body: JSON.stringify({ privacyAgreed: true, sensitiveInfoAgreed: true }) });
      if (i < 50) await fetch(base + "/api/admission", { method: "POST", headers });
    }
    browser = await chromium.launch({ headless: true });
    const errors = [];
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport });
      await context.addCookies([{ name: "englisheval_session", value: token(50), url: base }]);
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(error.message));
      await page.route("https://g.alicdn.com/**", route => route.abort());
      await page.goto(base + "/examine");
      await page.locator("#generateButton").click();
      await page.getByText("Waiting to start", { exact: true }).waitFor();
      assert.match(await page.locator(".queue-progress").innerText(), /Position 1/);
      assert.match(await page.locator(".queue-progress").innerText(), /Calculating estimate/);
      await page.screenshot({ path: path.join(data, `waiting-${viewport.width}.png`), fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "Page overflows viewport");
      await page.getByRole("button", { name: "Leave queue", exact: true }).click();
      await page.locator(".queue-progress").waitFor({ state: "hidden" });
      await page.evaluate(() => EvaluationQueue.show({ state: "processing", stage: "scoring", elapsedSeconds: 125, estimatedRemainingSeconds: { low: 70, high: 130 } }));
      assert.match(await page.locator(".queue-progress").innerText(), /About 2 min to 3 min remaining/);
      await page.screenshot({ path: path.join(data, `progress-${viewport.width}.png`), fullPage: true });
      await page.goto(base + "/methodology");
      await page.evaluate(() => EvaluationQueue.show({ state: "draft" }));
      await page.locator(".queue-progress").scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(data, `upload-${viewport.width}.png`) });
      await fetch(base + "/api/admission", { method: "DELETE", headers: { "X-Expected-Owner": `browser-${0}`, Cookie: `englisheval_session=${token(0)}` } });
      await page.route("**/api/evaluate-video", route => route.abort());
      await page.locator("#evaluationVideo").setInputFiles({ name: "pending.mp4", mimeType: "video/mp4", buffer: Buffer.from("synthetic pending upload") });
      await page.locator("#evaluateVideoButton").click();
      await page.getByRole("button", { name: "Resume upload", exact: true }).waitFor();
      await page.reload();
      await page.getByRole("button", { name: "Resume upload", exact: true }).waitFor();
      assert.match(await page.locator(".queue-progress").innerText(), /saved on this device/);
      await page.getByRole("button", { name: "Discard pending upload", exact: true }).click();
      await page.locator(".queue-progress").waitFor({ state: "hidden" });
      await fetch(base + "/api/admission", { method: "POST", headers: { "X-Expected-Owner": `browser-${0}`, Cookie: `englisheval_session=${token(0)}` } });
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ screenshots: data, browserErrors: errors.length, viewports: [1440, 390] }));
  } finally {
    await browser?.close();
    for (const service of services) if (service.exitCode === null && service.signalCode === null) {
      service.kill("SIGTERM");
      const timer = setTimeout(() => service.kill("SIGKILL"), 10000);
      await once(service, "exit"); clearTimeout(timer);
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

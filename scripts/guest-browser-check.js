const { listenForTest } = require("./test-http");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { chromium } = require("playwright");

async function main() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-guest-browser-"));
  const probe = await listenForTest();
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, NODE_ENV: "test", DATA_DIR: data, PORT: String(port), SESSION_SECRET: "guest-browser-secret", DINGTALK_APP_KEY: "", DINGTALK_APP_SECRET: "", DINGTALK_CORP_ID: "", COOKIE_SECURE: "false", QUEUE_ENABLED: "true", QUEUE_START_PAUSED: "false" };
  env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ""} --require=${path.join(__dirname, "../test/fixtures/guest-browser-runtime.cjs")}`;
  const service = spawn("npm", ["run", "dev"], { cwd: path.resolve(__dirname, ".."), env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let diagnostics = "";
  service.stdout.on("data", value => { diagnostics += value; });
  service.stderr.on("data", value => { diagnostics += value; });
  let browser;
  let activePage;
  try {
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(base + "/api/health")).ok) break; } catch {}
      if (i === 99) throw new Error(`Dev services unavailable: ${diagnostics}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({ headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
    const errors = [];
    const screenshots = [];
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport, permissions: ["camera", "microphone"] });
      const page = await context.newPage();
      activePage = page;
      page.on("pageerror", error => errors.push(error.message));
      await page.route("https://g.alicdn.com/**", route => route.abort());
      await page.goto(base + "/game");
      await page.locator("#authUserName").filter({ hasText: /^Guest / }).waitFor({ state: "attached" });
      assert.equal(await page.locator("#loginPanel").isVisible(), false);
      assert.equal(await page.locator("#logoutButton").isVisible(), false);
      assert.equal(await page.locator("#loginButton").isVisible(), true, "Invitation access remains available without DingTalk");
      const invitation = crypto.randomUUID().toUpperCase();
      fs.appendFileSync(path.join(data, "invitations", "metadata.jsonl"), JSON.stringify({ id: crypto.randomUUID(), hash: crypto.createHash("sha256").update(invitation).digest("hex") }) + "\n");
      await page.locator("#loginButton").click();
      await page.locator("#access-code").fill(invitation);
      await page.locator(".access-submit").click();
      await page.waitForFunction(() => VisitorSession.hasAccess && !document.querySelector("dialog"));
      const guestOwner = await page.evaluate(() => VisitorSession.user.openId);
      assert.match(guestOwner, /^guest:/);
      const timeoutFallback = await page.evaluate(async () => {
        window.dd = { env: { platform: "android" }, runtime: { permission: { requestAuthCode() {} } } };
        state.inAppAuthAttempted = false;
        const started = performance.now();
        const result = await tryDingTalkInAppAuth({ configured: true, corpId: "test-corp" });
        return { result, elapsed: performance.now() - started, type: VisitorSession.user.identityType };
      });
      assert.equal(timeoutFallback.result, false);
      assert.equal(timeoutFallback.type, "guest");
      assert.ok(timeoutFallback.elapsed < 6000);
      await page.reload();
      await page.waitForFunction(owner => VisitorSession.user?.openId === owner, guestOwner);
      await page.locator("#generateButton").click();
      await page.locator("#privacyConsentModal").waitFor({ state: "visible" });
      await page.locator("#privacyPolicyAgree").check();
      await page.locator("#sensitiveInfoAgree").check();
      await page.locator("#acceptPrivacyButton").click();
      await page.waitForFunction(() => Boolean(state.question?.id));
      await page.screenshot({ path: path.join(data, `guest-game-${viewport.width}.png`), fullPage: true });
      screenshots.push(path.join(data, `guest-game-${viewport.width}.png`));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const payload = Buffer.from(JSON.stringify({ user: { openId: `browser-dingtalk-${viewport.width}`, name: "DingTalk Test" }, exp: Date.now() + 3600000 })).toString("base64url");
      const token = `${payload}.${crypto.createHmac("sha256", env.SESSION_SECRET).update(payload).digest("base64url")}`;
      await page.locator("#speakDirectlyButton").click();
      await page.waitForFunction(() => state.recorder?.state === "recording");
      await context.addCookies([{ name: "englisheval_session", value: token, url: base }]);
      await page.evaluate(() => VisitorSession.announce());
      await page.waitForFunction(async owner => {
        const db = await new Promise(resolve => {
          const request = indexedDB.open("englisheval-pending", 1);
          request.onsuccess = () => resolve(request.result);
        });
        const saved = await new Promise(resolve => {
          const request = db.transaction("recordings").objectStore("recordings").get(owner);
          request.onsuccess = () => resolve(request.result);
        });
        db.close();
        return saved?.owner === owner && saved.blob?.size > 0;
      }, guestOwner);
      await page.locator("#logoutButton").click();
      await page.getByRole("button", { name: "Resume upload", exact: true }).waitFor();
      await page.getByRole("button", { name: "Discard pending upload", exact: true }).click();
      await page.locator(".queue-progress").waitFor({ state: "hidden" });
      await page.goto(base + "/methodology");
      await page.waitForFunction(() => Boolean(VisitorSession.user));
      await page.route("**/api/evaluate-video", route => route.abort());
      await page.locator("#evaluationVideo").setInputFiles({ name: "guest-draft.mp4", mimeType: "video/mp4", buffer: Buffer.from("local browser upload draft") });
      await page.locator("#evaluateVideoButton").click();
      await page.getByRole("button", { name: "Resume upload", exact: true }).waitFor();
      await page.reload();
      await page.getByRole("button", { name: "Resume upload", exact: true }).waitFor();
      await context.addCookies([{ name: "englisheval_session", value: token, url: base }]);
      await page.evaluate(() => VisitorSession.announce());
      await page.locator("[data-auth-user-name]").filter({ hasText: "DingTalk Test" }).waitFor({ state: "attached" });
      await page.locator(".queue-progress").waitFor({ state: "hidden" });
      await page.unroute("**/api/evaluate-video");
      const stale = await page.evaluate(async expected => {
        const response = await fetch("/api/evaluate-video", { method: "POST", headers: { "X-Expected-Owner": expected } });
        return { status: response.status, body: await response.json() };
      }, guestOwner);
      assert.equal(stale.status, 409);
      assert.equal(stale.body.code, "IDENTITY_CHANGED");
      await page.locator("[data-logout-button]").click();
      await page.waitForFunction(owner => VisitorSession.user?.openId === owner, guestOwner);
      await page.getByRole("button", { name: "Resume upload", exact: true }).waitFor();
      await page.screenshot({ path: path.join(data, `guest-restored-${viewport.width}.png`), fullPage: true });
      screenshots.push(path.join(data, `guest-restored-${viewport.width}.png`));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ screenshots, browserErrors: errors.length }));
  } catch (error) {
    if (activePage && !activePage.isClosed()) {
      await activePage.screenshot({ path: path.join(data, "failure.png"), fullPage: true });
      console.error(await activePage.locator("main").innerText());
      console.error(`Browser diagnostics: ${path.join(data, "failure.png")}`);
    }
    throw error;
  } finally {
    await browser?.close();
    try { process.kill(-service.pid, "SIGTERM"); } catch {}
    if (service.exitCode === null && service.signalCode === null) await once(service, "exit");
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { chromium, devices } = require("playwright");
const { listenForTest } = require("./test-http");

async function main() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-mobile-"));
  const findings = [];
  const errors = [];
  const screenshots = [];
  const question = "Describe a time when you worked with people who had different opinions. How did you help the team reach a decision, what did you learn from the experience, and what would you do differently next time?";
  const score = { summary: "Clear response with specific evidence.", hasScorableEnglishSpeech: true, improvedAnswer: "We listened to each other and tested our ideas together.", strengths: ["Clear structure"], improvements: ["Add specific examples"], rubric: Object.fromEntries(["pronunciation", "fluency", "grammar", "vocabulary", "coherence", "visualDelivery"].map(key => [key, { score: 80, feedback: "Clear and understandable." }])) };
  const upstream = http.createServer(async (req, res) => {
    req.resume();
    await once(req, "end");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(req.url === "/asr"
      ? { text: "We worked together to build an application. I listened to my colleagues and tested our solution. The project helped me improve my communication skills." }
      : { choices: [{ message: { content: JSON.stringify(req.url === "/question" ? { question, focus: "Communication", expectedDurationSeconds: 120 } : score) } }] }));
  });
  await listenForTest(upstream);
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
  const probe = await listenForTest();
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, NODE_ENV: "test", DATA_DIR: data, PORT: String(port), SESSION_SECRET: "mobile-browser-test", DINGTALK_APP_KEY: "", DINGTALK_APP_SECRET: "", DINGTALK_CORP_ID: "", COOKIE_SECURE: "false", QUEUE_ENABLED: "true", QUEUE_START_PAUSED: "false", INTERNAL_LLM_API_KEY: "test", OPENROUTER_API_KEY: "test", INTERNAL_LLM_CHAT_COMPLETIONS_URL: `${upstreamUrl}/question`, INTERNAL_LLM_TRANSCRIPTIONS_URL: `${upstreamUrl}/asr`, OPENROUTER_CHAT_COMPLETIONS_URL: `${upstreamUrl}/score`, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --require=${path.join(__dirname, "../test/fixtures/guest-browser-runtime.cjs")}` };
  const service = spawn("npm", ["run", "dev"], { cwd: path.resolve(__dirname, ".."), env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let diagnostics = "";
  service.stdout.on("data", value => { diagnostics = (diagnostics + value).slice(-4000); });
  service.stderr.on("data", value => { diagnostics = (diagnostics + value).slice(-4000); });
  let browser;
  let page;
  try {
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(base + "/api/health")).ok) break; } catch {}
      if (i === 99) throw new Error(`Dev services unavailable: ${diagnostics}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
    console.log(`Chrome ${browser.version()}; artifacts: ${data}`);
    const viewports = [
      { width: 320, height: 568 }, { width: 360, height: 640 },
      { width: 390, height: 844 }, { width: 430, height: 932 },
      { width: 540, height: 720 }, { width: 568, height: 320 },
      { width: 844, height: 390 },
      { width: 1024, height: 768 },
    ];
    const selectedViewport = process.argv.find(arg => arg.startsWith("--viewport="))?.split("=")[1];
    for (const viewport of viewports.filter(size => !selectedViewport || `${size.width}x${size.height}` === selectedViewport)) {
      const context = await browser.newContext({ ...devices["Pixel 7"], viewport, screen: viewport, permissions: ["camera", "microphone"], deviceScaleFactor: 1 });
      page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on("pageerror", error => errors.push(error.message));
      await page.route("https://g.alicdn.com/**", route => route.abort());
      const capture = async (name, critical = []) => {
        const label = `${name}-${viewport.width}x${viewport.height}`;
        const issues = await page.evaluate(({ selectors, viewport }) => {
          const issues = [];
          const visible = el => el.checkVisibility() && el.getBoundingClientRect().width > 0;
          if (document.documentElement.scrollWidth > viewport.width + 1) issues.push("Page overflows horizontally");
          for (const el of document.querySelectorAll(".prepare-dialog, .privacy-consent-dialog, .discard-dialog, .access-dialog")) {
            if (!visible(el)) continue;
            const rect = el.getBoundingClientRect();
            if (rect.top < -1 || rect.bottom > viewport.height + 1 || rect.left < -1 || rect.right > viewport.width + 1) issues.push(`${el.className}: outside viewport`);
            if (el.scrollWidth > el.clientWidth + 1) issues.push(`${el.className}: horizontal overflow`);
          }
          for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (!el || !visible(el)) { issues.push(`${selector}: hidden`); continue; }
            const r = el.getBoundingClientRect();
            if (r.top < 0 || r.bottom > viewport.height || r.left < 0 || r.right > viewport.width) issues.push(`${selector}: off screen`);
            if (el.matches("button") && (r.height < 44 || r.width < 44)) issues.push(`${selector}: touch target smaller than 44px`);
            const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            if (top && !el.contains(top)) issues.push(`${selector}: covered by another element`);
          }
          if (document.querySelector(".recorder-panel.is-recording") && document.querySelector("#discardModal").hidden) {
            const video = document.querySelector(".video-frame").getBoundingClientRect();
            const controls = document.querySelector(".control-row").getBoundingClientRect();
            if (Math.min(video.right, controls.right) > Math.max(video.left, controls.left) && Math.min(video.bottom, controls.bottom) > Math.max(video.top, controls.top)) issues.push("Recording controls overlap the camera preview");
          }
          return issues;
        }, { selectors: critical, viewport });
        findings.push(...issues.map(issue => `${label}: ${issue}`));
        if (issues.length) console.log(label, issues, await page.evaluate(() => ({ width: innerWidth, height: innerHeight, coarse: matchMedia("(pointer: coarse)").matches, short: matchMedia("(max-height: 500px)").matches, dialog: document.querySelector(".prepare-dialog") && getComputedStyle(document.querySelector(".prepare-dialog")).display })));
        const file = path.join(data, `${label}.png`);
        await page.screenshot({ path: file, fullPage: !await page.locator("body").evaluate(body => body.classList.contains("modal-open")) });
        screenshots.push(file);
      };
      await page.goto(base + "/examine");
      await page.waitForFunction(() => Boolean(VisitorSession.user));
      await capture("examine");
      await page.locator("#generateButton").tap();
      await page.locator(".access-dialog").waitFor({ state: "visible" });
      await capture("access", [".access-close", ".access-submit"]);
      const invitation = crypto.randomUUID().toUpperCase();
      fs.appendFileSync(path.join(data, "invitations", "metadata.jsonl"), JSON.stringify({ id: crypto.randomUUID(), hash: crypto.createHash("sha256").update(invitation).digest("hex") }) + "\n");
      await page.locator("#access-code").fill(invitation);
      await page.locator(".access-submit").tap();
      await page.locator("#privacyConsentModal").waitFor({ state: "visible" });
      await capture("privacy-consent");
      await page.locator("#privacyPolicyAgree").check();
      assert.equal(await page.locator("#acceptPrivacyButton").isEnabled(), false);
      await page.locator("#sensitiveInfoAgree").check();
      await page.locator("#acceptPrivacyButton").tap();
      for (const mode of ["examine", "game"]) {
        if (mode === "game") {
          await page.goto(base + "/game");
          await capture("game");
          await page.locator("#generateButton").tap();
        }
        await page.locator("#speakDirectlyButton").waitFor({ state: "visible" });
        await page.waitForFunction(() => document.querySelector("#preparePreview").readyState >= 2);
        assert.equal(await page.locator(".prepare-content").evaluate(el => el.scrollTop), 0);
        await capture(`${mode}-prepare`, ["#countdownDisplay", "#speakDirectlyButton"]);
        await page.locator("#prepareGuidanceMessage").scrollIntoViewIfNeeded();
        await capture(`${mode}-prepare-scrolled`, ["#countdownDisplay", "#speakDirectlyButton", "#prepareGuidanceMessage"]);
        await page.locator("#speakDirectlyButton").tap();
        await page.waitForFunction(() => state.recorder?.state === "recording");
        await page.waitForFunction(() => document.querySelector("#recordingElapsed").textContent >= "00:02");
        await capture(`${mode}-recording`, ["#recordingBadge", "#finishButton", "#discardButton"]);
        await page.locator("#questionBlock").evaluate(el => { el.scrollTop = el.scrollHeight; });
        await capture(`${mode}-recording-scrolled`, ["#recordingBadge", "#finishButton", "#discardButton"]);
        const colors = await page.locator("#preview").evaluate(video => {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 32;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(video, 0, 0, 32, 32);
          return new Set(ctx.getImageData(0, 0, 32, 32).data).size;
        });
        assert.ok(colors > 8, "Camera preview must contain rendered video pixels");
        await page.locator("#discardButton").tap();
        await capture(`${mode}-discard`, ["#keepAnswerButton", "#confirmDiscardButton"]);
        await page.locator("#keepAnswerButton").tap();
        assert.equal(await page.evaluate(() => state.recorder.state), "recording");
        if (viewport.width === 390) {
          await page.locator("#finishButton").tap();
          await page.locator("#evaluationResult .share-evaluation").waitFor({ state: "visible", timeout: 60000 });
          await capture(`${mode}-result`);
        } else {
          await page.locator("#discardButton").tap();
          await page.locator("#confirmDiscardButton").tap();
          await page.locator("#prepareModal").waitFor({ state: "hidden" });
        }
      }
      await page.goto(base + "/game");
      await page.waitForFunction(() => Boolean(VisitorSession.user));
      await page.evaluate(() => {
        navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("Synthetic permission denial", "NotAllowedError"); };
      });
      await page.locator("#generateButton").tap();
      await page.locator("#speakDirectlyButton").filter({ hasText: "Try camera and microphone again" }).waitFor();
      await capture("camera-permission", ["#speakDirectlyButton"]);
      for (const route of ["/leaderboard", "/history", "/methodology", "/prepare", "/intro", "/privacy", "/api-docs"]) {
        assert.equal((await page.goto(base + route)).status(), 200);
        await capture(route.slice(1));
      }
      console.log(`Checked ${viewport.width}x${viewport.height}`);
      await context.close();
    }
    fs.writeFileSync(path.join(data, "report.json"), JSON.stringify({ findings, errors, screenshots }, null, 2));
    console.log(JSON.stringify({ data, findings, errors, screenshotCount: screenshots.length }, null, 2));
    assert.deepEqual(errors, []);
    if (!process.argv.includes("--audit")) assert.deepEqual(findings, []);
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(data, "failure.png") }).catch(() => {});
    console.error(`Artifacts: ${data}`);
    throw error;
  } finally {
    await browser?.close();
    try { process.kill(-service.pid, "SIGTERM"); } catch {}
    if (service.exitCode === null && service.signalCode === null) await once(service, "exit");
    await new Promise(resolve => upstream.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

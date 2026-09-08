const { listenForTest } = require("./test-http");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { chromium } = require("playwright");
const { runMedia } = require("../src/processing");

async function main() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-full-browser-"));
  const screenshots = [];
  const errors = [];
  const calls = { question: 0, asr: 0, scoring: 0 };
  const score = { summary: "Clear response with specific evidence.", hasScorableEnglishSpeech: true, improvedAnswer: "We worked together to build and test a useful application.", strengths: ["Clear structure"], improvements: ["Add specific examples"], rubric: Object.fromEntries(["pronunciation", "fluency", "grammar", "vocabulary", "coherence", "visualDelivery"].map(key => [key, { score: 80, feedback: "Clear and understandable." }])) };
  const upstream = http.createServer(async (req, res) => {
    req.resume();
    await once(req, "end");
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/asr") {
      calls.asr++;
      return res.end(JSON.stringify({ text: "We worked together to build an application. I listened to my colleagues and tested our solution. The project helped me improve my communication skills." }));
    }
    const question = req.url === "/question";
    calls[question ? "question" : "scoring"]++;
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(question ? { question: "Describe a project where you solved a problem with your team.", focus: "Communication", expectedDurationSeconds: 120, followUp: "What did you learn?" } : score) } }] }));
  });
  await listenForTest(upstream);
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
  const probe = await listenForTest();
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, NODE_ENV: "test", DATA_DIR: data, HOST: "127.0.0.1", PORT: String(port), SESSION_SECRET: "full-browser-secret", DINGTALK_APP_KEY: "", DINGTALK_APP_SECRET: "", DINGTALK_CORP_ID: "", COOKIE_SECURE: "false", QUEUE_ENABLED: "true", QUEUE_START_PAUSED: "false", INTERNAL_LLM_API_KEY: "test", OPENROUTER_API_KEY: "test", INTERNAL_LLM_CHAT_COMPLETIONS_URL: `${upstreamUrl}/question`, INTERNAL_LLM_TRANSCRIPTIONS_URL: `${upstreamUrl}/asr`, OPENROUTER_CHAT_COMPLETIONS_URL: `${upstreamUrl}/score`, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --require=${path.join(__dirname, "../test/fixtures/guest-browser-runtime.cjs")}` };
  const service = spawn("npm", ["run", "dev"], { cwd: path.resolve(__dirname, ".."), env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let diagnostics = "";
  service.stdout.on("data", value => { diagnostics = (diagnostics + value).slice(-4000); });
  service.stderr.on("data", value => { diagnostics = (diagnostics + value).slice(-4000); });
  let browser;
  let activePage;
  try {
    const fixture = path.join(data, "spoken-test.mp4");
    await runMedia(["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24:duration=3", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:v", "libx264", "-preset", "veryfast", "-threads:v", "1", "-c:a", "aac", fixture]);
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(base + "/api/health")).ok) break; } catch {}
      if (i === 99) throw new Error(`Dev services unavailable: ${diagnostics}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({ headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport, permissions: ["camera", "microphone"], acceptDownloads: true });
      const page = await context.newPage(); activePage = page;
      page.setDefaultTimeout(20000);
      page.on("pageerror", error => errors.push(error.message));
      await page.route("https://g.alicdn.com/**", route => route.abort());
      const capture = async name => {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} overflows ${viewport.width}`);
        const file = path.join(data, `${name}-${viewport.width}.png`);
        await page.screenshot({ path: file, fullPage: true }); screenshots.push(file);
      };
      await page.goto(base + "/examine");
      await page.waitForFunction(() => Boolean(VisitorSession.user));
      const invitation = crypto.randomUUID().toUpperCase();
      fs.appendFileSync(path.join(data, "invitations", "metadata.jsonl"), JSON.stringify({ id: crypto.randomUUID(), hash: crypto.createHash("sha256").update(invitation).digest("hex") }) + "\n");
      await page.locator("#role").fill("Software engineering and team communication");
      await page.locator("#generateButton").click();
      await page.locator("#access-code").fill(invitation);
      await page.locator(".access-submit").click();
      await page.locator("#privacyConsentModal").waitFor({ state: "visible" });
      await page.locator("#privacyPolicyAgree").check();
      assert.equal(await page.locator("#acceptPrivacyButton").isEnabled(), false);
      await page.locator("#sensitiveInfoAgree").check();
      await page.locator("#acceptPrivacyButton").click();
      await page.locator("#speakDirectlyButton").waitFor({ state: "visible" });
      await capture("question-prepare");
      await page.locator("#speakDirectlyButton").click();
      await page.waitForFunction(() => state.recorder?.state === "recording");
      await page.waitForFunction(() => document.querySelector("#recordingElapsed").textContent >= "00:03");
      await capture("recording");
      await page.locator("#finishButton").click();
      await page.locator("#evaluationResult .share-evaluation").waitFor({ state: "visible", timeout: 60000 });
      assert.match(await page.locator("#evaluationResult").innerText(), /80/);
      await page.locator("#experienceRatingPrompt").waitFor({ state: "visible" });
      await page.locator('[data-rating-score="5"]').click();
      await page.locator("#submitExperienceRating").click();
      await page.locator("[data-rating-thanks]").waitFor({ state: "visible" });
      const downloaded = page.waitForEvent("download");
      await page.locator("#evaluationResult .share-evaluation").click();
      const download = await downloaded;
      const imageFile = path.join(data, `share-${viewport.width}.png`);
      await download.saveAs(imageFile);
      assert.ok(fs.statSync(imageFile).size > 1000);
      screenshots.push(imageFile);
      await capture("evaluation");
      await page.goto(base + "/history");
      await page.locator(".video-link").first().click();
      await page.waitForFunction(() => document.querySelector("#historyVideo").readyState >= 2);
      await page.locator("#historyVideo").evaluate(video => video.play());
      await page.waitForFunction(() => document.querySelector("#historyVideo").currentTime > 0);
      await page.locator("#closeVideoModal").click();
      await capture("history");
      await page.goto(base + "/game");
      await page.locator("#generateButton").click();
      await page.locator("#speakDirectlyButton").click();
      await page.waitForFunction(() => state.recorder?.state === "recording");
      if (process.argv.includes("--full-duration") && viewport.width === 1440) {
        await page.waitForFunction(() => state.recorder?.state !== "recording", null, { timeout: 150000 });
      } else {
        await page.waitForFunction(() => document.querySelector("#recordingElapsed").textContent >= "00:03");
        await page.locator("#finishButton").click();
      }
      await page.locator("#evaluationResult .share-evaluation").waitFor({ state: "visible", timeout: 60000 });
      await page.goto(base + "/leaderboard");
      await page.locator("#leaderboardList").getByText("80", { exact: true }).first().waitFor();
      await capture("leaderboard");
      await page.goto(base + "/methodology");
      await page.waitForFunction(() => Boolean(VisitorSession.user));
      await page.locator("#evaluationVideo").setInputFiles(fixture);
      await page.locator("#evaluateVideoButton").click();
      await page.locator("#videoEvaluationResult .share-evaluation").waitFor({ state: "visible", timeout: 60000 });
      await capture("standalone");
      await page.locator("[data-comment-input]").fill(`Synthetic browser validation ${viewport.width}`);
      await page.locator("[data-comment-submit]").click();
      await page.locator("[data-comment-list]").getByText(`Synthetic browser validation ${viewport.width}`, { exact: true }).waitFor();
      await page.reload();
      await page.locator("[data-comment-list]").getByText(`Synthetic browser validation ${viewport.width}`, { exact: true }).waitFor();
      for (const route of ["/intro", "/prepare", "/privacy", "/api-docs"]) {
        assert.equal((await page.goto(base + route)).status(), 200);
        await capture(route.slice(1));
      }
      await page.goto(base + "/history");
      await page.waitForFunction(() => document.querySelectorAll(".history-collapse").length === 3);
      assert.equal(await page.locator(".history-collapse").count(), 3);
      for (const kind of ["audio", "video"]) {
        await page.goto(base + "/game");
        await page.locator("#generateButton").click();
        await page.locator("#speakDirectlyButton").click();
        await page.waitForFunction(() => state.recorder?.state === "recording");
        await page.evaluate(kind => { state.stream.getTracks().find(track => track.kind === kind).enabled = false; }, kind);
        await page.locator("#finishButton").click();
        await page.locator("#prepareModalTitle").filter({ hasText: "Turn on your camera and microphone" }).waitFor();
        assert.match(await page.locator("#saveResult").textContent(), /incomplete recording was not saved/);
        const count = await page.evaluate(async () => (await (await VisitorSession.fetch("/api/recordings")).json()).recordings.length);
        assert.equal(count, 3, "Interrupted device tracks must not produce saved answers");
      }
      const stranger = await browser.newContext();
      const otherPage = await stranger.newPage();
      await otherPage.goto(base + "/history");
      await otherPage.waitForFunction(() => Boolean(VisitorSession.user));
      assert.equal(await otherPage.locator(".history-collapse").count(), 0);
      await stranger.close();
      await context.close();

      const signed = await browser.newContext({ viewport });
      const payload = Buffer.from(JSON.stringify({ user: { openId: `synthetic-browser-member-${viewport.width}`, name: "Synthetic Member" }, exp: Date.now() + 3600000 })).toString("base64url");
      const token = `${payload}.${crypto.createHmac("sha256", env.SESSION_SECRET).update(payload).digest("base64url")}`;
      await signed.addCookies([{ name: "englisheval_session", value: token, url: base }]);
      const member = await signed.newPage(); activePage = member;
      member.on("pageerror", error => errors.push(error.message));
      await member.route("https://g.alicdn.com/**", route => route.abort());
      await member.goto(base + "/leaderboard");
      await member.locator("#leaderboardAlias-leaderboard").fill(`Browser Test ${viewport.width}`);
      await member.locator("#useLeaderboardAlias-leaderboard").check();
      await member.locator(".identity-save").click();
      await member.locator("[data-identity-display]").filter({ hasText: `Browser Test ${viewport.width}` }).waitFor();
      await member.reload();
      await member.locator("[data-identity-display]").filter({ hasText: `Browser Test ${viewport.width}` }).waitFor();
      await member.goto(base + "/methodology");
      await member.locator("#evaluationVideo").setInputFiles(fixture);
      await member.locator("#publiclyShareVideo").check();
      await member.locator("#evaluateVideoButton").click();
      await member.locator(".queue-consent").waitFor({ state: "visible" });
      for (const checkbox of await member.locator('.queue-consent input[type="checkbox"]').all()) await checkbox.check();
      await member.getByRole("button", { name: "Accept and continue", exact: true }).click();
      await member.locator("#videoEvaluationResult .share-evaluation").waitFor({ state: "visible", timeout: 60000 });
      await member.locator(".evaluation-card-poster[data-evaluation-id]").first().click();
      await member.waitForFunction(() => document.querySelector("#evaluationModalVideo").readyState >= 2);
      const galleryImage = path.join(data, `gallery-${viewport.width}.png`);
      await member.screenshot({ path: galleryImage, fullPage: true }); screenshots.push(galleryImage);
      assert.equal(await member.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await member.locator("#closeEvaluationModal").click();
      await signed.close();
    }
    assert.deepEqual(errors, []);
    assert.ok(calls.question >= 2 && calls.asr >= 6 && calls.scoring >= 6);
    console.log(JSON.stringify({ dataDirectory: data, screenshots, browserErrors: errors.length, calls }, null, 2));
  } catch (error) {
    if (activePage && !activePage.isClosed()) {
      await activePage.screenshot({ path: path.join(data, "failure.png"), fullPage: true });
      console.error(`Browser diagnostics: ${path.join(data, "failure.png")}`);
      console.error(await activePage.locator("body").innerText());
    }
    throw error;
  } finally {
    await browser?.close();
    try { process.kill(-service.pid, "SIGTERM"); } catch {}
    if (service.exitCode === null && service.signalCode === null) await once(service, "exit");
    await new Promise(resolve => upstream.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

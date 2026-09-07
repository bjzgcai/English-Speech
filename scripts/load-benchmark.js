#!/usr/bin/env node
// Every run uses temporary data, synthetic identities, and isolated web/worker processes.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const { Queue } = require("../src/queue");
const root = path.resolve(__dirname, "..");
const arg = (key, fallback) => process.argv.find(value => value.startsWith(`--${key}=`))?.split("=").slice(1).join("=") || fallback;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const p95 = values => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * 0.95) - 1)] || 0;
async function main() {
  const users = Number(arg("users", 10));
  const arrivals = Number(arg("arrivals", users));
  const duration = Number(arg("duration", 2));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-load-"));
  const children = [];
  const peaks = { transcription: 0, scoring: 0 };
  const running = { transcription: 0, scoring: 0 };
  let server;
  let worker;
  let queue;
  let upstream;
  const latencies = [];
  const uploadMs = [];
  const acknowledgementMs = [];
  const started = Date.now();
  const fixture = arg("fixture", path.join(data, "fixture.mp4"));
  const failScoring = process.argv.includes("--fail-scoring");
  const invalidMedia = process.argv.includes("--invalid-media");
  const guests = process.argv.includes("--guests");
  const expectedState = failScoring || invalidMedia ? "failed" : "completed";
  try {
    if (invalidMedia) fs.writeFileSync(fixture, "Synthetic invalid media fixture");
    if (!fs.existsSync(fixture)) {
      const generated = spawnSync(require("ffmpeg-static"), ["-v", "error", "-threads", "1", "-filter_threads", "1", "-f", "lavfi", "-i", `testsrc2=size=640x360:rate=24:duration=${duration}`, "-f", "lavfi", "-i", `sine=frequency=440:duration=${duration}`, "-c:v", "libx264", "-preset", "ultrafast", "-threads", "1", "-c:a", "aac", "-shortest", fixture], { timeout: 120000 });
      assert.equal(generated.status, 0, generated.stderr?.toString());
    }
    upstream = http.createServer(async (req, res) => {
      req.resume();
      await once(req, "end");
      const kind = req.url === "/asr" ? "transcription" : "scoring";
      running[kind]++; peaks[kind] = Math.max(peaks[kind], running[kind]);
      await sleep(Number(arg("model-delay", 100)));
      running[kind]--;
      res.setHeader("Content-Type", "application/json");
      if (kind === "transcription") return res.end(JSON.stringify({ text: "I worked with my team to solve a difficult problem. We discussed several approaches and tested our solution carefully. The project helped me improve my communication and technical skills." }));
      if (failScoring) { res.statusCode = 400; return res.end(JSON.stringify({ error: "Synthetic scoring failure" })); }
      res.end(JSON.stringify({ model: "test-model", usage: { prompt_tokens: 1000, completion_tokens: 250 }, choices: [{ message: { content: JSON.stringify({ summary: "Clear response.", hasScorableEnglishSpeech: true, improvedAnswer: "I worked with my team to solve a difficult problem.", strengths: ["Clear"], improvements: ["Add detail"], rubric: Object.fromEntries(["pronunciation", "fluency", "grammar", "vocabulary", "coherence", "visualDelivery"].map(key => [key, { score: 80, feedback: "Clear." }])) }) } }] }));
    });
    upstream.listen(0, "127.0.0.1"); await once(upstream, "listening");
    const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
    const probe = http.createServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening");
    const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
    const real = process.argv.includes("--real-upstreams");
    let upstreamEnv = {};
    if (real) {
      const dotenv = require("dotenv");
      for (const file of [".env", ".env.prod"]) if (fs.existsSync(path.join(root, file))) Object.assign(upstreamEnv, dotenv.parse(fs.readFileSync(path.join(root, file))));
    }
    const env = { ...process.env, ...upstreamEnv, NODE_ENV: "test", DATA_DIR: data, PORT: String(port), QUEUE_ENABLED: "true", QUEUE_START_PAUSED: "false", SESSION_SECRET: "isolated-load-test-secret", DINGTALK_APP_KEY: "test", DINGTALK_APP_SECRET: "test", DINGTALK_CORP_ID: "test", COOKIE_SECURE: "false", ...(real ? {} : { INTERNAL_LLM_API_KEY: "test", OPENROUTER_API_KEY: "test", INTERNAL_LLM_TRANSCRIPTIONS_URL: `${upstreamUrl}/asr`, OPENROUTER_CHAT_COMPLETIONS_URL: `${upstreamUrl}/score` }) };
    if (guests) Object.assign(env, { DINGTALK_APP_KEY: "", DINGTALK_APP_SECRET: "", DINGTALK_CORP_ID: "" });
    const launch = name => {
      const child = spawn(process.execPath, [path.join(root, name)], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
      child.diagnostics = "";
      child.stdout.on("data", chunk => { child.diagnostics = (child.diagnostics + chunk).slice(-4000); });
      child.stderr.on("data", chunk => { child.diagnostics = (child.diagnostics + chunk).slice(-4000); });
      children.push(child); return child;
    };
    server = launch("server.js"); worker = launch("worker.js");
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
      if (i === 99) throw new Error(`Services did not become ready: ${server.diagnostics} ${worker.diagnostics}`);
      await sleep(100);
    }
    const visitors = new Map();
    if (guests) {
      for (const index of Array.from({ length: arrivals }, (_, i) => [i, i + 1000]).flat()) {
        const response = await fetch(base + "/api/me");
        assert.equal(response.status, 200);
        const data = await response.json();
        assert.equal(data.identityType, "guest");
        visitors.set(index, { owner: data.user.openId, cookie: response.headers.get("set-cookie").split(";")[0] });
      }
    }
    const expectedOwner = index => guests ? visitors.get(index).owner : `load-${index}`;
    const cookie = index => {
      if (guests) return visitors.get(index).cookie;
      const payload = Buffer.from(JSON.stringify({ user: { openId: `load-${index}`, name: "Synthetic load participant" }, exp: Date.now() + 3600000 })).toString("base64url");
      return `englisheval_session=${payload}.${crypto.createHmac("sha256", env.SESSION_SECRET).update(payload).digest("base64url")}`;
    };
    const call = async (index, route, body, extra = {}) => {
      const start = performance.now();
      const response = await fetch(base + route, { headers: { "X-Expected-Owner": expectedOwner(index), Cookie: cookie(index), "Content-Type": "application/json", ...extra.headers }, method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body) });
      latencies.push(performance.now() - start);
      return { status: response.status, data: await response.json() };
    };
    await Promise.all(Array.from({ length: arrivals }, (_, i) => call(i, "/api/privacy-consent", { privacyAgreed: true, sensitiveInfoAgreed: true })));
    const admissions = await Promise.all(Array.from({ length: arrivals }, (_, i) => call(i, "/api/admission", {})));
    assert.equal(admissions.filter(r => r.data.admission?.state === "admitted").length, Math.min(arrivals, 50));
    const admitted = admissions.map((r, i) => ({ ...r, i })).filter(r => r.data.admission?.state === "admitted").slice(0, users);
    const jobs = await Promise.all(admitted.map(async ({ i }) => {
      const question = await call(i, real ? "/api/generate-question" : "/api/game/question", real ? { profile: { role: "Software engineering" } } : {});
      assert.ok([200, 201].includes(question.status), JSON.stringify(question.data));
      let grant;
      while (!grant) {
        const result = await call(i, "/api/admission/upload-grant", {});
        if (result.status === 200) grant = result.data.grant;
        else { assert.equal(result.status, 429); await sleep(100 + Math.random() * 100); }
      }
      const id = crypto.randomUUID();
      const form = new FormData();
      form.append("video", await fs.openAsBlob(fixture, { type: "video/mp4" }), "synthetic.mp4");
      form.append("questionId", question.data.question.id);
      form.append("submissionId", id);
      const start = performance.now();
      const response = await fetch(`${base}/api/save-answer`, { method: "POST", headers: { "X-Expected-Owner": expectedOwner(i), Cookie: cookie(i), "X-Submission-Id": id, "X-Question-Id": question.data.question.id, "X-Upload-Grant": grant }, body: form });
      uploadMs.push(performance.now() - start);
      const timing = response.headers.get("server-timing")?.match(/upload_ack;dur=([\d.]+)/);
      assert.ok(timing, "Upload acknowledgement timing missing");
      acknowledgementMs.push(Number(timing[1]));
      const accepted = await response.json();
      assert.equal(response.status, 202, JSON.stringify(accepted));
      const duplicate = await call(i, "/api/save-answer", {}, { headers: { "X-Submission-Id": id } });
      assert.ok([200, 202].includes(duplicate.status));
      assert.equal((await call(i + 1000, `/api/jobs/${id}`)).status, 404);
      return { id, i };
    }));
    if (process.argv.includes("--restart")) {
      worker.kill("SIGKILL"); await once(worker, "exit"); worker = launch("worker.js");
    }
    const deadline = Date.now() + Number(arg("timeout", 1800)) * 1000;
    let completed = 0;
    let lastReport = Date.now();
    while (completed < jobs.length) {
      if (Date.now() > deadline) throw new Error("Load test completion deadline exceeded.");
      const status = await Promise.all(jobs.map(job => call(job.i, `/api/jobs/${job.id}`)));
      for (const result of status) assert.notEqual(result.data.state, expectedState === "completed" ? "failed" : "completed", JSON.stringify(result.data.evaluation));
      completed = status.filter(r => r.data.state === expectedState).length;
      if (Date.now() - lastReport > 15000) { console.log(JSON.stringify({ completed, total: jobs.length, elapsedSeconds: Math.round((Date.now() - started) / 1000) })); lastReport = Date.now(); }
      if (completed < jobs.length) await sleep(1000);
    }
    queue = new Queue(path.join(data, "recordings", "queue.sqlite"), { health: () => null });
    assert.ok(peaks.transcription <= 2); assert.ok(peaks.scoring <= 2);
    assert.equal(queue.get("SELECT count(*) AS n FROM jobs WHERE state=?", expectedState).n, jobs.length);
    for (const job of jobs) {
      const history = await call(job.i, "/api/recordings");
      assert.equal(history.data.recordings.filter(r => r.id === job.id).length, 1);
      if (invalidMedia) assert.equal(history.data.recordings[0].path, null);
      else {
        assert.equal((await fetch(base + history.data.recordings[0].path, { headers: { "X-Expected-Owner": expectedOwner(job.i + 1000), Cookie: cookie(job.i + 1000) } })).status, 404);
        const video = await fetch(base + history.data.recordings[0].path, { headers: { "X-Expected-Owner": expectedOwner(job.i), Cookie: cookie(job.i), Range: "bytes=0-15" } });
        assert.equal(video.status, 206);
        await video.arrayBuffer();
      }
    }
    const metrics = queue.metrics();
    const report = { users: jobs.length, arrivals, fixtureDurationSeconds: duration, realUpstreams: real, elapsedSeconds: Math.round((Date.now() - started) / 1000), lightweightP95Ms: Math.round(p95(latencies)), uploadIncludingTransferP95Ms: Math.round(p95(uploadMs)), uploadAcknowledgementP95Ms: Math.round(p95(acknowledgementMs)), peaks, stages: metrics.stages, terminalCounts: metrics.jobs, dataDirectory: data };
    console.log(JSON.stringify(report, null, 2));
    assert.ok(p95(latencies) < 1000, "Lightweight API p95 exceeds one second");
    assert.ok(p95(acknowledgementMs) < 2000, "Upload acknowledgement p95 exceeds two seconds after transfer");
    return report;
  } finally {
    queue?.close();
    for (const child of children) if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
      await once(child, "exit"); clearTimeout(timer);
    }
    if (upstream) await new Promise(resolve => upstream.close(resolve));
    if (!process.argv.includes("--keep-data")) fs.rmSync(data, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

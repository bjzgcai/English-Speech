#!/usr/bin/env node
const { listenForTest } = require("./test-http");
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
const { mediaConcurrency, pipelineConcurrency } = require("../src/media-config");
const { modelConcurrency } = require("../src/model-guard");
const root = path.resolve(__dirname, "..");
const arg = (key, fallback) => process.argv.find(value => value.startsWith(`--${key}=`))?.split("=").slice(1).join("=") || fallback;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const p95 = values => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * 0.95) - 1)] || 0;
async function main() {
  const users = Number(arg("users", 10));
  const arrivals = Number(arg("arrivals", users));
  const duration = Number(arg("duration", 2));
  const deadline = Date.now() + Number(arg("timeout", 1800)) * 1000;
  const capacity = process.argv.includes("--capacity-profile") ? require("dotenv").parse(fs.readFileSync(path.join(root, "ops/englisheval-capacity.env"))) : {};
  const concurrency = mediaConcurrency(arg("ffmpeg-concurrency", capacity.FFMPEG_CONCURRENCY ?? process.env.FFMPEG_CONCURRENCY));
  assert.ok(Number.isInteger(users) && users > 0 && users <= 50);
  assert.ok(Number.isInteger(arrivals) && arrivals >= users && arrivals <= 250);
  assert.ok(Number.isFinite(duration) && duration > 0 && duration <= 130);
  const resume = arg("resume-data", "");
  const data = resume ? fs.realpathSync(resume) : fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-load-"));
  if (resume) {
    assert.ok(process.argv.includes("--keep-data"), "Resumed benchmarks must retain their data");
    assert.ok(data.startsWith(fs.realpathSync(os.tmpdir()) + path.sep + "englisheval-load-"), "Only isolated temporary benchmark data can be resumed");
    assert.ok(fs.realpathSync(path.join(data, "recordings", "queue.sqlite")).startsWith(data + path.sep), "Benchmark database must be inside its temporary directory");
  }
  const children = [];
  const peaks = { transcription: 0, scoring: 0, question: 0 };
  const actualModelPeaks = { transcription: 0, scoring: 0, question: 0 };
  const running = { transcription: 0, scoring: 0, question: 0 };
  const questionOutcomes = { generated: 0, fallback: 0 };
  let server;
  let worker;
  let queue;
  let upstream;
  const latencies = [];
  const uploadMs = [];
  const acknowledgementMs = [];
  const started = Date.now();
  const webm = process.argv.includes("--webm");
  const standalone = process.argv.includes("--standalone");
  const silent = process.argv.includes("--silent");
  const audioOnly = process.argv.includes("--audio-only");
  const noAudio = process.argv.includes("--no-audio");
  const fixture = arg("fixture", path.join(data, webm ? "fixture.webm" : "fixture.mp4"));
  const failScoring = process.argv.includes("--fail-scoring");
  const failQuestion = process.argv.includes("--fail-question");
  const invalidMedia = process.argv.includes("--invalid-media");
  const guests = process.argv.includes("--guests");
  const expectedState = failScoring || invalidMedia || noAudio || (audioOnly && !standalone) ? "failed" : "completed";
  console.log(JSON.stringify({ event: "benchmark-start", users, arrivals, ffmpegConcurrency: concurrency, dataDirectory: data }));
  try {
    let resumedJobs = null;
    if (resume) {
      assert.equal(guests, false, "Resume uses synthetic member identities");
      queue = new Queue(path.join(data, "recordings", "queue.sqlite"), { health: () => null });
      const rows = queue.all("SELECT * FROM jobs");
      assert.equal(rows.length, users);
      for (const row of rows) {
        assert.match(row.owner, /^load-\d+$/);
        const payload = JSON.parse(row.payload);
        assert.equal(payload.record.user.name, "Synthetic load participant");
        assert.ok(path.resolve(payload.inputPath).startsWith(data + path.sep));
        assert.equal(path.basename(payload.record.filename), payload.record.filename);
        if (row.state === "failed") {
          assert.equal(row.stage, "scoring", "Only a saved scoring response can be revalidated");
          assert.ok(JSON.parse(row.checkpoint).network?.scoring);
          queue.run("UPDATE jobs SET state='queued',result=NULL,lease=NULL,token=NULL,projected=0,retry_at=NULL,updated=? WHERE id=? AND state='failed'", Date.now(), row.id);
        }
      }
      resumedJobs = rows.map(row => ({ id: row.id, i: Number(row.owner.slice(5)) }));
      for (const row of queue.all("SELECT data FROM telemetry WHERE stage='upload'")) acknowledgementMs.push(JSON.parse(row.data).durationMs);
    }
    if (invalidMedia) fs.writeFileSync(fixture, "Synthetic invalid media fixture");
    if (!fs.existsSync(fixture)) {
      const args = ["-v", "error", "-threads", "1", "-filter_threads", "1"];
      if (!audioOnly) args.push("-f", "lavfi", "-i", `testsrc2=size=${arg("size", "640x360")}:rate=24:duration=${duration}`);
      if (!noAudio) args.push("-f", "lavfi", "-i", silent ? "anullsrc=r=16000:cl=mono" : `sine=frequency=440:duration=${duration}`);
      if (!audioOnly) args.push("-c:v", webm ? "libvpx" : "libx264", ...(webm ? ["-deadline", "realtime", "-cpu-used", "8"] : ["-preset", "veryfast"]), "-threads:v", "1");
      if (!noAudio) args.push("-c:a", webm ? "libopus" : "aac");
      args.push("-t", String(duration), fixture);
      const generated = spawnSync(require("ffmpeg-static"), args, { timeout: 180000 });
      assert.equal(generated.status, 0, generated.stderr?.toString());
    }
    upstream = http.createServer(async (req, res) => {
      const chunks = [];
      req.on("data", chunk => chunks.push(chunk));
      await once(req, "end");
      const kind = req.url === "/asr" ? "transcription" : JSON.parse(Buffer.concat(chunks).toString()).model === "test-question" ? "question" : "scoring";
      running[kind]++; peaks[kind] = Math.max(peaks[kind], running[kind]);
      await sleep(Number(arg("model-delay", 100)));
      running[kind]--;
      res.setHeader("Content-Type", "application/json");
      if (kind === "transcription") return res.end(JSON.stringify({ text: "I worked with my team to solve a difficult problem. We discussed several approaches and tested our solution carefully. The project helped me improve my communication and technical skills." }));
      if (kind === "question") {
        if (failQuestion) { res.statusCode = 400; return res.end(JSON.stringify({ error: "Synthetic question service failure" })); }
        return res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ question: "Describe a project where you worked with a team.", focus: "Communication", expectedDurationSeconds: 120 }) } }] }));
      }
      if (failScoring) { res.statusCode = 400; return res.end(JSON.stringify({ error: "Synthetic scoring failure" })); }
      const evaluation = JSON.stringify({ summary: "Clear response.", hasScorableEnglishSpeech: true, improvedAnswer: "I worked with my team to solve a difficult problem.", strengths: ["Clear"], improvements: ["Add detail"], rubric: Object.fromEntries(["pronunciation", "fluency", "grammar", "vocabulary", "coherence", "visualDelivery"].map(key => [key, { score: 80, feedback: "Clear." }])) });
      res.end(JSON.stringify({ model: "test-model", usage: { prompt_tokens: 1000, completion_tokens: 250 }, choices: [{ message: { content: process.argv.includes("--repeat-json") ? `${evaluation}\n\x60\x60\n${evaluation}` : evaluation } }] }));
    });
    await listenForTest(upstream);
    const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
    const probe = await listenForTest();
    const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
    const real = process.argv.includes("--real-upstreams");
    if (real) assert.ok(arg("fixture", ""), "Real upstream tests require an explicit synthetic spoken fixture");
    let upstreamEnv = {};
    if (real) {
      const dotenv = require("dotenv");
      for (const file of [".env", ".env.prod"]) if (fs.existsSync(path.join(root, file))) Object.assign(upstreamEnv, dotenv.parse(fs.readFileSync(path.join(root, file))));
    }
    const env = { ...process.env, ...upstreamEnv, ...capacity, NODE_ENV: "test", DATA_DIR: data, HOST: "127.0.0.1", PORT: String(port), FFMPEG_CONCURRENCY: String(concurrency), QUEUE_ENABLED: "true", QUEUE_START_PAUSED: "false", SESSION_SECRET: "isolated-load-test-secret", DINGTALK_APP_KEY: "test", DINGTALK_APP_SECRET: "test", DINGTALK_CORP_ID: "test", COOKIE_SECURE: "false", ...(real ? {} : { INTERNAL_LLM_API_KEY: "test", INTERNAL_LLM_QUESTION_MODEL: "test-question", INTERNAL_LLM_EVAL_MODEL: "test-scoring", INTERNAL_LLM_TRANSCRIPTIONS_URL: `${upstreamUrl}/asr`, INTERNAL_LLM_CHAT_COMPLETIONS_URL: `${upstreamUrl}/chat` }) };
    if (guests) Object.assign(env, { DINGTALK_APP_KEY: "", DINGTALK_APP_SECRET: "", DINGTALK_CORP_ID: "" });
    const launch = name => {
      const child = spawn(process.execPath, [path.join(root, name)], { cwd: root, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
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
        const code = crypto.randomUUID().toUpperCase();
        fs.appendFileSync(path.join(data, "invitations", "metadata.jsonl"), JSON.stringify({ id: crypto.randomUUID(), hash: crypto.createHash("sha256").update(code).digest("hex") }) + "\n");
        const response = await fetch(base + "/api/invitation/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
        assert.equal(response.status, 200);
        const redeemed = await response.json();
        assert.equal(redeemed.user.identityType, "guest");
        visitors.set(index, { owner: redeemed.user.openId, cookie: response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") });
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
      const response = await fetch(base + route, { signal: AbortSignal.timeout(90000), headers: { "X-Expected-Owner": expectedOwner(index), Cookie: cookie(index), "Content-Type": "application/json", ...extra.headers }, method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body) });
      latencies.push(performance.now() - start);
      return { status: response.status, data: await response.json() };
    };
    let jobs = resumedJobs;
    if (!jobs) {
    await Promise.all(Array.from({ length: arrivals }, (_, i) => call(i, "/api/privacy-consent", { privacyAgreed: true, sensitiveInfoAgreed: true })));
    const admissions = await Promise.all(Array.from({ length: arrivals }, (_, i) => call(i, "/api/admission", {})));
    assert.equal(admissions.filter(r => r.data.admission?.state === "admitted").length, Math.min(arrivals, 50));
    const admitted = admissions.map((r, i) => ({ ...r, i })).filter(r => r.data.admission?.state === "admitted").slice(0, users);
    const uploadRoute = standalone ? "/api/evaluate-video" : "/api/save-answer";
    jobs = await Promise.all(admitted.map(async ({ i }) => {
      const generated = real || failQuestion;
      const question = await call(i, generated ? "/api/generate-question" : "/api/game/question", generated ? { profile: { role: "Software engineering" } } : {});
      assert.ok(question.data.question?.id && question.data.question.question, "Question service must return a persisted generated or fallback question");
      const fallback = question.data.model === "fallback" || ![200, 201].includes(question.status);
      questionOutcomes[fallback ? "fallback" : "generated"]++;
      let grant;
      while (!grant) {
        assert.ok(Date.now() < deadline, "Upload grant deadline exceeded");
        const result = await call(i, "/api/admission/upload-grant", {});
        if (result.status === 200) grant = result.data.grant;
        else { assert.equal(result.status, 429); await sleep(100 + Math.random() * 100); }
      }
      const id = crypto.randomUUID();
      const form = new FormData();
      form.append("video", await fs.openAsBlob(fixture, { type: webm ? "video/webm" : "video/mp4" }), webm ? "synthetic.webm" : "synthetic.mp4");
      form.append("questionId", question.data.question.id);
      form.append("submissionId", id);
      const start = performance.now();
      const response = await fetch(`${base}${uploadRoute}`, { method: "POST", signal: AbortSignal.timeout(90000), headers: { "X-Expected-Owner": expectedOwner(i), Cookie: cookie(i), "X-Submission-Id": id, "X-Question-Id": question.data.question.id, "X-Upload-Grant": grant }, body: form });
      uploadMs.push(performance.now() - start);
      const timing = response.headers.get("server-timing")?.match(/upload_ack;dur=([\d.]+)/);
      assert.ok(timing, "Upload acknowledgement timing missing");
      acknowledgementMs.push(Number(timing[1]));
      const accepted = await response.json();
      assert.equal(response.status, 202, JSON.stringify(accepted));
      const duplicate = await call(i, uploadRoute, {}, { headers: { "X-Submission-Id": id } });
      assert.ok([200, 202].includes(duplicate.status));
      assert.equal((await call(i + 1000, `/api/jobs/${id}`)).status, 404);
      return { id, i };
    }));
    }
    const restartAt = arg("restart-at", "");
    if (process.argv.includes("--restart") || restartAt) {
      if (restartAt) {
        queue = new Queue(path.join(data, "recordings", "queue.sqlite"), { health: () => null });
        while (!queue.get("SELECT id FROM jobs WHERE state='processing' AND stage=? AND json_extract(checkpoint,'$.normalized') IS NOT NULL", restartAt)) {
          assert.ok(Date.now() < deadline, "Restart checkpoint deadline exceeded");
          await sleep(25);
        }
      }
      process.kill(-worker.pid, "SIGKILL"); await once(worker, "exit");
      if (process.argv.includes("--drop-artifacts")) fs.rmSync(path.join(data, "recordings", "artifacts"), { recursive: true, force: true });
      worker = launch("worker.js");
    }
    let completed = 0;
    let lastReport = Date.now();
    queue ||= new Queue(path.join(data, "recordings", "queue.sqlite"), { health: () => null });
    while (completed < jobs.length) {
      for (const row of queue.all("SELECT kind,count(*) AS count FROM model_requests WHERE finished IS NULL AND expires>? GROUP BY kind", Date.now())) actualModelPeaks[row.kind] = Math.max(actualModelPeaks[row.kind] || 0, row.count);
      if (Date.now() > deadline) throw new Error("Load test completion deadline exceeded.");
      const status = await Promise.all(jobs.map(job => call(job.i, `/api/jobs/${job.id}`)));
      for (const result of status) assert.notEqual(result.data.state, expectedState === "completed" ? "failed" : "completed", JSON.stringify(result.data.evaluation));
      completed = status.filter(r => r.data.state === expectedState).length;
      if (Date.now() - lastReport > 15000) { console.log(JSON.stringify({ completed, total: jobs.length, elapsedSeconds: Math.round((Date.now() - started) / 1000) })); lastReport = Date.now(); }
      if (completed < jobs.length) await sleep(1000);
    }
    queue ||= new Queue(path.join(data, "recordings", "queue.sqlite"), { health: () => null });
    if (restartAt) assert.ok(queue.get("SELECT sum(recovery_count) AS n FROM jobs").n > 0, "Worker must recover an expired job lease");
    for (const kind of ["transcription", "scoring"]) assert.ok(peaks[kind] <= modelConcurrency(kind, env[`MODEL_${kind.toUpperCase()}_CONCURRENT`]));
    assert.equal(queue.get("SELECT count(*) AS n FROM jobs WHERE state=?", expectedState).n, jobs.length);
    for (const job of jobs) {
      const history = await call(job.i, "/api/recordings");
      assert.equal(history.data.recordings.filter(r => r.id === job.id).length, 1);
      if (invalidMedia || noAudio || (audioOnly && !standalone)) assert.equal(history.data.recordings[0].path, null);
      else {
        assert.equal((await fetch(base + history.data.recordings[0].path, { headers: { "X-Expected-Owner": expectedOwner(job.i + 1000), Cookie: cookie(job.i + 1000) } })).status, 404);
        const video = await fetch(base + history.data.recordings[0].path, { headers: { "X-Expected-Owner": expectedOwner(job.i), Cookie: cookie(job.i), Range: "bytes=0-15" } });
        assert.equal(video.status, 206);
        await video.arrayBuffer();
        if (silent) {
          assert.equal(history.data.recordings[0].evaluation.overallScore, 0);
          assert.equal(history.data.recordings[0].evaluation.audioMetrics.wordCount, 0);
        }
        if (audioOnly) assert.equal(history.data.recordings[0].evaluation.mediaValidation.visualEvaluated, false);
      }
    }
    const metrics = queue.metrics();
    assert.equal(metrics.resources.pipelines.limit, pipelineConcurrency(env.WORKER_CONCURRENCY));
    for (const kind of ["transcription", "scoring"]) assert.equal(metrics.resources[kind].limit, modelConcurrency(kind, env[`MODEL_${kind.toUpperCase()}_CONCURRENT`]));
    assert.ok((metrics.resources.ffmpeg?.peak || 0) <= concurrency);
    if (silent) assert.equal(peaks.transcription, 0);
    if (failQuestion) assert.equal(questionOutcomes.fallback, jobs.length);
    const normalizations = queue.all("SELECT json_extract(checkpoint,'$.normalized.normalization') AS mode,count(*) AS count FROM jobs GROUP BY mode");
    const evaluationSummary = queue.get("SELECT coalesce(sum(json_extract(result,'$.evaluation.hasScorableEnglishSpeech')=1),0) AS scorableCount,min(json_extract(result,'$.evaluation.audioMetrics.wordCount')) AS minimumWords,max(json_extract(result,'$.evaluation.audioMetrics.wordCount')) AS maximumWords,coalesce(sum(json_extract(checkpoint,'$.normalized.artifactFallback')=1),0) AS artifactFallbacks FROM jobs");
    if (real && !silent && expectedState === "completed") assert.equal(evaluationSummary.scorableCount, jobs.length, "The spoken fixture must produce scorable English in every real-model sample");
    const report = { users: jobs.length, arrivals, fixtureDurationSeconds: duration, realUpstreams: real, resumed: Boolean(resume), ffmpegConcurrency: concurrency, format: webm ? "webm" : "mp4", standalone, silent, audioOnly, elapsedSeconds: Math.round((Date.now() - started) / 1000), lightweightP95Ms: Math.round(p95(latencies)), uploadIncludingTransferP95Ms: resume ? null : Math.round(p95(uploadMs)), uploadAcknowledgementP95Ms: Math.round(p95(acknowledgementMs)), peaks, resources: metrics.resources, questionOutcomes, normalizations, evaluationSummary, stages: metrics.stages, terminalCounts: metrics.jobs, dataDirectory: data };
    report.actualModelPeaks = actualModelPeaks;
    fs.writeFileSync(path.join(data, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    assert.ok(p95(latencies) < 1000, "Lightweight API p95 exceeds one second");
    assert.ok(p95(acknowledgementMs) < 2000, "Upload acknowledgement p95 exceeds two seconds after transfer");
    return report;
  } finally {
    queue?.close();
    for (const child of children) if (child.exitCode === null && child.signalCode === null) {
      process.kill(-child.pid, "SIGTERM");
      const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 10000);
      await once(child, "exit"); clearTimeout(timer);
    }
    if (upstream) await new Promise(resolve => upstream.close(resolve));
    if (!process.argv.includes("--keep-data")) fs.rmSync(data, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

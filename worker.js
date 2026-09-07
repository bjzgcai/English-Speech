const fs = require("node:fs");
const path = require("node:path");
const workerId = require("node:crypto").randomUUID();
const config = require("./src/config");
const { Queue } = require("./src/queue");
const { context, stage, resources } = require("./src/processing");
process.env.QUEUE_WORKER = "true";
const { testHelpers: evaluation } = require("./src/app");

const queue = new Queue(config.queueFile);
const active = new Map();
let stopping = false;

async function processJob(job) {
  const controller = new AbortController();
  active.set(job.id, { controller, token: job.token });
  const task = { ...job, queue, signal: controller.signal };
  const record = job.payload.record;
  const videoPath = path.join(config.recordingsDir, record.filename);
  const artifactBaseDir = path.join(config.artifactsDir, job.id);
  let valid = Boolean(job.checkpoint.normalized);
  try {
    if (job.recovery_count >= 3) throw new Error("Processing was interrupted repeatedly. Please retry later.");
    await context.run(task, async () => {
      const media = await stage("normalized", async () => {
        const inspected = await evaluation.inspectMedia(job.payload.inputPath);
        if (!inspected.hasAudio) throw new Error("The recording has no usable microphone audio.");
        if (job.payload.mode !== "standalone-speech" && !inspected.hasVideo) throw new Error("The answer requires both camera and microphone tracks.");
        const media = evaluation.limitStandaloneMediaInfo(inspected);
        task.checkpoint.category = media.durationSeconds <= 40 ? "short" : "long";
        fs.mkdirSync(artifactBaseDir, { recursive: true, mode: 0o700 });
        const temporaryPath = path.join(artifactBaseDir, "normalizing.mp4");
        await evaluation.convertToMp4(job.payload.inputPath, temporaryPath, { maximumDurationSeconds: 120 });
        controller.signal.throwIfAborted();
        fs.renameSync(temporaryPath, videoPath);
        for (const target of [videoPath, config.recordingsDir]) {
          const descriptor = fs.openSync(target, "r");
          try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
        }
        return media;
      });
      valid = true;
      if (task.checkpoint.media && (!fs.existsSync(path.join(artifactBaseDir, "audio.mp3")) || task.checkpoint.media.framePaths.some(file => !fs.existsSync(file)))) delete task.checkpoint.media;
      const result = await evaluation.evaluateSavedVideo({ videoPath, artifactBaseDir, profile: record.profile, question: record.question, evaluationMode: job.payload.mode, mediaInfo: media });
      if (job.payload.mode === "standalone-speech" && result.rubric?.coherence) result.rubric.coherence.label = "Coherence / speech consistency";
      queue.finish(job.id, job.token, { ...record, bytes: fs.statSync(videoPath).size, path: `/api/recordings/${job.id}/video`, evaluation: result });
    });
  } catch (error) {
    if (!controller.signal.aborted) {
      // Upstream response bodies and FFmpeg diagnostics can contain private data.
      const reason = /no usable microphone|requires both camera|interrupted repeatedly/.test(error.message) ? error.message : valid ? "Your recording was saved, but evaluation could not finish. Please retry later." : "This recording could not be processed as supported media.";
      queue.finish(job.id, job.token, { ...record, hasVideo: valid, filename: valid ? record.filename : null, bytes: valid && fs.existsSync(videoPath) ? fs.statSync(videoPath).size : 0, path: valid ? `/api/recordings/${job.id}/video` : null, evaluation: { status: "failed", reason } });
    }
  } finally {
    active.delete(job.id);
  }
}

function tick() {
  const leader = queue.transaction(() => {
    const current = queue.setting("workerOwner");
    if (current && current !== workerId && Date.now() - Number(queue.setting("workerHeartbeat") || 0) < 30000) return false;
    queue.setting("workerOwner", workerId);
    queue.setting("workerHeartbeat", Date.now());
    return true;
  });
  if (!leader) return;
  queue.setting("workerResources", JSON.stringify({ ...resources(), rssBytes: process.memoryUsage().rss }));
  if (Date.now() - Number(queue.setting("lastPrune") || 0) > 3600000) {
    queue.run("DELETE FROM telemetry WHERE id NOT IN (SELECT id FROM telemetry ORDER BY id DESC LIMIT 10000)");
    queue.setting("lastPrune", Date.now());
  }
  for (const [id, task] of active) {
    if (!queue.alive(id, task.token) || stopping) task.controller.abort(new Error("Processing interrupted."));
    else queue.renew(id, task.token);
  }
  if (stopping || Number(queue.setting("circuitUntil") || 0) > Date.now()) return;
  while (active.size < 4) {
    const job = queue.claim();
    if (!job) break;
    processJob(job).catch(() => { console.error("Worker job could not be finalized; it will recover from its lease."); });
  }
}
const timer = setInterval(() => {
  try { tick(); } catch { console.error("Worker queue temporarily unavailable."); }
}, 1000);
tick();

async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  const owned = [...active.entries()].map(([id, task]) => ({ id, token: task.token }));
  for (const task of active.values()) task.controller.abort(new Error("Worker restarting."));
  while (active.size) await new Promise(resolve => setTimeout(resolve, 50));
  for (const task of owned) queue.run("UPDATE jobs SET lease=0 WHERE id=? AND token=? AND state='processing'", task.id, task.token);
  if (queue.setting("workerOwner") === workerId) queue.setting("workerHeartbeat", 0);
  queue.close();
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

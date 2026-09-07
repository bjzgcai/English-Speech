const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Queue, terminal } = require("./queue");
const { readJsonLines, writeJsonLines } = require("./storage");
const { readMonitorStatus, monitorFile } = require("./monitoring");

function registerQueueRoutes(app, deps) {
  const { config, requireAuth, requireVisitor, requirePrivacyConsent, requireAdminAccess, upload, findOwnedQuestion, validAnswerSaveId, decodeUtf8UploadFilename, standaloneEvaluationTitle } = deps;
  const queue = new Queue(config.queueFile);
  require("./processing").setModelQueue(queue);
  require("./processing").setQuestionObserver(data => queue.run("INSERT INTO telemetry(job,stage,created,data) VALUES(NULL,'question',?,?)", Date.now(), JSON.stringify(data)));
  // An interrupted web process cannot leave upload-transfer permits held forever.
  if (process.env.QUEUE_WORKER !== "true") queue.run("UPDATE admissions SET uploading=0,grant=NULL,grant_until=NULL WHERE uploading=1");
  const rates = new Map();
  const wrap = fn => async (req, res, next) => {
    try {
      if (req.user) {
        let rate = rates.get(req.user.openId);
        if (!rate || rate.until <= Date.now()) {
          if (rates.size >= 10000) for (const [key, value] of rates) if (value.until <= Date.now()) rates.delete(key);
          if (rates.size >= 10000 && !rates.has(req.user.openId)) throw Object.assign(new Error("Server is busy. Please retry later."), { status: 429 });
          rate = { until: Date.now() + 60000, count: 0 }; rates.set(req.user.openId, rate);
        }
        if (++rate.count > 180) throw Object.assign(new Error("Too many requests. Please wait before retrying."), { status: 429 });
      }
      await fn(req, res, next);
    }
    catch (error) {
      if (res.headersSent) return next(error);
      res.set("Retry-After", "5");
      res.status(error.status || 503).json({ error: error.status ? error.message : "Queue temporarily unavailable. Please retry.", code: "QUEUE_BUSY" });
    }
  };
  function project() {
    const updates = queue.all("SELECT * FROM jobs WHERE projected=0 ORDER BY created");
    if (!updates.length) return;
    let records = readJsonLines(config.metadataFile);
    const done = [];
    for (const job of updates) {
      const payload = JSON.parse(job.payload);
      if (job.state === "canceled") {
        // A canceled worker may still be exiting FFmpeg. Delete only after its lease expires.
        if (job.lease && job.lease > Date.now()) continue;
        records = records.filter(record => record.id !== job.id);
        for (const target of [payload.inputPath, payload.record.filename ? path.join(config.recordingsDir, payload.record.filename) : null, path.join(config.artifactsDir, job.id)].filter(Boolean)) fs.rmSync(target, { force: true, recursive: true });
      } else {
        const record = job.result ? JSON.parse(job.result) : { ...payload.record, filename: null, hasVideo: false, bytes: 0, evaluation: { status: job.state, stage: job.stage }, pendingJobId: job.id };
        const index = records.findIndex(record => record.id === job.id);
        if (index < 0) records.push(record); else records[index] = record;
        if (terminal.has(job.state)) fs.rmSync(payload.inputPath, { force: true });
      }
      done.push(job);
    }
    if (!done.length) return;
    writeJsonLines(config.metadataFile, records);
    // A worker completing during projection must remain eligible for the next pass.
    for (const job of done) queue.run("UPDATE jobs SET projected=1 WHERE id=? AND state=? AND updated=?", job.id, job.state, job.updated);
  }
  const generating = new Set();
  const required = wrap((req, res, next) => {
    const admission = queue.admission(req.user.openId);
    if (admission?.state !== "admitted") return res.status(409).json({ error: "Wait for admission before starting an examine session.", code: "ADMISSION_REQUIRED" });
    const saved = queue.setting(`question:${admission.id}`);
    if (saved) return res.json(JSON.parse(saved));
    if (generating.has(admission.id)) return res.status(429).set("Retry-After", "5").json({ error: "Your question is already being prepared." });
    generating.add(admission.id);
    res.once("close", () => generating.delete(admission.id));
    const json = res.json.bind(res);
    res.json = data => {
      if (data.question?.id) queue.setting(`question:${admission.id}`, JSON.stringify(data));
      return json(data);
    };
    next();
  });
  app.get("/api/health", (_req, res) => {
    const workerReady = Date.now() - Number(queue.setting("workerHeartbeat") || 0) < 30000;
    res.status(workerReady ? 200 : 503).json({ ok: workerReady, workerReady });
  });
  app.use("/api", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  app.get("/api/admission", requireVisitor, wrap((req, res) => res.json({ admission: queue.admission(req.user.openId) })));
  app.post("/api/admission", requireVisitor, requirePrivacyConsent, wrap((req, res) => res.json({ admission: queue.enter(req.user.openId) })));
  app.post("/api/admission/heartbeat", requireVisitor, wrap((req, res) => {
    queue.transaction(() => { queue.run("UPDATE admissions SET heartbeat=? WHERE owner=?", Date.now(), req.user.openId); queue.sweep(); });
    res.json({ admission: queue.admission(req.user.openId) });
  }));
  app.delete("/api/admission", requireVisitor, wrap((req, res) => { queue.release(req.user.openId); res.json({ ok: true }); }));
  app.post("/api/admission/upload-grant", requireVisitor, requirePrivacyConsent, wrap((req, res) => res.json(queue.grant(req.user.openId))));
  app.get("/api/jobs/:id", requireVisitor, wrap((req, res) => {
    const status = queue.status(req.params.id, req.user.openId);
    if (!status) return res.status(404).json({ error: "Job not found." });
    res.json(status);
  }));
  app.post("/api/save-answer/:id/cancel", requireVisitor, wrap((req, res, next) => {
    if (!validAnswerSaveId(req.params.id)) return res.status(400).json({ error: "A valid submission ID is required." });
    const canceled = queue.cancel(req.params.id, req.user.openId);
    if (!canceled) return next();
    project();
    res.json({ ok: true, discarded: true });
  }));
  app.get("/api/admin/queue", requireAuth, requireAdminAccess, wrap((_req, res) => res.json({ ...queue.metrics(), models: require("./processing").modelGuard(queue).metrics() })));
  app.get("/api/admin/monitor", requireAuth, requireAdminAccess, (_req, res) => res.json(readMonitorStatus(monitorFile(config.recordingsDir))));
  app.post("/api/admin/queue", requireAuth, requireAdminAccess, wrap((req, res) => {
    if (typeof req.body.paused !== "boolean") return res.status(400).json({ error: "paused must be a boolean." });
    queue.setting("paused", req.body.paused);
    res.json(queue.metrics());
  }));
  const gate = wrap((req, res, next) => {
    const id = validAnswerSaveId(req.get("X-Submission-Id"));
    if (!id) return res.status(400).json({ error: "X-Submission-Id must be a UUID v4." });
    const existing = queue.status(id, req.user.openId);
    if (existing) return res.status(existing.state === "canceled" ? 409 : terminal.has(existing.state) ? 200 : 202).json(existing);
    if (queue.get("SELECT id FROM jobs WHERE id=?", id)) return res.status(409).json({ error: "Submission ID unavailable." });
    if (readJsonLines(config.metadataFile).some(record => record.id === id) || queue.get("SELECT id FROM cancellations WHERE id=? AND owner=?", id, req.user.openId)) return res.status(409).json({ error: "Submission ID unavailable." });
    if (req.path === "/api/save-answer") {
      req.ownedQuestion = findOwnedQuestion(req.get("X-Question-Id"), req.user.openId);
      if (!req.ownedQuestion) return res.status(400).json({ error: "The question is missing or does not belong to this user." });
    }
    req.queueAdmission = queue.beginUpload(req.user.openId, req.get("X-Upload-Grant") || "");
    req.queueSubmission = id;
    req.setTimeout(300000, () => req.destroy());
    res.once("close", () => {
      queue.endUpload(req.user.openId);
      if (req.file?.path) fs.rm(req.file.path, { force: true }, () => {});
    });
    next();
  });
  const accept = wrap(async (req, res) => {
    const receivedAt = performance.now();
    if (!req.file) return res.status(400).json({ error: "A video file is required." });
    const id = req.queueSubmission;
    const standalone = !req.ownedQuestion;
    const finishedAt = new Date().toISOString();
    const filename = `${finishedAt.replace(/[:.]/g, "-")}-${id}.mp4`;
    const inbox = path.join(config.recordingsDir, "pending");
    await fs.promises.mkdir(inbox, { recursive: true, mode: 0o700 });
    const inputPath = path.join(inbox, `${id}-${crypto.randomUUID()}`);
    await fs.promises.rename(req.file.path, inputPath);
    const file = await fs.promises.open(inputPath, "r");
    await file.sync(); await file.close();
    const directory = await fs.promises.open(inbox, "r");
    await directory.sync(); await directory.close();
    const originalFilename = decodeUtf8UploadFilename(req.file.originalname);
    const record = {
      id, submissionId: id, hasVideo: true, filename, mimeType: "video/mp4", originalMimeType: req.file.mimetype, convertedToMp4: true,
      startedAt: typeof req.body.startedAt === "string" ? req.body.startedAt : finishedAt, finishedAt,
      openId: req.user.openId, userId: req.user.userId, jobNumber: req.user.jobNumber, email: req.user.email, orgEmail: req.user.orgEmail, user: req.user,
      profile: standalone ? { name: req.user.name } : req.ownedQuestion.profile,
      questionId: req.ownedQuestion?.id || null,
      question: standalone ? { question: "Standalone speech", focus: "Speech consistency and English communication" } : req.ownedQuestion.question,
      ...(standalone ? { title: standaloneEvaluationTitle(originalFilename), originalFilename: path.basename(originalFilename), sourceType: "upload", evaluationMode: "standalone-speech" } : {}),
    };
    try { queue.accept(id, req.user.openId, req.queueAdmission, { record, inputPath, mode: standalone ? "standalone-speech" : "question-answer" }); }
    catch (error) { await fs.promises.rm(inputPath, { force: true }); throw error; }
    const status = queue.status(id, req.user.openId);
    const acknowledgementMs = performance.now() - receivedAt;
    res.set("Server-Timing", `upload_ack;dur=${acknowledgementMs.toFixed(2)}`);
    queue.run("INSERT INTO telemetry(job,stage,created,data) VALUES(?,'upload',?,?)", id, Date.now(), JSON.stringify({ durationMs: Math.round(acknowledgementMs), bytes: req.file.size }));
    res.status(202).json(status);
  });
  for (const route of ["/api/save-answer", "/api/evaluate-video"]) app.post(route, requireVisitor, requirePrivacyConsent, gate, upload.single("video"), accept);
  return { queue, project, required };
}
module.exports = { registerQueueRoutes };

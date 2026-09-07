const fs = require("node:fs");
const os = require("node:os");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const terminal = new Set(["completed", "failed", "canceled"]);
const stages = ["normalized", "media", "transcription", "scoring"];
const limits = { normalized: 1, media: 1, transcription: 2, scoring: 2 };
const number = (name, fallback) => Math.max(1, Number(process.env[name]) || fallback);

class Queue {
  constructor(file, { capacity = number("QUEUE_CAPACITY", 50), waiting = number("QUEUE_WAITING_CAPACITY", 200), health = null, now = Date.now } = {}) {
    this.capacity = capacity;
    this.waiting = waiting;
    this.now = now;
    this.health = health;
    this.db = new DatabaseSync(file);
    const schema = `PRAGMA busy_timeout=1000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS admissions(id TEXT PRIMARY KEY, owner TEXT UNIQUE NOT NULL, state TEXT NOT NULL, created INTEGER NOT NULL, heartbeat INTEGER NOT NULL, grant TEXT, grant_until INTEGER, uploading INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, owner TEXT NOT NULL, admission TEXT NOT NULL, state TEXT NOT NULL, stage TEXT NOT NULL DEFAULT 'media', created INTEGER NOT NULL, updated INTEGER NOT NULL, started INTEGER, lease INTEGER, token TEXT, payload TEXT NOT NULL, checkpoint TEXT NOT NULL DEFAULT '{}', result TEXT, projected INTEGER NOT NULL DEFAULT 0, stage_started INTEGER, retry_at INTEGER, recovery_count INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS jobs_state ON jobs(state,created);
      CREATE INDEX IF NOT EXISTS jobs_owner ON jobs(owner,created);
      CREATE TABLE IF NOT EXISTS samples(id INTEGER PRIMARY KEY, stage TEXT NOT NULL, category TEXT NOT NULL, duration INTEGER NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS attempts(job TEXT NOT NULL, key TEXT NOT NULL, count INTEGER NOT NULL, status INTEGER, retry_at INTEGER, PRIMARY KEY(job,key));
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cancellations(id TEXT PRIMARY KEY,owner TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS telemetry(id INTEGER PRIMARY KEY, job TEXT, stage TEXT, created INTEGER, data TEXT);
    `;
    // Concurrent first starts can contend while switching a new database to WAL.
    const deadline = Date.now() + 5000;
    while (true) {
      try { this.db.exec(schema); break; }
      catch (error) {
        if (error.errcode !== 5 || Date.now() >= deadline) { this.db.close(); throw error; }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
    }
    if (this.setting("paused") === undefined) this.setting("paused", process.env.QUEUE_START_PAUSED === "true");
  }
  get(sql, ...args) { return this.db.prepare(sql).get(...args); }
  all(sql, ...args) { return this.db.prepare(sql).all(...args); }
  run(sql, ...args) { return this.db.prepare(sql).run(...args); }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try { const value = fn(); this.db.exec("COMMIT"); return value; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  setting(key, value) {
    if (value !== undefined) this.run("INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, String(value));
    return this.get("SELECT value FROM settings WHERE key=?", key)?.value;
  }
  pressure() {
    if (this.health) return this.health();
    if (this.setting("paused") === "true") return "Admissions are temporarily paused.";
    if (this.now() - Number(this.setting("workerHeartbeat") || 0) > 30000) return "Evaluation service is restarting.";
    if (Number(this.setting("circuitUntil") || 0) > this.now()) return "Evaluation service is temporarily delayed.";
    const count = this.get("SELECT count(*) AS n FROM admissions WHERE state!='waiting'").n;
    const disk = fs.statfsSync(require("./config").recordingsDir);
    if (Number(disk.bavail) * Number(disk.bsize) < 5 * 1024 ** 3 + (count + 1) * 512 * 1024 ** 2) return "Storage capacity is temporarily limited.";
    let available = os.freemem();
    if (process.platform === "linux") {
      const match = fs.readFileSync("/proc/meminfo", "utf8").match(/^MemAvailable:\s+(\d+)/m);
      if (match) available = Number(match[1]) * 1024;
    }
    if (available < 512 * 1024 ** 2) {
      const since = Number(this.setting("lowMemorySince") || this.now());
      this.setting("lowMemorySince", since);
      if (this.now() - since > 10000) return "Server capacity is temporarily limited.";
    } else this.setting("lowMemorySince", 0);
    return null;
  }
  processingDelay() {
    if (this.health) return this.health();
    if (this.now() - Number(this.setting("workerHeartbeat") || 0) > 30000) return "Evaluation service is restarting.";
    if (Number(this.setting("circuitUntil") || 0) > this.now()) return "Evaluation service is temporarily delayed.";
    return null;
  }
  sweep() {
    const now = this.now();
    this.run("DELETE FROM admissions WHERE state!='submitted' AND uploading=0 AND heartbeat<?", now - 180000);
    this.run("UPDATE admissions SET grant=NULL,grant_until=NULL WHERE uploading=0 AND grant_until<?", now);
    if (this.pressure()) return;
    const used = this.get("SELECT count(*) AS n FROM admissions WHERE state!='waiting'").n;
    const next = this.all("SELECT id FROM admissions WHERE state='waiting' ORDER BY created,rowid LIMIT ?", Math.max(0, this.capacity - used));
    for (const row of next) this.run("UPDATE admissions SET state='admitted',heartbeat=? WHERE id=?", now, row.id);
  }
  enter(owner) {
    return this.transaction(() => {
      this.sweep();
      let row = this.get("SELECT * FROM admissions WHERE owner=?", owner);
      if (!row) {
        if (this.get("SELECT count(*) AS n FROM admissions WHERE state='waiting'").n >= this.waiting) throw Object.assign(new Error("The waiting room is full. Please try again later."), { status: 429 });
        this.run("INSERT INTO admissions(id,owner,state,created,heartbeat) VALUES(?,?,'waiting',?,?)", crypto.randomUUID(), owner, this.now(), this.now());
        this.sweep();
      }
      row = this.get("SELECT * FROM admissions WHERE owner=?", owner);
      this.run("UPDATE admissions SET heartbeat=? WHERE id=?", this.now(), row.id);
      return this.admission(owner);
    });
  }
  admission(owner) {
    const row = this.get("SELECT * FROM admissions WHERE owner=?", owner);
    if (!row) return null;
    const position = row.state === "waiting" ? this.get("SELECT count(*) AS n FROM admissions WHERE state='waiting' AND rowid <= (SELECT rowid FROM admissions WHERE id=?)", row.id).n : 0;
    const samples = this.all("SELECT duration FROM samples WHERE stage='release' ORDER BY id DESC LIMIT 30");
    const interval = samples.length >= 3 ? samples.reduce((sum, s) => sum + s.duration, 0) / samples.length : null;
    const job = this.get("SELECT id FROM jobs WHERE admission=? AND state!='canceled' ORDER BY created DESC LIMIT 1", row.id);
    const delayed = this.pressure();
    return { id: row.id, state: row.state, queuePosition: position, jobId: job?.id || null, elapsedSeconds: Math.floor((this.now() - row.created) / 1000), estimatedRemainingSeconds: position && interval && !delayed ? { low: Math.round(position * interval / 1000 * 0.7), high: Math.round(position * interval / 1000 * 1.5) } : null, delayed, pollAfterSeconds: 5 };
  }
  release(owner) {
    return this.transaction(() => {
      this.run("DELETE FROM admissions WHERE owner=? AND state!='submitted' AND uploading=0", owner);
      this.sweep();
    });
  }
  grant(owner) {
    return this.transaction(() => {
      this.sweep();
      const row = this.get("SELECT * FROM admissions WHERE owner=? AND state='admitted'", owner);
      if (!row) throw Object.assign(new Error("Wait for admission before uploading."), { status: 409 });
      if (row.uploading) throw Object.assign(new Error("An upload is already in progress."), { status: 409 });
      if (row.grant && row.grant_until > this.now()) return { grant: row.grant, expiresAt: row.grant_until };
      const active = this.get("SELECT count(*) AS n FROM admissions WHERE uploading=1 OR grant_until>?", this.now()).n;
      if (active >= 4) throw Object.assign(new Error("Waiting for an upload slot."), { status: 429 });
      const grant = crypto.randomUUID();
      this.run("UPDATE admissions SET grant=?,grant_until=?,heartbeat=? WHERE id=?", grant, this.now() + 30000, this.now(), row.id);
      return { grant, expiresAt: this.now() + 30000 };
    });
  }
  beginUpload(owner, grant) {
    return this.transaction(() => {
      const row = this.get("SELECT * FROM admissions WHERE owner=? AND grant=? AND grant_until>? AND uploading=0 AND state='admitted'", owner, grant, this.now());
      if (!row) throw Object.assign(new Error("Upload grant expired. Request another upload slot."), { status: 409 });
      this.run("UPDATE admissions SET uploading=1,heartbeat=? WHERE id=?", this.now(), row.id);
      return row.id;
    });
  }
  endUpload(owner) { this.run("UPDATE admissions SET uploading=0,grant=NULL,grant_until=NULL,heartbeat=? WHERE owner=?", this.now(), owner); }
  accept(id, owner, admission, payload) {
    return this.transaction(() => {
      if (this.get("SELECT id FROM cancellations WHERE id=? AND owner=?", id, owner)) throw Object.assign(new Error("This answer was discarded."), { status: 409 });
      const old = this.get("SELECT * FROM jobs WHERE id=?", id);
      if (old) {
        if (old.owner !== owner || old.state === "canceled") throw Object.assign(new Error("Submission ID unavailable."), { status: 409 });
        return old;
      }
      const row = this.get("SELECT * FROM admissions WHERE id=? AND owner=? AND state='admitted' AND uploading=1", admission, owner);
      if (!row) throw Object.assign(new Error("Admission expired."), { status: 409 });
      this.run("INSERT INTO jobs(id,owner,admission,state,created,updated,payload) VALUES(?,?,?,'queued',?,?,?)", id, owner, admission, this.now(), this.now(), JSON.stringify(payload));
      this.run("UPDATE admissions SET state='submitted',uploading=0,grant=NULL,grant_until=NULL WHERE id=?", admission);
      return this.get("SELECT * FROM jobs WHERE id=?", id);
    });
  }
  claim() {
    return this.transaction(() => {
      this.run("UPDATE jobs SET state='queued',token=NULL,lease=NULL,recovery_count=recovery_count+1 WHERE state='processing' AND lease<?", this.now());
      if (this.get("SELECT count(*) AS n FROM jobs WHERE state='processing'").n >= 4) return null;
      const row = this.get("SELECT * FROM jobs WHERE state='queued' ORDER BY created,rowid LIMIT 1");
      if (!row) return null;
      const token = crypto.randomUUID();
      this.run("UPDATE jobs SET state='processing',token=?,lease=?,started=coalesce(started,?),updated=? WHERE id=?", token, this.now() + 30000, this.now(), this.now(), row.id);
      return { ...row, token, payload: JSON.parse(row.payload), checkpoint: JSON.parse(row.checkpoint) };
    });
  }
  alive(id, token) { return Boolean(this.get("SELECT id FROM jobs WHERE id=? AND token=? AND state='processing' AND lease>=?", id, token, this.now())); }
  renew(id, token) { return this.run("UPDATE jobs SET lease=? WHERE id=? AND token=? AND state='processing'", this.now() + 30000, id, token).changes; }
  checkpoint(id, token, checkpoint) { return this.run("UPDATE jobs SET checkpoint=?,updated=? WHERE id=? AND token=? AND state='processing'", JSON.stringify(checkpoint), this.now(), id, token).changes; }
  stage(id, token, stage) { this.run("UPDATE jobs SET stage=?,stage_started=?,retry_at=NULL WHERE id=? AND token=? AND state='processing'", stage, this.now(), id, token); }
  sample(stage, duration, category = "long") {
    this.run("INSERT INTO samples(stage,category,duration,created) VALUES(?,?,?,?)", stage, category, Math.round(duration), this.now());
    this.run("DELETE FROM samples WHERE stage=? AND category=? AND id NOT IN (SELECT id FROM samples WHERE stage=? AND category=? ORDER BY id DESC LIMIT 30)", stage, category, stage, category);
  }
  finish(id, token, result) {
    return this.transaction(() => {
      const row = this.get("SELECT * FROM jobs WHERE id=? AND token=? AND state='processing'", id, token);
      if (!row) return false;
      const state = result.evaluation?.status === "completed" ? "completed" : "failed";
      this.run("UPDATE jobs SET state=?,result=?,updated=?,lease=NULL,retry_at=NULL,projected=0 WHERE id=?", state, JSON.stringify(result), this.now(), id);
      this.run("DELETE FROM admissions WHERE id=?", row.admission);
      const previous = Number(this.setting("lastRelease") || 0);
      if (previous && this.now() - previous < 3600000) this.sample("release", this.now() - previous);
      this.setting("lastRelease", this.now());
      this.sweep();
      return true;
    });
  }
  cancel(id, owner) {
    return this.transaction(() => {
      this.run("INSERT OR IGNORE INTO cancellations(id,owner) VALUES(?,?)", id, owner);
      const row = this.get("SELECT * FROM jobs WHERE id=? AND owner=?", id, owner);
      if (!row) return false;
      const payload = JSON.parse(row.payload);
      this.run("UPDATE jobs SET state='canceled',result=NULL,checkpoint='{}',payload=?,projected=0,updated=? WHERE id=?", JSON.stringify({ inputPath: payload.inputPath, record: { filename: payload.record?.filename } }), this.now(), id);
      this.run("DELETE FROM attempts WHERE job=?", id);
      this.run("DELETE FROM telemetry WHERE job=?", id);
      this.run("DELETE FROM admissions WHERE id=?", row.admission);
      this.sweep();
      return true;
    });
  }
  estimate(target) {
    if (terminal.has(target.state)) return { low: 0, high: 0 };
    if (this.processingDelay()) return null;
    const durations = {};
    const category = JSON.parse(target.checkpoint).category || "long";
    for (const stage of stages) {
      const samples = this.all("SELECT duration FROM samples WHERE stage=? AND category=? ORDER BY id DESC LIMIT 30", stage, category).map(s => s.duration).sort((a, b) => a - b);
      if (samples.length < 3) return null;
      durations[stage] = [samples[Math.floor(samples.length * 0.5)], samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.9))]];
    }
    const jobs = this.all("SELECT * FROM jobs WHERE state IN ('queued','processing') ORDER BY CASE state WHEN 'processing' THEN 0 ELSE 1 END,created,rowid");
    const simulate = (index) => {
      const slots = Object.fromEntries(stages.map(s => [s, Array(limits[s]).fill(0)]));
      slots.normalized = slots.media;
      const pipelines = Array(4).fill(0);
      for (const job of jobs) {
        const lane = pipelines.indexOf(Math.min(...pipelines));
        let ready = Math.max(pipelines[lane], (job.retry_at || 0) - this.now(), 0);
        const checkpoint = JSON.parse(job.checkpoint);
        for (const stage of stages) {
          if (checkpoint[stage]) continue;
          const times = slots[stage];
          const slot = times.indexOf(Math.min(...times));
          let duration = durations[stage][index];
          const progress = checkpoint.progress;
          if (job.state === "processing" && progress?.stage === stage) {
            const worked = progress.workedMs + (progress.activeSince ? Math.max(0, this.now() - progress.activeSince) : 0);
            duration = Math.max(duration * 0.2, duration - worked);
          }
          ready = Math.max(ready, times[slot]) + duration;
          times[slot] = ready;
        }
        pipelines[lane] = ready;
        if (job.id === target.id) return Math.ceil(ready / 1000);
      }
      return null;
    };
    return { low: simulate(0), high: simulate(1) };
  }
  status(id, owner) {
    const job = this.get("SELECT * FROM jobs WHERE id=? AND owner=?", id, owner);
    if (!job) return null;
    const result = job.result ? JSON.parse(job.result) : {};
    const { openId, user, userId, jobNumber, email, orgEmail, ...clientResult } = result;
    return { ...clientResult, ok: true, id, jobId: id, state: job.state, stage: job.stage, statusUrl: `/api/jobs/${id}`, queuePosition: job.state === "queued" ? this.get("SELECT count(*) AS n FROM jobs WHERE state='queued' AND rowid <= (SELECT rowid FROM jobs WHERE id=?)", id).n : 0, elapsedSeconds: Math.floor((this.now() - job.created) / 1000), estimatedRemainingSeconds: this.estimate(job), delayed: terminal.has(job.state) ? null : this.processingDelay() || (job.retry_at > this.now() ? "Waiting for the evaluation service to recover." : null), pollAfterSeconds: 5 };
  }
  metrics() {
    return { capacity: this.capacity, waitingCapacity: this.waiting, admissions: this.all("SELECT state,count(*) AS count FROM admissions GROUP BY state"), jobs: this.all("SELECT state,stage,count(*) AS count FROM jobs GROUP BY state,stage"), pressure: this.pressure(), paused: this.setting("paused") === "true", workerLastSeen: Number(this.setting("workerHeartbeat") || 0), resources: JSON.parse(this.setting("workerResources") || "{}"), stages: this.all("SELECT stage,round(avg(duration)) AS averageMs,count(*) AS samples FROM samples WHERE created>? GROUP BY stage", this.now() - 86400000), recent: this.all("SELECT stage,created,data FROM telemetry ORDER BY id DESC LIMIT 50").map(r => ({ ...r, data: JSON.parse(r.data) })) };
  }
  close() { this.db.close(); }
}
module.exports = { Queue, terminal };

const { AsyncLocalStorage } = require("node:async_hooks");
const { spawn } = require("node:child_process");
const ffmpeg = require("ffmpeg-static");
const { mediaConcurrency, mediaPipelineVersion } = require("./media-config");
const context = new AsyncLocalStorage();
const { ModelGuard, tokenReservation, modelConcurrency } = require("./model-guard");
const guards = new WeakMap();
let modelQueue = null;
function modelGuard(queue = modelQueue) {
  if (!queue) return null;
  if (!guards.has(queue)) guards.set(queue, new ModelGuard(queue));
  return guards.get(queue);
}
function retryAfter(response) {
  const header = response?.headers.get("retry-after");
  const ms = header ? (/^\d+(\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now()) : 0;
  return Number.isFinite(ms) ? Math.max(0, ms) : 0;
}

class Semaphore {
  constructor(limit) { this.limit = limit; this.active = 0; this.peak = 0; this.waiters = []; }
  async run(fn, signal) {
    signal?.throwIfAborted();
    if (this.active >= this.limit) await new Promise((resolve, reject) => {
      const entry = { resolve: () => { signal?.removeEventListener("abort", abort); resolve(); } };
      const abort = () => { this.waiters = this.waiters.filter(item => item !== entry); reject(signal.reason); };
      signal?.addEventListener("abort", abort, { once: true });
      this.waiters.push(entry);
    });
    else { this.active++; this.peak = Math.max(this.peak, this.active); }
    try { signal?.throwIfAborted(); return await fn(); }
    finally {
      const next = this.waiters.shift();
      if (next) next.resolve(); else this.active--;
    }
  }
}
const gates = { ffmpeg: new Semaphore(mediaConcurrency()), ...Object.fromEntries(["transcription", "scoring", "question"].map(kind => [kind, new Semaphore(modelConcurrency(kind))])) };
let questionObserver = null;
const delay = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
});

function runMedia(args, { probe = false } = {}) {
  const signal = context.getStore()?.signal;
  return gates.ffmpeg.run(() => measureResource(() => new Promise((resolve, reject) => {
    const outputArgs = probe ? args : [...args.slice(0, -1), "-threads", "1", args.at(-1)];
    const child = probe
      ? spawn(require("@ffprobe-installer/ffprobe").path, args)
      : spawn(ffmpeg, ["-nostdin", "-hide_banner", "-nostats", "-threads", "1", "-filter_threads", "1", "-filter_complex_threads", "1", ...outputArgs]);
    let output = "";
    let stdout = "";
    let stopped = false;
    let settled = false;
    const stop = () => { stopped = true; child.kill("SIGKILL"); };
    const timer = setTimeout(stop, Number(process.env.FFMPEG_TIMEOUT_MS) || 180000);
    signal?.addEventListener("abort", stop, { once: true });
    child.stderr.on("data", chunk => { output = (output + chunk.toString()).slice(-65536); });
    child.stdout.on("data", chunk => {
      if (probe) {
        stdout += chunk.toString();
        if (stdout.length > 1024 * 1024) stop();
      }
    });
    const finish = (error, code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      if (signal?.aborted) reject(signal.reason);
      else if (stopped) reject(new Error("Media processing timed out."));
      else if (error) reject(error);
      else if (code === 0) resolve(probe ? stdout : output);
      else reject(new Error(output || `FFmpeg exited with code ${code}`));
    };
    child.on("error", error => finish(error));
    child.on("close", code => finish(null, code));
  })), signal);
}

async function measureResource(fn) {
  const task = context.getStore();
  if (!task?.checkpoint.progress) return fn();
  const progress = task.checkpoint.progress;
  progress.activeSince = Date.now();
  task.queue.checkpoint(task.id, task.token, task.checkpoint);
  try { return await fn(); }
  finally {
    progress.workedMs += Date.now() - progress.activeSince;
    progress.activeSince = null;
    task.queue.checkpoint(task.id, task.token, task.checkpoint);
  }
}

async function modelFetch(url, options, kind, key = kind) {
  const task = context.getStore();
  // Existing helper tests exercise the direct request contract without a worker.
  if (!task && !modelQueue && process.env.NODE_ENV === "test") return fetch(url, options);
  const cached = task?.checkpoint.network?.[key];
  if (cached) return new Response(cached, { status: 200, headers: { "Content-Type": "application/json" } });
  const timeout = kind === "scoring" ? Number(process.env.EVAL_REQUEST_TIMEOUT_MS) || 600000 : kind === "question" ? 45000 : 120000;
  const guard = modelGuard(task?.queue);
  const signal = AbortSignal.any([options.signal, task?.signal, kind === "question" ? AbortSignal.timeout(timeout) : null].filter(Boolean));
  const reservedTokens = guard ? tokenReservation(options, kind) : 0;
  const prior = task ? task.queue.get("SELECT count,retry_at FROM attempts WHERE job=? AND key=?", task.id, key) : null;
  if (prior?.retry_at > Date.now()) await delay(prior.retry_at - Date.now(), task.signal);
  let count = prior?.count || 0;
  let last;
  while (count < 3) {
    count++;
    signal.throwIfAborted();
    const started = Date.now();
    let response;
    try {
      response = await gates[kind].run(async () => {
        let permit;
        while (guard) {
          signal.throwIfAborted();
          permit = guard.acquire(kind, reservedTokens, timeout);
          if (permit.id) break;
          if (kind === "question") throw Object.assign(new Error("Question service is busy; a saved fallback is available."), { code: "MODEL_BUSY", retryAfter: Math.ceil(permit.waitMs / 1000) });
          task?.queue.run("UPDATE jobs SET retry_at=? WHERE id=? AND token=?", Date.now() + permit.waitMs, task.id, task.token);
          await delay(Math.min(permit.waitMs, 5000) + Math.random() * 100, signal);
        }
        let outcome = {};
        try {
          signal.throwIfAborted();
          if (task) {
            if (!task.queue.alive(task.id, task.token)) throw new Error("Worker lease expired.");
            task.queue.run("INSERT INTO attempts(job,key,count) VALUES(?,?,?) ON CONFLICT(job,key) DO UPDATE SET count=excluded.count", task.id, key, count);
            task.queue.run("UPDATE jobs SET retry_at=NULL WHERE id=? AND token=?", task.id, task.token);
          }
          return await measureResource(async () => {
            const raw = await fetch(url, { ...options, signal: AbortSignal.any([AbortSignal.timeout(timeout), signal]) });
            outcome = { status: raw.status, retryMs: retryAfter(raw) };
            const reader = raw.body?.getReader();
            const chunks = [];
            let size = 0;
            if (reader) while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.length;
              if (size > 10 * 1024 * 1024) { await reader.cancel(); throw new Error("Model response is too large."); }
              chunks.push(Buffer.from(value));
            }
            const body = Buffer.concat(chunks);
            if (raw.ok) try {
              const usage = JSON.parse(body.toString()).usage;
              const tokens = usage?.total_tokens ?? (Number.isSafeInteger(usage?.prompt_tokens) && Number.isSafeInteger(usage?.completion_tokens) ? usage.prompt_tokens + usage.completion_tokens : null);
              if (Number.isSafeInteger(tokens) && tokens >= 0) outcome.tokens = tokens;
            } catch {}
            return new Response(body, { status: raw.status, headers: raw.headers });
          });
        } catch (error) {
          outcome = { status: 0, canceled: Boolean(task?.signal.aborted || options.signal?.aborted) };
          throw error;
        } finally { if (permit?.id) guard.finish(permit.id, outcome); }
      }, signal);
      if (task) task.queue.run("INSERT INTO telemetry(job,stage,created,data) VALUES(?,?,?,?)", task.id, kind, Date.now(), JSON.stringify({ durationMs: Date.now() - started, attempt: count, status: response.status }));
      if (kind === "question" && questionObserver) {
        let payload;
        if (response.ok) try { payload = await response.clone().json(); } catch {}
        questionObserver({ durationMs: Date.now() - started, attempt: count, status: response.status, promptTokens: payload?.usage?.prompt_tokens ?? null, completionTokens: payload?.usage?.completion_tokens ?? null });
      }
      if (response.ok) {
        if (task) {
          const text = await response.clone().text();
          task.checkpoint.network ||= {};
          task.checkpoint.network[key] = text;
          task.queue.checkpoint(task.id, task.token, task.checkpoint);
          let payload;
          try { payload = JSON.parse(text); } catch { /* Evaluation validation reports malformed JSON. */ }
          if (payload?.usage) task.queue.run("INSERT INTO telemetry(job,stage,created,data) VALUES(?,?,?,?)", task.id, kind, Date.now(), JSON.stringify({ model: typeof payload.model === "string" ? payload.model : null, provider: typeof payload.provider === "string" ? payload.provider : null, promptTokens: payload.usage.prompt_tokens ?? null, completionTokens: payload.usage.completion_tokens ?? null, cost: payload.usage.cost ?? null }));
        }
        return response;
      }
      if (response.status !== 429 && response.status < 500) return response;
      last = new Error(`Evaluation service returned HTTP ${response.status}.`);
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      last = error;
      if (!/fetch|network|socket|timeout|aborted|ECONN|ENOTFOUND/i.test(String(error.message))) throw error;
    }
    if (count === 3) {
      if (task && !guard) task.queue.setting("circuitUntil", Math.max(Number(task.queue.setting("circuitUntil") || 0), Date.now() + 60000));
      break;
    }
    const retryMs = retryAfter(response);
    const waitMs = Math.max(Number.isFinite(retryMs) ? retryMs : 0, 1000 * 2 ** (count - 1) + Math.random() * 500);
    if (task) {
      task.queue.run("UPDATE jobs SET retry_at=? WHERE id=? AND token=?", Date.now() + waitMs, task.id, task.token);
      task.queue.run("UPDATE attempts SET status=?,retry_at=? WHERE job=? AND key=?", response?.status || 0, Date.now() + waitMs, task.id, key);
      if (response?.status === 429 && !guard) task.queue.setting("circuitUntil", Math.max(Number(task.queue.setting("circuitUntil") || 0), Date.now() + waitMs));
    }
    if (kind === "question" && response?.status === 429) throw Object.assign(new Error("Question service is cooling down."), { code: "MODEL_BUSY", retryAfter: Math.ceil(waitMs / 1000) });
    await delay(waitMs, signal);
  }
  throw last || new Error("Evaluation service retry limit reached.");
}
async function stage(name, fn) {
  const task = context.getStore();
  if (!task) return fn();
  if (Object.hasOwn(task.checkpoint, name)) return task.checkpoint[name];
  task.signal.throwIfAborted();
  const previous = task.checkpoint.progress?.stage === name ? task.checkpoint.progress : null;
  const start = previous?.startedAt || (previous && task.stage_started) || Date.now();
  task.queue.stage(task.id, task.token, name);
  task.checkpoint.progress = { stage: name, startedAt: start, workedMs: previous?.workedMs || 0, activeSince: null };
  const value = await fn();
  task.signal.throwIfAborted();
  task.checkpoint[name] = value;
  if (!task.queue.checkpoint(task.id, task.token, task.checkpoint)) throw new Error("Worker lease expired.");
  const wallMs = Date.now() - start;
  const activeMs = task.checkpoint.progress.workedMs || wallMs;
  const pipeline = task.checkpoint.pipelineVersion || mediaPipelineVersion;
  task.queue.sample(name, activeMs, task.checkpoint.category || "long", pipeline);
  task.queue.run("INSERT INTO telemetry(job,stage,created,data) VALUES(?,?,?,?)", task.id, name, Date.now(), JSON.stringify({ event: "stage-completed", pipeline, category: task.checkpoint.category || "long", activeMs, wallMs, waitingMs: Math.max(0, wallMs - activeMs), normalization: task.checkpoint.normalized?.normalization || null }));
  return value;
}
module.exports = { context, Semaphore, runMedia, modelFetch, delay, stage, modelGuard, setModelQueue: queue => { modelQueue = queue; modelGuard(queue); }, resources: () => Object.fromEntries(Object.entries(gates).map(([key, gate]) => [key, { limit: gate.limit, active: gate.active, peak: gate.peak, waiting: gate.waiters.length }])), setQuestionObserver: observer => { questionObserver = observer; } };

const { AsyncLocalStorage } = require("node:async_hooks");
const { spawn } = require("node:child_process");
const ffmpeg = require("ffmpeg-static");
const context = new AsyncLocalStorage();

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
const gates = { ffmpeg: new Semaphore(1), transcription: new Semaphore(2), scoring: new Semaphore(2), question: new Semaphore(2) };
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
    const child = spawn(ffmpeg, ["-nostdin", "-threads", "1", "-filter_threads", "1", "-filter_complex_threads", "1", ...outputArgs]);
    let output = "";
    let stopped = false;
    const stop = () => { stopped = true; child.kill("SIGKILL"); };
    const timer = setTimeout(stop, Number(process.env.FFMPEG_TIMEOUT_MS) || 180000);
    signal?.addEventListener("abort", stop, { once: true });
    child.stderr.on("data", chunk => { output = (output + chunk.toString()).slice(-65536); });
    const finish = (error, code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      if (signal?.aborted) reject(signal.reason);
      else if (stopped) reject(new Error("Media processing timed out."));
      else if (error) reject(error);
      else if (code === 0 || probe) resolve(output);
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
  if (!task && process.env.NODE_ENV === "test") return fetch(url, options);
  const cached = task?.checkpoint.network?.[key];
  if (cached) return new Response(cached, { status: 200, headers: { "Content-Type": "application/json" } });
  const timeout = kind === "scoring" ? Number(process.env.EVAL_REQUEST_TIMEOUT_MS) || 600000 : kind === "question" ? 45000 : 120000;
  const prior = task ? task.queue.get("SELECT count,retry_at FROM attempts WHERE job=? AND key=?", task.id, key) : null;
  if (prior?.retry_at > Date.now()) await delay(prior.retry_at - Date.now(), task.signal);
  let count = prior?.count || 0;
  let last;
  while (count < 3) {
    count++;
    task?.signal.throwIfAborted();
    const cooldown = task ? Number(task.queue.setting("circuitUntil") || 0) - Date.now() : 0;
    if (cooldown > 0) await delay(cooldown, task.signal);
    if (task) {
      if (!task.queue.alive(task.id, task.token)) throw new Error("Worker lease expired.");
      task.queue.run("INSERT INTO attempts(job,key,count) VALUES(?,?,?) ON CONFLICT(job,key) DO UPDATE SET count=excluded.count", task.id, key, count);
    }
    const started = Date.now();
    let response;
    try {
      response = await gates[kind].run(() => measureResource(async () => {
        const signals = [AbortSignal.timeout(timeout), options.signal, task?.signal].filter(Boolean);
        const raw = await fetch(url, { ...options, signal: AbortSignal.any(signals) });
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
        return new Response(Buffer.concat(chunks), { status: raw.status, headers: raw.headers });
      }), task?.signal);
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
      if (task?.signal.aborted) throw task.signal.reason;
      last = error;
      if (!/fetch|network|socket|timeout|aborted|ECONN|ENOTFOUND/i.test(String(error.message))) throw error;
    }
    if (count === 3) {
      if (task) task.queue.setting("circuitUntil", Math.max(Number(task.queue.setting("circuitUntil") || 0), Date.now() + 60000));
      break;
    }
    const header = response?.headers.get("retry-after");
    const retryMs = header ? (/^\d+(\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now()) : 0;
    const waitMs = Math.max(Number.isFinite(retryMs) ? retryMs : 0, 1000 * 2 ** (count - 1) + Math.random() * 500);
    if (task) {
      task.queue.run("UPDATE jobs SET retry_at=? WHERE id=? AND token=?", Date.now() + waitMs, task.id, task.token);
      task.queue.run("UPDATE attempts SET status=?,retry_at=? WHERE job=? AND key=?", response?.status || 0, Date.now() + waitMs, task.id, key);
      if (response?.status === 429) task.queue.setting("circuitUntil", Math.max(Number(task.queue.setting("circuitUntil") || 0), Date.now() + waitMs));
    }
    await delay(waitMs, task?.signal);
  }
  throw last || new Error("Evaluation service retry limit reached.");
}
async function stage(name, fn) {
  const task = context.getStore();
  if (!task) return fn();
  if (Object.hasOwn(task.checkpoint, name)) return task.checkpoint[name];
  task.signal.throwIfAborted();
  task.queue.stage(task.id, task.token, name);
  const start = Date.now();
  task.checkpoint.progress = { stage: name, workedMs: 0, activeSince: null };
  const value = await fn();
  task.signal.throwIfAborted();
  task.checkpoint[name] = value;
  if (!task.queue.checkpoint(task.id, task.token, task.checkpoint)) throw new Error("Worker lease expired.");
  task.queue.sample(name, task.checkpoint.progress.workedMs || Date.now() - start, task.checkpoint.category || "long");
  return value;
}
module.exports = { context, Semaphore, runMedia, modelFetch, delay, stage, resources: () => Object.fromEntries(Object.entries(gates).map(([key, gate]) => [key, { active: gate.active, peak: gate.peak, waiting: gate.waiters.length }])), setQuestionObserver: observer => { questionObserver = observer; } };

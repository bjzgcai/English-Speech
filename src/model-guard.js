const { randomUUID } = require("node:crypto");

const defaults = {
  internal: { concurrent: 3, rpm: 30, tpm: 120000 },
  question: { concurrent: 2, rpm: 20, tpm: 120000 },
  transcription: { concurrent: 2, rpm: 20, tpm: 0 },
  scoring: { concurrent: 2, rpm: 12, tpm: 300000 },
};
const scopesFor = kind => kind === "scoring" ? [kind] : [kind, "internal"];
const kindsFor = scope => scope === "internal" ? ["question", "transcription"] : [scope];

class ModelGuard {
  constructor(queue, { now = Date.now, limits = defaults } = {}) {
    this.queue = queue;
    this.now = now;
    this.limits = Object.fromEntries(Object.entries(limits).map(([scope, values]) => [scope,
      Object.fromEntries(Object.entries(values).map(([key, fallback]) => {
        const raw = process.env[`MODEL_${scope.toUpperCase()}_${key.toUpperCase()}`];
        const value = raw === undefined ? fallback : Number(raw);
        if (!Number.isSafeInteger(value) || value < (key === "tpm" && scope === "transcription" ? 0 : 1)) throw new Error(`Invalid model limit: ${scope}.${key}`);
        return [key, value];
      }))]));
    queue.db.exec(`
      CREATE TABLE IF NOT EXISTS model_requests(id TEXT PRIMARY KEY, kind TEXT NOT NULL, started INTEGER NOT NULL, expires INTEGER NOT NULL, finished INTEGER, tokens INTEGER NOT NULL, generations TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS model_requests_started ON model_requests(started);
      CREATE TABLE IF NOT EXISTS model_circuits(scope TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0, until INTEGER NOT NULL DEFAULT 0, generation INTEGER NOT NULL DEFAULT 0);
    `);
    for (const scope of Object.keys(this.limits)) queue.run("INSERT OR IGNORE INTO model_circuits(scope) VALUES(?)", scope);
  }
  usage(scope) {
    const kinds = kindsFor(scope);
    return this.queue.get(`SELECT
      count(CASE WHEN finished IS NULL AND expires>? THEN 1 END) AS active,
      count(CASE WHEN started>? THEN 1 END) AS requests,
      coalesce(sum(CASE WHEN coalesce(finished,expires)>? THEN tokens ELSE 0 END),0) AS tokens
      FROM model_requests WHERE kind IN (${kinds.map(() => "?").join(",")})`, this.now(), this.now() - 60000, this.now() - 60000, ...kinds);
  }
  acquire(kind, tokens, timeout) {
    return this.queue.transaction(() => {
      const now = this.now();
      this.queue.run("DELETE FROM model_requests WHERE coalesce(finished,expires)<?", now - 60000);
      const generations = {};
      for (const scope of scopesFor(kind)) {
        const limit = this.limits[scope];
        const circuit = this.queue.get("SELECT * FROM model_circuits WHERE scope=?", scope);
        const usage = this.usage(scope);
        if (limit.tpm && tokens > limit.tpm) throw Object.assign(new Error("Model input exceeds the configured token budget."), { code: "MODEL_BUDGET_EXCEEDED" });
        if (circuit.until > now) return { waitMs: circuit.until - now, reason: "circuit" };
        // One probe after cooldown, across every process sharing this database.
        if (usage.active >= limit.concurrent || (circuit.until && usage.active)) return { waitMs: 1000, reason: "concurrency" };
        if (usage.requests >= limit.rpm || (limit.tpm && usage.tokens + tokens > limit.tpm)) return { waitMs: 1000, reason: "quota" };
        generations[scope] = circuit.generation;
      }
      const id = randomUUID();
      this.queue.run("INSERT INTO model_requests VALUES(?,?,?,?,NULL,?,?)", id, kind, now, now + timeout + 5000, tokens, JSON.stringify(generations));
      return { id };
    });
  }
  finish(id, { status = 0, retryMs = 0, tokens = null, canceled = false } = {}) {
    this.queue.transaction(() => {
      const request = this.queue.get("SELECT * FROM model_requests WHERE id=? AND finished IS NULL", id);
      if (!request) return;
      const now = this.now();
      this.queue.run("UPDATE model_requests SET finished=?,tokens=? WHERE id=?", now,
        Number.isSafeInteger(tokens) && tokens >= 0 ? tokens : request.tokens, id);
      if (!canceled) for (const scope of scopesFor(request.kind)) {
        const circuit = this.queue.get("SELECT * FROM model_circuits WHERE scope=?", scope);
        if (status >= 200 && status < 300) {
          if (JSON.parse(request.generations)[scope] === circuit.generation) this.queue.run("UPDATE model_circuits SET failures=0,until=0 WHERE scope=?", scope);
        } else if (!status || status === 429 || status >= 500) {
          const failures = circuit.failures + 1;
          const until = status === 429 || failures >= 3 || circuit.until
            ? Math.max(circuit.until, now + Math.max(retryMs, status === 429 ? 1000 : 60000)) : circuit.until;
          this.queue.run("UPDATE model_circuits SET failures=?,until=?,generation=generation+1 WHERE scope=?", failures, until, scope);
        }
      }
      // Keep existing admission, estimate and independent monitoring consumers compatible.
      this.queue.setting("circuitUntil", this.queue.get("SELECT max(until) AS value FROM model_circuits").value || 0);
    });
  }
  metrics() {
    return Object.entries(this.limits).map(([scope, limits]) => ({ scope, limits, ...this.usage(scope),
      ...this.queue.get("SELECT failures,until AS circuitUntil FROM model_circuits WHERE scope=?", scope) }));
  }
}

function tokenReservation(options, kind) {
  if (kind === "transcription") return 0;
  const body = JSON.parse(options.body || "{}");
  let input = 0;
  for (const message of body.messages || []) {
    input += 32;
    if (typeof message.content === "string") input += Buffer.byteLength(message.content);
    else for (const part of message.content || []) input += part.type === "image_url" ? 4096 : Buffer.byteLength(part.text || "");
  }
  // UTF-8 bytes conservatively reserve text; image tokens depend on the provider.
  return input + (body.max_tokens || (kind === "question" ? 4096 : 16384));
}
function modelConcurrency(kind, value = process.env[`MODEL_${kind.toUpperCase()}_CONCURRENT`]) {
  const limit = value === undefined ? defaults[kind].concurrent : Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error(`Invalid model limit: ${kind}.concurrent`);
  return limit;
}

module.exports = { ModelGuard, tokenReservation, defaults, modelConcurrency };

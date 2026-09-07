const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;
const recoveryMs = 180000;
const monitorFile = recordings => path.join(recordings, "monitor", "alerts.sqlite");

class AlertStore {
  constructor(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA busy_timeout=500; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS alerts(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, key TEXT NOT NULL, created INTEGER NOT NULL,
        level INTEGER NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0, receipt TEXT);
      CREATE INDEX IF NOT EXISTS events_pending ON events(status,next_at);`);
  }
  get(key) { const row = this.db.prepare("SELECT value FROM state WHERE key=?").get(key); return row ? JSON.parse(row.value) : null; }
  set(key, value) { this.db.prepare("INSERT INTO state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(value)); }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  recoverDelivery() { this.db.prepare("UPDATE events SET status='unknown',receipt=? WHERE status='sending'").run(JSON.stringify({ code: "interrupted_delivery" })); }
  close() { this.db.close(); }
}

function rulesFor(sample, maintenance) {
  const rules = [];
  const add = (key, label, warn, critical, clear, warningMs, criticalMs, detail) => rules.push({ key, label, warn, critical, clear, warningMs, criticalMs, detail });
  const reservations = sample.queue?.reservedBytes ?? 50 * 512 * MiB;
  for (const disk of sample.disks || []) {
    const headroom = disk.available - (disk.data ? reservations || 0 : 0);
    const used = disk.usedPercent;
    add(`disk:${disk.device}`, "磁盘空间", used >= 80 || headroom < 10 * GiB,
      used >= 90 || headroom < 5 * GiB + (disk.data ? 512 * MiB : 0),
      used < 75 && headroom > 12 * GiB && (!disk.data || sample.queue != null), 120000, 0,
      `${disk.paths.join(", ")}: 使用 ${used.toFixed(1)}%，可用 ${(disk.available / GiB).toFixed(2)} GiB，扣除提交预留后 ${(headroom / GiB).toFixed(2)} GiB；预警 80%/10 GiB，严重 90%/容量保护线`);
  }
  const memory = sample.memoryAvailable;
  if (memory != null) add("memory", "主机可用内存", memory < 768 * MiB, memory < 512 * MiB, memory > GiB, 120000, 30000,
    `可用 ${(memory / MiB).toFixed(0)} MiB；预警 <768 MiB，严重 <512 MiB`);
  if (sample.cpuPercent != null) add("cpu", "主机 CPU", sample.cpuPercent >= 90,
    sample.cpuPercent >= 97 && sample.health.latencyMs > 1000, sample.cpuPercent < 80, 300000, 300000,
    `总使用率 ${sample.cpuPercent.toFixed(1)}%，健康请求 ${Math.round(sample.health.latencyMs)} ms；预警 ≥90%，严重 ≥97% 且请求 >1000 ms`);
  for (const service of sample.services || []) {
    if (!maintenance) add(`service:${service.name}`, "应用服务", false, !service.active, service.active, 0, 60000, `${service.name}: ${service.active ? "运行中" : "不可用"}；持续 60 秒告警`);
    if (service.memoryMax > 0 && service.memoryCurrent != null) {
      const ratio = service.memoryCurrent / service.memoryMax;
      add(`service-memory:${service.name}`, "服务内存", ratio >= 0.8, ratio >= 0.95 || service.oom,
        ratio < 0.7 && !service.oom, 120000, service.oom ? 0 : 30000,
        `${service.name}: ${(service.memoryCurrent / MiB).toFixed(0)}/${(service.memoryMax / MiB).toFixed(0)} MiB (${(ratio * 100).toFixed(1)}%)${service.oom ? "，发生 OOM" : ""}；预警 80%，严重 95%/OOM`);
    } else if (service.oom) add(`service-memory:${service.name}`, "服务内存", false, true, false, 0, 0, `${service.name}: 发生 OOM`);
  }
  if (!maintenance) {
    add("web-health", "健康接口", false, !sample.health.ok, sample.health.ok, 0, 60000,
      `健康接口 ${sample.health.ok ? "正常" : "不可用"}；持续 60 秒告警`);
    add("queue-read", "评估队列读取", false, !sample.queue, Boolean(sample.queue), 0, 60000, `队列${sample.queue ? "可读取" : "无法读取"}；持续 60 秒告警`);
    if (sample.queue) add("worker-heartbeat", "评估 worker 心跳", false, sample.at - sample.queue.workerHeartbeat > 30000,
      sample.at - sample.queue.workerHeartbeat <= 30000, 0, 60000,
      `心跳距今 ${Math.max(0, Math.round((sample.at - sample.queue.workerHeartbeat) / 1000))} 秒；过期 >30 秒并持续 60 秒告警`);
  }
  if (sample.queue) {
    add("waiting-room", "等候室", sample.queue.waiting >= 160, sample.queue.waiting >= 200, sample.queue.waiting < 140, 120000, 30000,
      `${sample.queue.waiting}/200 人等待，${sample.queue.outstanding}/50 人已准入；预警 160 人，严重 200 人`);
    add("upstream", "上游评估服务", sample.queue.circuitUntil > sample.at, false, sample.queue.circuitUntil <= sample.at, 120000, 0,
      `上游熔断${sample.queue.circuitUntil > sample.at ? "中" : "已关闭"}；持续 120 秒告警`);
  }
  add("collector", "资源采集", false, Boolean(sample.errors?.length), !sample.errors?.length, 0, 60000,
    `采集状态：${sample.errors?.join(", ") || "正常"}`);
  return rules;
}

function applySample(store, sample, { host = "10.1.130.9", adminUrl = "https://eng.lab.bza.edu.cn/admin" } = {}) {
  return store.transaction(() => {
    const previous = store.get("heartbeat");
    const maintenance = Number(store.get("maintenanceUntil") || 0) > sample.at;
    const interrupted = previous && sample.at - previous > 90000;
    const rules = rulesFor(sample, maintenance);
    rules.push({ key: "monitor-gap", label: "监测中断", warn: Boolean(interrupted), critical: false, clear: !interrupted,
      warningMs: 0, criticalMs: 0, detail: `监测中断 ${previous ? Math.round((sample.at - previous) / 1000) : 0} 秒，现已恢复采样；阈值 90 秒` });
    const rows = new Map(store.db.prepare("SELECT key,value FROM alerts").all().map(row => [row.key, JSON.parse(row.value)]));
    for (const rule of rules) {
      const state = rows.get(rule.key) || { level: 0, peak: 0, firstAt: null, warningSince: null, criticalSince: null, clearSince: null };
      // Unknown intervals cannot prove a sustained breach or a sustained recovery.
      if (interrupted) state.warningSince = state.criticalSince = state.clearSince = null;
      state.warningSince = rule.warn ? state.warningSince ?? sample.at : null;
      state.criticalSince = rule.critical ? state.criticalSince ?? sample.at : null;
      state.clearSince = rule.clear ? state.clearSince ?? sample.at : null;
      const level = state.criticalSince !== null && sample.at - state.criticalSince >= rule.criticalMs ? 2
        : state.warningSince !== null && sample.at - state.warningSince >= rule.warningMs && rule.warningMs !== undefined ? 1 : 0;
      let eventLevel = null;
      if (level > state.peak) {
        state.firstAt ??= state.warningSince ?? state.criticalSince ?? sample.at;
        state.level = state.peak = level;
        eventLevel = level;
      } else if (state.level && state.clearSince !== null && sample.at - state.clearSince >= recoveryMs) {
        eventLevel = 0;
        state.level = state.peak = 0;
      }
      state.label = rule.label; state.detail = rule.detail; state.updated = sample.at;
      if (eventLevel !== null) {
        const id = crypto.randomUUID();
        const impact = maintenance ? "计划维护中" : sample.queue?.paused ? "管理员已暂停准入"
          : sample.queue && sample.queue.workerHeartbeat >= sample.at - 30000 && sample.queue.circuitUntil <= sample.at && sample.memoryAvailable >= 512 * MiB && !rules.some(r => r.key.startsWith("disk:") && r.critical) ? "未检测到资源准入保护条件" : "可能暂停新准入，请查看管理页";
        const body = `【EnglishEval ${eventLevel === 0 ? "恢复" : eventLevel === 2 ? "严重告警" : "预警"}】\n服务器：${host}\n指标：${rule.label}\n${rule.detail}\n事件持续：${Math.max(0, Math.round((sample.at - state.firstAt) / 1000))} 秒\n准入影响：${impact}\n时间：${new Date(sample.at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })} (Asia/Shanghai)\n管理页：${adminUrl}\n事件：${id}`;
        store.db.prepare("INSERT INTO events(id,key,created,level,body) VALUES(?,?,?,?,?)").run(id, rule.key, sample.at, eventLevel, body);
        if (eventLevel === 0) state.firstAt = null;
      }
      store.db.prepare("INSERT INTO alerts VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(rule.key, JSON.stringify(state));
    }
    // Freeze missing metrics and suppressed maintenance checks; never infer recovery from absence.
    const present = new Set(rules.map(rule => rule.key));
    for (const [key, state] of rows) if (!present.has(key)) {
      state.warningSince = state.criticalSince = state.clearSince = null;
      store.db.prepare("UPDATE alerts SET value=? WHERE key=?").run(JSON.stringify(state), key);
    }
    store.set("heartbeat", sample.at);
    store.set("sample", sample);
    store.db.prepare("DELETE FROM events WHERE status='sent' AND created<?").run(sample.at - 90 * 86400000);
  });
}

function readMonitorStatus(file, now = Date.now()) {
  if (!fs.existsSync(file)) return { available: false, stale: true, alerts: [], deliveries: [] };
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true }); db.exec("PRAGMA busy_timeout=100");
    const get = key => { const row = db.prepare("SELECT value FROM state WHERE key=?").get(key); return row ? JSON.parse(row.value) : null; };
    const heartbeat = get("heartbeat");
    return { available: true, heartbeat, stale: !heartbeat || now - heartbeat > 90000, maintenanceUntil: get("maintenanceUntil"), notificationsEnabled: get("notificationsEnabled") === true,
      sample: get("sample"), alerts: db.prepare("SELECT key,value FROM alerts").all().map(row => ({ key: row.key, ...JSON.parse(row.value) })).filter(row => row.level),
      deliveries: db.prepare("SELECT id,key,created,level,status,attempts,receipt FROM events ORDER BY created DESC,rowid DESC LIMIT 30").all() };
  } catch { return { available: false, stale: true, alerts: [], deliveries: [] }; }
  finally { db?.close(); }
}

module.exports = { AlertStore, applySample, rulesFor, readMonitorStatus, monitorFile, GiB, MiB };

#!/usr/bin/env node
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { stageMetrics } = require("../src/stage-metrics");

const arg = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const file = path.resolve(arg("database", "recordings/queue.sqlite"));
const hours = Number(arg("hours", "168"));
if (!Number.isFinite(hours) || hours <= 0) throw new Error("hours must be positive");
const db = new DatabaseSync(file, { readOnly: true });
try {
  const since = Date.now() - hours * 3600000;
  const stages = stageMetrics(db.prepare("SELECT stage,category,duration,created FROM samples WHERE created>? AND stage!='release'").all(since));
  const counts = db.prepare("SELECT state,count(*) AS count FROM jobs WHERE created>? GROUP BY state").all(since);
  const comparisons = stages.filter(row => row.stage === "normalized").map(normalized => {
    const peers = stages.filter(row => row.pipeline === normalized.pipeline && row.category === normalized.category);
    const transcription = peers.find(row => row.stage === "transcription");
    const scoring = peers.find(row => row.stage === "scoring");
    return {
      pipeline: normalized.pipeline, category: normalized.category,
      samples: Math.min(normalized.samples, transcription?.samples || 0, scoring?.samples || 0),
      normalizedExceedsTranscription: transcription ? { p50: normalized.p50Ms > transcription.p50Ms, p90: normalized.p90Ms > transcription.p90Ms } : null,
      normalizedExceedsScoring: scoring ? { p50: normalized.p50Ms > scoring.p50Ms, p90: normalized.p90Ms > scoring.p90Ms } : null,
    };
  });
  console.log(JSON.stringify({ hours, measuredAt: new Date().toISOString(), counts, stages, comparisons, note: "Active execution time, excluding resource waits. Rolling retained samples (up to 30 per stage, duration class and pipeline); small samples are descriptive, not a reliable production percentile estimate." }, null, 2));
} finally { db.close(); }

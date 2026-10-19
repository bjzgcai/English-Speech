// One-off: re-run the model scoring for a completed record whose stored
// evaluation is a false zero — a parseable model response whose rubric came
// back empty (all-zero scores, no feedback, no summary), which
// normalizeEvaluation silently turned into a "completed" 0. First seen on
// cf578a72 (2026-10-12).
//
// Reuses the stored transcript, audio metrics, and extracted artifacts; only
// the scoring request is re-sent, so nothing is re-transcribed or re-extracted.
// Run from a release root on the server:
//   node scripts/re-evaluate-answer-2026-10-19.js <recordId> [...]
// Set RE_EVALUATE_FORCE=1 to re-score a record that does not match the
// empty-rubric shape.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ids = process.argv.slice(2);
if (!ids.length) {
  console.error("usage: node re-evaluate-answer-2026-10-19.js <recordId> [...]");
  process.exit(2);
}

const config = require("../src/config");
const { testHelpers: { evaluateAnswer } } = require("../src/app");
const { readJsonLines, updateJsonLines } = require("../src/storage");

function storedEvaluationLooksEmpty(evaluation) {
  if (!evaluation || evaluation.status !== "completed") return false;
  const dimensions = Object.values(evaluation.rubric || {});
  const hasScore = dimensions.some((dimension) => Number(dimension?.score) > 0);
  const hasFeedback = dimensions.some((dimension) => String(dimension?.feedback || "").trim());
  // normalizeEvaluation substitutes "Evaluation completed." when the model
  // returned no summary, so that literal fallback counts as empty too.
  const summary = String(evaluation.summary || "").trim();
  return !hasScore && !hasFeedback && (!summary || summary === "Evaluation completed.");
}

function framePathsFor(id) {
  const framesDir = path.join(config.artifactsDir, id, "frames");
  if (!fs.existsSync(framesDir)) return [];
  return fs.readdirSync(framesDir)
    .filter((name) => /\.(jpe?g|png)$/i.test(name))
    .sort()
    .map((name) => path.join(framesDir, name));
}

(async () => {
  for (const id of ids) {
    const records = readJsonLines(config.metadataFile);
    const record = records.find((item) => item?.id === id);
    if (!record) throw new Error(`${id}: record not found in ${config.metadataFile}`);
    if (record.evaluation?.status !== "completed") {
      throw new Error(`${id}: evaluation status is ${record.evaluation?.status}, expected completed`);
    }
    if (!storedEvaluationLooksEmpty(record.evaluation) && process.env.RE_EVALUATE_FORCE !== "1") {
      throw new Error(`${id}: stored evaluation does not look like an empty-rubric zero; set RE_EVALUATE_FORCE=1 to re-score anyway`);
    }
    const transcript = String(record.evaluation.transcript || "");
    if (!transcript.trim()) throw new Error(`${id}: stored transcript is empty`);

    const framePaths = framePathsFor(id);
    const evaluationMode = record.evaluationMode === "standalone-speech" ? "standalone-speech" : "question-answer";
    console.log(`re-scoring ${id} (${record.user?.name || "unknown"}, ${transcript.split(/\s+/).length} words, ${framePaths.length} frames)...`);
    const result = await evaluateAnswer({
      profile: record.profile,
      question: record.question,
      transcript,
      audioMetrics: record.evaluation.audioMetrics,
      framePaths,
      evaluationMode,
    });
    if (!result.hasScorableEnglishSpeech) {
      throw new Error(`${id}: re-score judged the transcript unscoreable; refusing to overwrite`);
    }

    const nextEvaluation = {
      status: "completed",
      audioFile: record.evaluation.audioFile,
      frameCount: record.evaluation.frameCount,
      mediaValidation: record.evaluation.mediaValidation,
      audioMetrics: record.evaluation.audioMetrics,
      ...result,
    };
    updateJsonLines(config.metadataFile, (current) => current.map((existing) =>
      existing?.id === id ? { ...existing, evaluation: nextEvaluation } : existing,
    ));
    console.log(`done ${id}: overall ${result.overallScore}/100 — ${result.summary}`);
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

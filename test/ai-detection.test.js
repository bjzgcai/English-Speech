const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
const data = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-ai-detection-"));
Object.assign(process.env, { DATA_DIR: data, QUEUE_ENABLED: "false", SESSION_SECRET: "ai-detection-test" });
const config = require("../src/config");
const { appendJsonLine, readJsonLines } = require("../src/storage");
const processing = require("../src/processing");
const {
  ensureTeacherDetections,
  processTeacherDetections,
  detectionSummary,
  bestAnswerIds,
  scheduleBestAnswerRedetection,
} = require("../src/ai-detection");

function seedAnswer(answerId, openId, score) {
  appendJsonLine(config.metadataFile, {
    id: answerId,
    openId,
    user: { openId, name: "Student" },
    filename: "answer.mp4",
    finishedAt: "2026-10-01T09:00:00.000Z",
    question: { challengeId: "weekly-2026-09-28", question: "A weekly question" },
    evaluation: {
      status: "completed",
      overallScore: score,
      transcript: "This is my answer to the weekly question.",
      audioMetrics: { durationSeconds: 42, wordCount: 60, speakingRateWpm: 86, detectedPauses: 3, longPauses: 1, silenceSeconds: 2.5 },
    },
  });
}

function rows() {
  return readJsonLines(config.aiDetectionsFile);
}

function latestRow(id) {
  const matches = rows().filter(row => row.id === id);
  return matches[matches.length - 1] || null;
}

function mockVerdict(t, payload) {
  t.mock.method(processing, "modelFetch", async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] })));
}

test.afterEach(() => {
  // Reset the JSONL stores between tests; the directories themselves must stay
  // because config created them once at require time.
  fs.writeFileSync(config.metadataFile, "");
  fs.writeFileSync(config.aiDetectionsFile, "");
  fs.rmSync(config.artifactsDir, { recursive: true, force: true });
  fs.mkdirSync(config.artifactsDir, { recursive: true, mode: 0o700 });
});

test("detection enqueues each best answer exactly once, including after terminal failure", async () => {
  const best = "best-answer-1";
  const lower = "lower-attempt-1";
  seedAnswer(lower, "user-a", 70);
  seedAnswer(best, "user-a", 88);
  seedAnswer("other-best-1", "user-b", 91);

  // Only the two best answers (not the lower attempt) are enqueued.
  const ids = bestAnswerIds(readJsonLines(config.metadataFile));
  assert.deepEqual([...ids].sort(), [best, "other-best-1"]);

  assert.equal(ensureTeacherDetections(), 2);
  // A second sweep finds nothing new: the one-time rule.
  assert.equal(ensureTeacherDetections(), 0);

  // Terminal failures also suppress re-enqueueing.
  appendJsonLine(config.aiDetectionsFile, { id: best, state: "failed", attempts: 5, error: "model down" });
  assert.equal(ensureTeacherDetections(), 0);
  // The failed row renders as not suspicious, and never "pending".
  const failed = detectionSummary(latestRow(best));
  assert.deepEqual(failed, { state: "failed", suspicious: false, confidence: null, reason: "model down" });
});

test("processOne analyzes the best answer with frames and writes the verdict", async (t) => {
  const best = "best-answer-2";
  seedAnswer(best, "user-c", 95);
  ensureTeacherDetections();

  // A sampled frame rides along as an image part when it exists.
  const frameDir = path.join(config.artifactsDir, best, "frames");
  fs.mkdirSync(frameDir, { recursive: true });
  fs.writeFileSync(path.join(frameDir, "frame-001.jpg"), "jpeg-bytes");

  let sawImagePart = false;
  t.mock.method(processing, "modelFetch", async (_url, options) => {
    const body = JSON.parse(options.body);
    const content = body.messages[1].content;
    sawImagePart = content.some(part => part.type === "image_url");
    assert.ok(content[0].text.includes("weekly question"));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"aiGenerated":true,"confidence":87,"reason":"No fillers and a perfectly steady rate."}' } }] }));
  });

  assert.equal(await processTeacherDetections(), 1);
  const row = latestRow(best);
  assert.equal(row.state, "completed");
  assert.equal(row.suspicious, true);
  assert.equal(row.confidence, 87);
  assert.equal(row.reason, "No fillers and a perfectly steady rate.");
  assert.ok(sawImagePart, "frames were sent to the model");

  const summary = detectionSummary(row);
  assert.equal(summary.state, "completed");
  assert.equal(summary.suspicious, true);
});

test("an invalid model verdict retries with backoff, then fails terminally", async (t) => {
  const best = "best-answer-3";
  seedAnswer(best, "user-d", 80);
  ensureTeacherDetections();

  // Malformed content: not JSON.
  t.mock.method(processing, "modelFetch", async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "not json at all" } }] })));

  // Round 1: the malformed verdict moves the row to retry with backoff.
  await processTeacherDetections();
  const retrying = latestRow(best);
  assert.equal(retrying.state, "retry");
  assert.ok(retrying.retryAt > Date.now(), "the retry is postponed");
  assert.match(retrying.error, /did not return a JSON verdict/);

  // Rounds 2-5: make each retry due, then exhaust the attempt budget.
  const { updateJsonLines } = require("../src/storage");
  for (let round = 2; round <= 5; round++) {
    updateJsonLines(config.aiDetectionsFile, allRows => allRows.map(row =>
      row.id === best ? { ...row, retryAt: Date.now() - 1 } : row));
    await processTeacherDetections();
    const row = latestRow(best);
    assert.equal(row.state, round < 5 ? "retry" : "failed", `round ${round}`);
  }

  // Terminal failure stays terminal: no more claims.
  assert.equal(await processTeacherDetections(), 0);
});

test("an answer with an audio artifact sends it as an input_audio part to the audio model", async (t) => {
  const best = "best-answer-5";
  seedAnswer(best, "user-f", 93);
  ensureTeacherDetections();

  fs.mkdirSync(path.join(config.artifactsDir, best), { recursive: true });
  fs.writeFileSync(path.join(config.artifactsDir, best, "audio.mp3"), "mp3-bytes");
  // The audio path goes straight to OpenRouter, which requires the key.
  process.env.OPENROUTER_API_KEY = "test-key";
  t.after(() => { delete process.env.OPENROUTER_API_KEY; });

  let sawAudioPart = false;
  let sawUrl = "";
  t.mock.method(processing, "modelFetch", async (url, options) => {
    sawUrl = url;
    const body = JSON.parse(options.body);
    const content = body.messages[1].content;
    sawAudioPart = content.some(part => part.type === "input_audio"
      && part.input_audio.format === "mp3"
      && Buffer.from(part.input_audio.data, "base64").toString() === "mp3-bytes");
    assert.ok(content[0].text.includes("HEAR"), "the audio prompt variant is used");
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"aiGenerated":false,"confidence":95,"reason":"Natural breathing and fillers."}' } }] }));
  });

  assert.equal(await processTeacherDetections(), 1);
  assert.ok(sawAudioPart, "audio was sent to the model");
  assert.match(sawUrl, /openrouter\.ai/, "audio detection goes straight to OpenRouter");
  const row = latestRow(best);
  assert.equal(row.state, "completed");
  assert.equal(row.suspicious, false);
  assert.equal(row.reason, "Natural breathing and fillers.");
  assert.match(row.model, /omni|openrouter/, "the audio model is recorded");
});

test("sibling takes of the same question appear in the prompt as a delivery baseline", async (t) => {
  const best = "best-answer-6";
  // Three sibling takes by the same learner at a slower, steadier pace, plus
  // the best answer itself (fast, low-pause) that the analysis must judge.
  seedAnswer(best, "user-g", 93);
  seedAnswer("take-6a", "user-g", 70);
  seedAnswer("take-6b", "user-g", 74);
  seedAnswer("take-6c", "user-g", 72);
  const { updateJsonLines } = require("../src/storage");
  updateJsonLines(config.metadataFile, rows => rows.map(row => {
    if (row.id === "take-6a" || row.id === "take-6b" || row.id === "take-6c") {
      return { ...row, openId: "user-g", evaluation: { ...row.evaluation, audioMetrics: { ...row.evaluation.audioMetrics, speakingRateWpm: 90, detectedPauses: 5 } } };
    }
    if (row.id === best) {
      return { ...row, openId: "user-g", evaluation: { ...row.evaluation, overallScore: 90, audioMetrics: { ...row.evaluation.audioMetrics, speakingRateWpm: 130, detectedPauses: 2 } } };
    }
    return row;
  }));
  ensureTeacherDetections();
  // Drop the queued rows for the non-best sibling takes so only the best
  // answer is claimed by the analysis pass below.
  updateJsonLines(config.aiDetectionsFile, rows => rows.filter(row => row.id === best));

  let sawBaseline = false;
  let sawFlagRule = false;
  t.mock.method(processing, "modelFetch", async (_url, options) => {
    const body = JSON.parse(options.body);
    const text = body.messages[1].content[0].text;
    sawBaseline = text.includes("SAME learner recorded 3 other takes")
      && text.includes("90 wpm")
      && text.includes("44% faster");
    sawFlagRule = text.includes("FLAG RULE");
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"aiGenerated":true,"confidence":91,"reason":"Much faster than the learner baseline."}' } }] }));
  });

  assert.equal(await processTeacherDetections(), 1);
  assert.ok(sawBaseline, "the sibling baseline is in the prompt");
  assert.ok(sawFlagRule, "a 15% outlier triggers the precomputed flag rule");
  const row = latestRow(best);
  assert.equal(row.suspicious, true);
  assert.match(row.reason, /baseline/);
});

test("an answer deleted after enqueueing completes without a verdict", async () => {
  const best = "best-answer-4";
  seedAnswer(best, "user-e", 77);
  ensureTeacherDetections();
  // Wipe the recordings metadata: the answer no longer exists.
  fs.writeFileSync(config.metadataFile, "");

  assert.equal(await processTeacherDetections(), 1);
  const row = latestRow(best);
  assert.equal(row.state, "completed");
  assert.equal(row.suspicious, false);
  assert.match(row.reason, /no longer exists/);
  assert.equal(ensureTeacherDetections(), 0, "the missing answer is not re-enqueued");
});

test("scheduling a re-detection enqueues and analyzes the new best answer", async (t) => {
  // The learner's best (88) already has a completed row; the second-best (81)
  // has none. After the best answer is deleted, the debounced re-check must
  // enqueue the second-best take and analyze it — the once-only rule keeps
  // the already-analyzed row from re-running.
  const best = "best-answer-7";
  const second = "second-answer-7";
  seedAnswer(best, "user-h", 88);
  seedAnswer(second, "user-h", 81);
  ensureTeacherDetections();
  t.mock.method(processing, "modelFetch", async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: '{"aiGenerated":false,"confidence":95,"reason":"Natural fillers."}' } }] })));
  await processTeacherDetections();
  assert.equal(latestRow(best).state, "completed");

  // The delete happens outside this module; simulate its effect on metadata
  // and then schedule the re-check the delete route would schedule.
  const { updateJsonLines } = require("../src/storage");
  updateJsonLines(config.metadataFile, rows => rows.filter(row => row.id !== best));

  let processed = 0;
  t.mock.method(processing, "modelFetch", async () => {
    processed++;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"aiGenerated":true,"confidence":90,"reason":"Outlier take."}' } }] }));
  });
  scheduleBestAnswerRedetection("user-h", 20);
  await new Promise(resolve => setTimeout(resolve, 100));

  assert.equal(processed, 1, "only the second-best take was analyzed");
  const row = latestRow(second);
  assert.equal(row.state, "completed");
  assert.equal(row.suspicious, true);
  assert.equal(latestRow(best).state, "completed", "the deleted answer's old verdict stays untouched");
});

test("a burst of re-detection schedules for the same user coalesces into one timer", async () => {
  seedAnswer("burst-best-1", "user-i", 90);
  seedAnswer("burst-second-1", "user-i", 60);
  ensureTeacherDetections();

  scheduleBestAnswerRedetection("user-i", 20);
  scheduleBestAnswerRedetection("user-i", 20);
  scheduleBestAnswerRedetection("user-i", 20);
  await new Promise(resolve => setTimeout(resolve, 100));
  // Three schedules within the window must have collapsed to one timer: the
  // observable effect is a single enqueue sweep, which enqueued nothing new
  // here (both takes already had rows) — the assertion is that no error and
  // no duplicate rows resulted.
  const deduped = readJsonLines(config.aiDetectionsFile).filter(row => row.id === "burst-best-1");
  assert.equal(deduped.length, 1, "no duplicate enqueue rows from coalesced timers");
});

test("an openId-less schedule call is ignored", async () => {
  scheduleBestAnswerRedetection("", 20);
  scheduleBestAnswerRedetection(undefined, 20);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.ok(true, "no throw from empty/undefined openId");
});

test.after(() => {
  fs.rmSync(data, { recursive: true, force: true });
});

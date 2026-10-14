const fs = require("node:fs");
const path = require("node:path");
const config = require("./config");
const { readJsonLines, updateJsonLines, appendJsonLine } = require("./storage");
const { leaderboardForChallenge } = require("./game");
const { chatCompletionWithFallback, openRouterChatCompletion, openRouterModelFor } = require("./model-fallback");

// The teacher console flags a learner's best answer as "possibly AI-generated".
// The evaluator pipeline never sends raw audio to a chat model, so this is a
// heuristic inference from transcript evidence, delivery metrics, and a few
// sampled frames — never acoustic proof. Each best answer is analyzed once:
// any existing row (including a terminal failure) suppresses re-enqueueing.

const MAX_ATTEMPTS = 5;
const MAX_FRAMES = 3;
const RETRY_CAP_MS = 5 * 60 * 1000;
// A process that died mid-analysis must not leave its row claimed forever.
const STALE_PROCESSING_MS = 5 * 60 * 1000;

function chatCompletionsUrl() {
  return (
    process.env.INTERNAL_LLM_CHAT_COMPLETIONS_URL ||
    "https://api.example.com/v1/chat/completions"
  );
}

function detectionModel() {
  return process.env.INTERNAL_LLM_AI_DETECTION_MODEL || process.env.INTERNAL_LLM_EVAL_MODEL || "qwen";
}

function detectionRows() {
  return readJsonLines(config.aiDetectionsFile);
}

// Latest row wins for a given answer id, mirroring invitationRecords().
function detectionById() {
  const latest = new Map();
  for (const row of detectionRows()) latest.set(row.id, row);
  return latest;
}

function bestAnswerIds(records) {
  const challengeIds = new Set();
  for (const record of records) {
    const challengeId = record?.question?.challengeId;
    if (typeof challengeId === "string" && challengeId) challengeIds.add(challengeId);
  }
  const answerIds = new Set();
  for (const challengeId of challengeIds) {
    // The challenge object only needs the id for leaderboardForChallenge.
    const board = leaderboardForChallenge(records, { id: challengeId }, null, new Map());
    for (const entry of board.entries) {
      if (entry.answerId) answerIds.add(entry.answerId);
    }
  }
  return answerIds;
}

// Enqueues detection jobs for every current best answer that has no row yet.
// Fire-and-forget by callers; safe to run repeatedly.
function ensureTeacherDetections() {
  const records = readJsonLines(config.metadataFile);
  const known = detectionById();
  const queued = [];
  for (const answerId of bestAnswerIds(records)) {
    if (known.has(answerId)) continue;
    const row = {
      id: answerId,
      state: "queued",
      attempts: 0,
      createdAt: new Date().toISOString(),
    };
    appendJsonLine(config.aiDetectionsFile, row);
    queued.push(row);
  }
  return queued.length;
}

function claimJob() {
  let claimed;
  updateJsonLines(config.aiDetectionsFile, rows => {
    const job = rows.find(row =>
      row.state === "queued" ||
      (row.state === "retry" && (!row.retryAt || row.retryAt <= Date.now())) ||
      (row.state === "processing" && (!row.claimedAt || row.claimedAt <= Date.now() - STALE_PROCESSING_MS)));
    if (!job) return rows;
    claimed = { ...job, state: "processing", attempts: (job.attempts || 0) + 1, claimedAt: new Date().toISOString() };
    return rows.map(row => row.id === job.id ? claimed : row);
  });
  return claimed;
}

function framePathsFor(recordId) {
  const frameDir = path.join(config.artifactsDir, recordId, "frames");
  if (!fs.existsSync(frameDir)) return [];
  return fs.readdirSync(frameDir)
    .filter(file => /^frame-\d+\.jpg$/.test(file))
    .sort()
    .map(file => path.join(frameDir, file));
}

// A single answer can only look "normal" in isolation — an AI-generated take
// of a task usually stands out against the SAME learner's other takes on the
// SAME question (one confirmed case: a learner at 83–103 wpm across 12 takes
// submitted a 122-wpm TTS take that per-answer analysis cleared). The outlier
// is computed HERE, not left to the model: on the confirmed case the omni
// model flip-flopped between flag and clear when asked to compare numbers
// itself ("matches the baseline" for 122 vs 82-103 wpm), so the code hands the
// model a precomputed fact. Threshold 15%: on production data the gap between
// the fastest real-learner take (+11.6% over own best) and confirmed TTS
// (+18.4%) is clean, and 6 further post-cutoff takes sit above +21%.
function siblingBaseline(records, record) {
  const owner = record?.openId;
  const challengeId = record?.question?.challengeId;
  if (!owner || !challengeId) return null;
  const siblings = records.filter(item =>
    item?.id !== record.id && item?.openId === owner
    && item?.question?.challengeId === challengeId
    && Number.isFinite(item?.evaluation?.audioMetrics?.speakingRateWpm));
  if (siblings.length < 2) return null;
  const rates = siblings.map(item => item.evaluation.audioMetrics.speakingRateWpm);
  const pauses = siblings.map(item => item.evaluation.audioMetrics.detectedPauses).filter(Number.isFinite);
  const fmt = values => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    return min === max ? `${min}` : `${min}-${max}`;
  };
  const maxSibling = Math.max(...rates);
  const own = record?.evaluation?.audioMetrics?.speakingRateWpm;
  const overBaseline = Number.isFinite(own) && maxSibling > 0
    ? Math.round(((own - maxSibling) / maxSibling) * 100)
    : null;
  return {
    count: siblings.length,
    rateRange: fmt(rates),
    pauseRange: pauses.length ? fmt(pauses) : "unknown",
    overBaseline,
    outlier: overBaseline !== null && overBaseline >= 15,
  };
}

function detectionPrompt(record, hasAudio, baseline) {
  const evaluation = record.evaluation || {};
  const metrics = evaluation.audioMetrics || {};
  const lines = [
    "You are reviewing a learner's recorded English speaking answer to decide whether the answer was likely produced by an AI text-to-speech or voice-cloning tool rather than the learner speaking live.",
    hasAudio
      ? "You can HEAR the actual recording. Weigh the acoustic signal first: TTS/voice-clone audio tends to have unnaturally flat or sing-song prosody, metallic or over-smooth timbre, robotic pacing, absent breath sounds, or inconsistent room tone. A live human has breaths, hesitations, fillers (um, uh), uneven emphasis, and consistent background noise. Webcam-mic noise and lossy compression are normal for real learners and must NOT be mistaken for TTS artifacts. Validated on this corpus: a clean-sounding voice with natural breathing and fillers is a real learner, even if the transcript looks polished. BUT: a learner can sit in front of the camera while a TTS voice plays through speakers — visible mouth movement alone does NOT prove the voice is theirs; check whether the audio's timbre and pacing actually match a live person at that distance from that microphone."
      : "You cannot hear the audio. Judge from indirect evidence only: the transcript's phrasing, the delivery metrics, and the sampled video frames.",
    "You also receive the transcript, delivery metrics, and sampled video frames.",
    "Acoustic evidence is the most reliable channel; transcript polish alone is NOT sufficient. IMPORTANT: reading the question or its instructions aloud (the transcript matching or echoing the task text) is NORMAL learner behavior — starting an answer by reading the question aloud, or thinking aloud — and must NEVER be treated as evidence of AI generation on its own. Some real learners also read prepared notes and speak cleanly. Flag as AI-generated only on convergent evidence: clear acoustic TTS signs, OR a non-acoustic anomaly that a live speaker could not plausibly produce (frames show no mouth movement while a full transcript exists; an on-screen TTS app; delivery metrics physically impossible for a human, like zero pauses across two minutes).",
    "Signals of a live human include: breath sounds, fillers, self-corrections, uneven pacing, natural pauses, imperfect grammar, and frames showing a person actively speaking to the camera.",
    'Return JSON only: {"aiGenerated": true|false, "confidence": 0-100, "reason": "one short sentence of evidence"}.',
    `Task question: ${record.question?.question || record.question?.title || ""}`,
    `Speaking duration (s): ${metrics.durationSeconds ?? "unknown"}; words: ${metrics.wordCount ?? "unknown"}; speaking rate (wpm): ${metrics.speakingRateWpm ?? "unknown"}; pauses: ${metrics.detectedPauses ?? "unknown"}; long pauses: ${metrics.longPauses ?? "unknown"}; silence (s): ${metrics.silenceSeconds ?? "unknown"}.`,
    baseline
      ? `The SAME learner recorded ${baseline.count} other takes of THIS SAME question, speaking at ${baseline.rateRange} wpm with ${baseline.pauseRange} pauses.${baseline.overBaseline !== null ? ` This take's speaking rate is ${Math.abs(baseline.overBaseline)}% ${baseline.overBaseline >= 0 ? "faster" : "slower"} than that learner's fastest other take.` : ""}`
      : "No other takes of this question by the same learner are available for comparison.",
    baseline?.outlier
      ? `FLAG RULE (precomputed, high priority): this take is ${baseline.overBaseline}% faster than the same learner's fastest other take of the same question. A live human does not spontaneously produce a take that much faster and smoother than every other take they recorded the same day. Treat this as strong evidence of AI text-to-speech and set aiGenerated=true UNLESS you can positively verify from the audio that it is unmistakably the same live struggling learner's voice as the delivery implies (same accent, same mic, same imperfections) covering similar content faster — a rare situation. Breath sounds, natural fillers, or visible mouth movement do NOT override this rule: a learner can breathe in front of the camera and mouth along while a TTS voice plays. In your reason, cite the ${baseline.overBaseline}% delivery outlier.`
      : "",
    `Transcript: ${evaluation.transcript || "(no transcript)"}`,
  ];
  return lines.filter(Boolean).join("\n");
}

function verdictFromResponseText(text) {
  const match = String(text || "").match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    const confidence = Number(parsed.confidence);
    return {
      aiGenerated: parsed.aiGenerated === true,
      confidence: Number.isFinite(confidence) ? Math.min(100, Math.max(0, Math.round(confidence))) : null,
      reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 300) : "",
    };
  } catch {
    return null;
  }
}

function completeJob(id, patch) {
  updateJsonLines(config.aiDetectionsFile, rows => rows.map(row =>
    row.id === id ? { ...row, ...patch, state: "completed", completedAt: new Date().toISOString() } : row));
}

function retryJob(job, error) {
  updateJsonLines(config.aiDetectionsFile, rows => rows.map(row => {
    if (row.id !== job.id) return row;
    const attempts = row.attempts || 1;
    if (attempts >= MAX_ATTEMPTS) {
      return { ...row, state: "failed", error: String(error.message || error).slice(0, 200), failedAt: new Date().toISOString() };
    }
    return { ...row, state: "retry", retryAt: Date.now() + Math.min(RETRY_CAP_MS, 1000 * 2 ** Math.min(attempts, 8)), error: String(error.message || error).slice(0, 200) };
  }));
}

async function processOne() {
  const job = claimJob();
  if (!job) return false;
  const records = readJsonLines(config.metadataFile);
  const record = records.find(item => item?.id === job.id);
  if (!record) {
    // The answer was deleted after enqueueing; treat as analyzed so it never requeues.
    completeJob(job.id, { suspicious: false, reason: "The recording no longer exists.", confidence: null });
    return true;
  }
  const baseline = siblingBaseline(records, record);

  try {
    // The durable 16 kHz mono MP3 extracted during evaluation is the same file
    // the ASR stage already sends off-server, so sharing it with the detection
    // model is no new exposure. Records whose artifact extraction failed have
    // no audio; those fall back to the transcript-only prompt.
    const audioPath = path.join(config.artifactsDir, job.id, "audio.mp3");
    const hasAudio = fs.existsSync(audioPath) && fs.statSync(audioPath).size > 0;
    const content = [{ type: "text", text: detectionPrompt(record, hasAudio, baseline) }];
    if (hasAudio) {
      content.push({
        type: "input_audio",
        input_audio: { data: fs.readFileSync(audioPath).toString("base64"), format: "mp3" },
      });
    }
    const frames = framePathsFor(job.id).slice(0, MAX_FRAMES);
    for (const frame of frames) {
      content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${fs.readFileSync(frame).toString("base64")}` } });
    }

    // The internal hub serves no audio-input chat model, so detection with
    // audio goes straight to OpenRouter (validated 2026-10-14: qwen3.8-omni
    // judged 18/18 known-real recordings correctly with zero false positives).
    // Audio-less requests keep the internal-first fallback chain.
    const { response, model } = hasAudio
      ? await openRouterChatCompletion({
        model: process.env.OPENROUTER_AUDIO_DETECTION_MODEL || openRouterModelFor("audio-detection"),
        body: {
          max_tokens: 8192,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "You are a careful integrity reviewer. Return JSON only." },
            { role: "user", content },
          ],
        },
        kind: "detection",
      })
      : await chatCompletionWithFallback({
        url: chatCompletionsUrl(),
        headers: { Authorization: `Bearer ${process.env.INTERNAL_LLM_API_KEY || ""}`, "Content-Type": "application/json" },
        body: {
          model: detectionModel(),
          // The internal model reasons before answering; short budgets let
          // reasoning eat everything (finish_reason "length", empty content).
          // Verified on production: long transcripts need up to 8192 tokens.
          max_tokens: 8192,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "You are a careful integrity reviewer. Return JSON only." },
            { role: "user", content },
          ],
        },
        kind: "detection",
        fallbackModel: openRouterModelFor("detection"),
      });
    const body = await response.json();
    const verdict = verdictFromResponseText(body?.choices?.[0]?.message?.content);
    if (!verdict) throw new Error("The detection model did not return a JSON verdict.");
    completeJob(job.id, {
      suspicious: verdict.aiGenerated === true,
      confidence: verdict.confidence,
      reason: verdict.reason,
      model,
    });
  } catch (error) {
    retryJob(job, error);
  }
  return true;
}

async function processTeacherDetections() {
  let processed = 0;
  // A slow catch-up must not block the request that kicked it.
  while (await processOne()) processed++;
  return processed;
}

// Client-facing summary; state names map onto what the UI renders. A missing
// row means the one-time analysis is queued but not finished yet; callers pass
// { state: "none" } for answers with nothing to analyze.
function detectionSummary(row) {
  if (!row) return { state: "pending", suspicious: false, confidence: null, reason: "" };
  if (row.state === "none") {
    return { state: "none", suspicious: false, confidence: null, reason: "" };
  }
  if (row.state === "completed") {
    return { state: "completed", suspicious: row.suspicious === true, confidence: row.confidence ?? null, reason: row.reason || "" };
  }
  if (row.state === "failed") {
    return { state: "failed", suspicious: false, confidence: null, reason: row.reason || row.error || "" };
  }
  return { state: "pending", suspicious: false, confidence: null, reason: "" };
}

module.exports = {
  ensureTeacherDetections,
  processTeacherDetections,
  processOne,
  detectionSummary,
  detectionById,
  bestAnswerIds,
};

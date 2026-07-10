const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const express = require("express");
const multer = require("multer");
const ffmpegPath = require("ffmpeg-static");
require("dotenv").config();
if (process.env.NODE_ENV !== "production") {
  require("dotenv").config({ path: ".env.local", override: true });
}

const app = express();
const port = Number(process.env.PORT || 3000);
const rootDir = __dirname;
const publicDir = path.join(rootDir, "public");
const recordingsDir = path.join(rootDir, "recordings");
const artifactsDir = path.join(recordingsDir, "artifacts");
const metadataFile = path.join(recordingsDir, "metadata.jsonl");
const questionsDir = path.join(rootDir, "questions");
const questionsMetadataFile = path.join(questionsDir, "metadata.jsonl");
const sessionCookieName = "englisheval_session";
const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;

fs.mkdirSync(recordingsDir, { recursive: true });
fs.mkdirSync(artifactsDir, { recursive: true });
fs.mkdirSync(questionsDir, { recursive: true });

app.use(express.json({ limit: "1mb" }));
app.use(
  express.static(publicDir, {
    index: false,
  }),
);

const upload = multer({
  dest: path.join(recordingsDir, "tmp"),
  limits: {
    fileSize: 250 * 1024 * 1024,
  },
});

function safeText(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function getBaseUrl(req) {
  return process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
}

function isDingTalkConfigured() {
  return Boolean(process.env.DINGTALK_APP_KEY && process.env.DINGTALK_APP_SECRET);
}

function parseCookies(req) {
  return String(req.headers.cookie || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((cookies, item) => {
      const separatorIndex = item.indexOf("=");
      if (separatorIndex === -1) return cookies;
      const key = decodeURIComponent(item.slice(0, separatorIndex));
      const value = decodeURIComponent(item.slice(separatorIndex + 1));
      cookies[key] = value;
      return cookies;
    }, {});
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signSessionPayload(payload) {
  const secret = process.env.SESSION_SECRET || process.env.DINGTALK_APP_SECRET;
  if (!secret) return "";
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function createSessionToken(user) {
  const payload = base64UrlEncode(
    JSON.stringify({
      user,
      exp: Date.now() + sessionTtlMs,
    }),
  );
  return `${payload}.${signSessionPayload(payload)}`;
}

function useSecureSessionCookie() {
  const override = safeText(process.env.COOKIE_SECURE).toLowerCase();
  if (override === "true" || override === "false") {
    return override === "true";
  }

  try {
    return new URL(process.env.APP_BASE_URL).protocol === "https:";
  } catch {
    return false;
  }
}

function readSession(req) {
  const token = parseCookies(req)[sessionCookieName];
  if (!token) return null;

  const [payload, signature] = token.split(".");
  if (!payload || !signature || signature !== signSessionPayload(payload)) {
    return null;
  }

  try {
    const session = JSON.parse(base64UrlDecode(payload));
    if (!session.exp || session.exp < Date.now()) {
      return null;
    }
    return session.user || null;
  } catch {
    return null;
  }
}

function setSessionCookie(res, user) {
  const token = createSessionToken(user);
  res.cookie(sessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: useSecureSessionCookie(),
    maxAge: sessionTtlMs,
    path: "/",
  });
}

function clearSessionCookie(res) {
  res.clearCookie(sessionCookieName, {
    httpOnly: true,
    sameSite: "lax",
    secure: useSecureSessionCookie(),
    path: "/",
  });
}

function requireAuth(req, res, next) {
  if (!isDingTalkConfigured()) {
    return res.status(503).json({ error: "DingTalk authentication is not configured." });
  }

  const user = readSession(req);
  if (!user) {
    return res.status(401).json({ error: "DingTalk sign-in is required." });
  }

  if (!safeText(user.openId)) {
    return res.status(403).json({
      error: "Your DingTalk account did not provide an openId. Please sign out and sign in again.",
    });
  }

  req.user = user;
  next();
}

function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];

  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function writeJsonLines(filePath, records) {
  const temporaryFile = `${filePath}.${process.pid}.tmp`;
  const contents = records.length
    ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n`
    : "";
  fs.writeFileSync(temporaryFile, contents, { mode: 0o600 });
  fs.renameSync(temporaryFile, filePath);
}

function appendJsonLine(filePath, record) {
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

function recordOpenId(record) {
  return safeText(record?.openId || record?.user?.openId);
}

function removePath(targetPath) {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch (error) {
    console.warn(`Unable to remove legacy path ${targetPath}: ${error.message}`);
  }
}

function cleanupLegacyData() {
  const recordings = readJsonLines(metadataFile);
  const retainedRecordings = recordings
    .filter((record) => recordOpenId(record))
    .map((record) => ({ ...record, openId: recordOpenId(record) }));
  const removedRecordings = recordings.filter((record) => !recordOpenId(record));

  removedRecordings.forEach((record) => {
    if (record.filename && path.basename(record.filename) === record.filename) {
      removePath(path.join(recordingsDir, record.filename));
    }
    if (record.id) {
      removePath(path.join(artifactsDir, String(record.id)));
    }
  });

  const retainedFilenames = new Set(retainedRecordings.map((record) => record.filename));
  for (const entry of fs.readdirSync(recordingsDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name !== path.basename(metadataFile) && !retainedFilenames.has(entry.name)) {
      removePath(path.join(recordingsDir, entry.name));
    }
  }

  const retainedArtifactIds = new Set(retainedRecordings.map((record) => String(record.id)));
  for (const entry of fs.readdirSync(artifactsDir, { withFileTypes: true })) {
    if (!retainedArtifactIds.has(entry.name)) {
      removePath(path.join(artifactsDir, entry.name));
    }
  }

  removePath(path.join(recordingsDir, "tmp"));
  fs.mkdirSync(path.join(recordingsDir, "tmp"), { recursive: true });

  if (recordings.length) {
    writeJsonLines(metadataFile, retainedRecordings);
  }

  const questions = readJsonLines(questionsMetadataFile);
  const retainedQuestions = questions
    .filter((record) => recordOpenId(record))
    .map((record) => ({ ...record, openId: recordOpenId(record) }));
  if (questions.length) {
    writeJsonLines(questionsMetadataFile, retainedQuestions);
  }

  if (removedRecordings.length || questions.length !== retainedQuestions.length) {
    console.log(
      `Removed ${removedRecordings.length} legacy recording(s) and ${questions.length - retainedQuestions.length} legacy question(s) without a DingTalk openId.`,
    );
  }
}

cleanupLegacyData();

function getExtensionFromMime(mimeType) {
  if (mimeType === "video/mp4") return ".mp4";
  if (mimeType === "video/webm") return ".webm";
  if (mimeType === "video/ogg") return ".ogv";
  return ".webm";
}

function convertToMp4(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(ffmpegPath, [
      "-y",
      "-i",
      inputPath,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      outputPath,
    ]);

    let errorOutput = "";
    ffmpeg.stderr.on("data", (chunk) => {
      errorOutput += chunk.toString();
    });
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(errorOutput || `ffmpeg exited with code ${code}`));
      }
    });
  });
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(ffmpegPath, args);

    let errorOutput = "";
    ffmpeg.stderr.on("data", (chunk) => {
      errorOutput += chunk.toString();
    });
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve(errorOutput);
      } else {
        reject(new Error(errorOutput || `ffmpeg exited with code ${code}`));
      }
    });
  });
}

async function extractAudio(videoPath, outputPath) {
  try {
    await runFfmpeg([
      "-y",
      "-i",
      videoPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "64k",
      outputPath,
    ]);
  } catch (error) {
    const detail = String(error?.message || error);
    if (/does not contain any stream|matches no streams|audio stream/i.test(detail)) {
      throw new Error(
        "The saved recording has no usable microphone audio. Check microphone permission and record the answer again.",
      );
    }
    throw error;
  }
}

async function sampleFrames(videoPath, frameDir, maxFrames = 18) {
  fs.mkdirSync(frameDir, { recursive: true });

  await runFfmpeg([
    "-y",
    "-i",
    videoPath,
    "-vf",
    `fps=1/5,scale=640:-1:force_original_aspect_ratio=decrease`,
    "-frames:v",
    String(maxFrames),
    "-q:v",
    "4",
    path.join(frameDir, "frame-%03d.jpg"),
  ]);

  return fs
    .readdirSync(frameDir)
    .filter((filename) => filename.toLowerCase().endsWith(".jpg"))
    .sort()
    .map((filename) => path.join(frameDir, filename));
}

function parseDurationSeconds(ffmpegOutput) {
  const match = ffmpegOutput.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!match) return null;
  const [, hours, minutes, seconds] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

async function inspectAudio(audioPath, transcript) {
  const output = await runFfmpeg([
    "-i",
    audioPath,
    "-af",
    "silencedetect=n=-35dB:d=0.7",
    "-f",
    "null",
    "-",
  ]);
  const durationSeconds = parseDurationSeconds(output);
  const silenceStarts = [...output.matchAll(/silence_start:\s*([0-9.]+)/g)].map((match) =>
    Number(match[1]),
  );
  const silenceEnds = [...output.matchAll(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/g)].map(
    (match) => ({
      end: Number(match[1]),
      duration: Number(match[2]),
    }),
  );
  const longPauses = silenceEnds.filter((item) => item.duration >= 1.2);
  const silenceSeconds = silenceEnds.reduce((total, item) => total + item.duration, 0);
  const wordCount = transcript ? transcript.split(/\s+/).filter(Boolean).length : 0;
  const speakingRateWpm =
    durationSeconds && durationSeconds > 0 ? Math.round(wordCount / (durationSeconds / 60)) : null;

  return {
    durationSeconds: durationSeconds ? Math.round(durationSeconds * 10) / 10 : null,
    wordCount,
    speakingRateWpm,
    detectedPauses: silenceStarts.length,
    longPauses: longPauses.length,
    silenceSeconds: Math.round(silenceSeconds * 10) / 10,
  };
}

function fileToDataUrl(filePath, mimeType) {
  return `data:${mimeType};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

function extractJsonObject(value) {
  const text = safeText(value);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model did not return a JSON object.");
  }
  return JSON.parse(text.slice(start, end + 1));
}

function normalizeScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function buildDingTalkAuthUrl(req, redirectPath = "/") {
  const redirectUri = `${getBaseUrl(req)}/auth/dingtalk/callback`;
  const state = base64UrlEncode(
    JSON.stringify({
      nonce: crypto.randomBytes(12).toString("hex"),
      redirectPath: redirectPath.startsWith("/") ? redirectPath : "/",
      ts: Date.now(),
    }),
  );
  const params = new URLSearchParams({
    redirect_uri: redirectUri,
    response_type: "code",
    client_id: process.env.DINGTALK_APP_KEY,
    scope: "openid",
    state,
    prompt: "consent",
  });

  return `https://login.dingtalk.com/oauth2/auth?${params.toString()}`;
}

function parseOAuthState(value) {
  if (!value) return { redirectPath: "/" };
  try {
    const state = JSON.parse(base64UrlDecode(value));
    return {
      redirectPath:
        typeof state.redirectPath === "string" && state.redirectPath.startsWith("/")
          ? state.redirectPath
          : "/",
    };
  } catch {
    return { redirectPath: "/" };
  }
}

async function requestDingTalkUserAccessToken(code) {
  const response = await fetch("https://api.dingtalk.com/v1.0/oauth2/userAccessToken", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientId: process.env.DINGTALK_APP_KEY,
      clientSecret: process.env.DINGTALK_APP_SECRET,
      code,
      grantType: "authorization_code",
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`DingTalk token exchange failed: ${detail}`);
  }

  return response.json();
}

async function requestDingTalkCurrentUser(accessToken) {
  const response = await fetch("https://api.dingtalk.com/v1.0/contact/users/me", {
    headers: {
      "x-acs-dingtalk-access-token": accessToken,
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`DingTalk user lookup failed: ${detail}`);
  }

  return response.json();
}

function normalizeDingTalkUser(rawUser) {
  return {
    openId: safeText(rawUser?.openId),
    unionId: safeText(rawUser?.unionId),
    userId: safeText(rawUser?.userId),
    name: safeText(rawUser?.nick || rawUser?.name, "DingTalk user"),
    avatarUrl: safeText(rawUser?.avatarUrl),
    mobile: safeText(rawUser?.mobile),
  };
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function normalizeEvaluation(rawEvaluation) {
  const rubric = {
    pronunciation: {
      label: "Pronunciation / intelligibility",
      weight: 25,
      score: normalizeScore(rawEvaluation?.rubric?.pronunciation?.score),
      feedback: safeText(rawEvaluation?.rubric?.pronunciation?.feedback),
    },
    fluency: {
      label: "Fluency",
      weight: 15,
      score: normalizeScore(rawEvaluation?.rubric?.fluency?.score),
      feedback: safeText(rawEvaluation?.rubric?.fluency?.feedback),
    },
    grammar: {
      label: "Grammar",
      weight: 20,
      score: normalizeScore(rawEvaluation?.rubric?.grammar?.score),
      feedback: safeText(rawEvaluation?.rubric?.grammar?.feedback),
    },
    vocabulary: {
      label: "Vocabulary",
      weight: 15,
      score: normalizeScore(rawEvaluation?.rubric?.vocabulary?.score),
      feedback: safeText(rawEvaluation?.rubric?.vocabulary?.feedback),
    },
    coherence: {
      label: "Coherence / task relevance",
      weight: 10,
      score: normalizeScore(rawEvaluation?.rubric?.coherence?.score),
      feedback: safeText(rawEvaluation?.rubric?.coherence?.feedback),
    },
    visualDelivery: {
      label: "Visual delivery",
      weight: 15,
      score: normalizeScore(rawEvaluation?.rubric?.visualDelivery?.score),
      feedback: safeText(rawEvaluation?.rubric?.visualDelivery?.feedback),
    },
  };

  const overallScore = Object.values(rubric).reduce(
    (total, item) => total + item.score * (item.weight / 100),
    0,
  );

  return {
    overallScore: normalizeScore(rawEvaluation?.overallScore || overallScore),
    summary: safeText(rawEvaluation?.summary, "Evaluation completed."),
    transcript: safeText(rawEvaluation?.transcript),
    rubric,
    strengths: Array.isArray(rawEvaluation?.strengths)
      ? rawEvaluation.strengths.map((item) => safeText(item)).filter(Boolean).slice(0, 4)
      : [],
    improvements: Array.isArray(rawEvaluation?.improvements)
      ? rawEvaluation.improvements.map((item) => safeText(item)).filter(Boolean).slice(0, 4)
      : [],
    model: {
      transcribe: process.env.OPENROUTER_TRANSCRIBE_MODEL || "openai/gpt-4o-transcribe",
      evaluate: process.env.OPENROUTER_EVAL_MODEL || "google/gemini-3.5-flash",
    },
  };
}

async function transcribeAudio(audioPath) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_TRANSCRIBE_MODEL || "openai/gpt-4o-transcribe";
  const formData = new FormData();
  const file = new Blob([fs.readFileSync(audioPath)], { type: "audio/mpeg" });

  formData.append("model", model);
  formData.append("file", file, path.basename(audioPath));
  formData.append("language", "en");

  const response = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "http://localhost",
      "X-Title": "EnglishEval",
    },
    body: formData,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Transcription failed: ${detail}`);
  }

  const payload = await response.json();
  return safeText(payload.text);
}

function buildEvaluationPrompt({ profile, question, transcript, audioMetrics, frameCount }) {
  return [
    "Evaluate this user's English speaking performance from the transcript and sampled video frames.",
    "Return strict JSON only. Do not include markdown.",
    "Use a 0-100 score for each dimension.",
    "The weights must be: pronunciation 25, fluency 15, grammar 20, vocabulary 15, coherence 10, visualDelivery 15.",
    "Visual delivery should assess posture, eye contact with camera, facial engagement, framing, and distracting movement.",
    "Use the audio metrics to evaluate fluency and pacing. Pronunciation should be inferred from transcription reliability and intelligibility clues; if evidence is limited, say that in feedback.",
    "Be direct, specific, and useful to the learner. Do not over-penalize accent when intelligibility is strong.",
    "Schema:",
    JSON.stringify({
      overallScore: 0,
      summary: "",
      transcript: "",
      rubric: {
        pronunciation: { score: 0, feedback: "" },
        fluency: { score: 0, feedback: "" },
        grammar: { score: 0, feedback: "" },
        vocabulary: { score: 0, feedback: "" },
        coherence: { score: 0, feedback: "" },
        visualDelivery: { score: 0, feedback: "" },
      },
      strengths: [],
      improvements: [],
    }),
    "",
    `Candidate profile: ${JSON.stringify(profile)}`,
    `Question: ${JSON.stringify(question)}`,
    `Audio metrics: ${JSON.stringify(audioMetrics)}`,
    `Sampled video frames: ${frameCount}`,
    `Transcript: ${transcript || "[empty transcription]"}`,
  ].join("\n");
}

async function evaluateAnswer({ profile, question, transcript, audioMetrics, framePaths }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_EVAL_MODEL || "google/gemini-3.5-flash";
  const content = [
    {
      type: "text",
      text: buildEvaluationPrompt({
        profile,
        question,
        transcript,
        audioMetrics,
        frameCount: framePaths.length,
      }),
    },
    ...framePaths.map((framePath) => ({
      type: "image_url",
      image_url: {
        url: fileToDataUrl(framePath, "image/jpeg"),
      },
    })),
  ];

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost",
      "X-Title": "EnglishEval",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a strict but fair English speaking evaluator. You produce calibrated JSON scores and concise coaching feedback.",
        },
        {
          role: "user",
          content,
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Evaluation failed: ${detail}`);
  }

  const payload = await response.json();
  const outputText = payload.choices?.[0]?.message?.content || "";

  return normalizeEvaluation(extractJsonObject(outputText));
}

async function evaluateSavedVideo({ videoPath, artifactBaseDir, profile, question }) {
  if (!process.env.OPENROUTER_API_KEY) {
    return {
      status: "skipped",
      reason: "OPENROUTER_API_KEY is not configured.",
    };
  }

  const audioPath = path.join(artifactBaseDir, "audio.mp3");
  const frameDir = path.join(artifactBaseDir, "frames");

  fs.mkdirSync(artifactBaseDir, { recursive: true });
  await extractAudio(videoPath, audioPath);
  const maxFrames = positiveInteger(Number(process.env.EVAL_MAX_FRAMES), 18);
  const [transcript, framePaths] = await Promise.all([
    transcribeAudio(audioPath),
    sampleFrames(videoPath, frameDir, maxFrames),
  ]);
  const audioMetrics = await inspectAudio(audioPath, transcript);
  const result = await evaluateAnswer({ profile, question, transcript, audioMetrics, framePaths });

  return {
    status: "completed",
    audioFile: path.relative(recordingsDir, audioPath),
    frameCount: framePaths.length,
    audioMetrics,
    ...result,
  };
}

function buildPrompt(profile) {
  const name = safeText(profile.name, "Biao");
  const role = safeText(profile.role, "AI engeering");

  return [
    "Create one English speaking assessment question based on this candidate profile.",
    "Return strict JSON only with keys: question, focus, expectedDurationSeconds, followUp.",
    "The question should be specific, realistic, and answerable without outside research.",
    "Avoid asking multiple unrelated questions.",
    "The answer must fit within 2 minutes. Set expectedDurationSeconds to 120.",
    "",
    `Name: ${name}`,
    `Role/background: ${role}`,
    "Target answer duration: 2 minutes",
  ].join("\n");
}

function fallbackQuestion(profile) {
  const role = safeText(profile.role, "AI engeering");
  return {
    question: `Tell me about a recent challenge in ${role}. What happened, what did you do, and what was the result?`,
    focus: "Fluency, organization, detail, and past-tense narration",
    expectedDurationSeconds: 120,
    followUp: "What would you do differently next time?",
  };
}

function persistQuestion(user, profile, question, model) {
  const record = {
    id: crypto.randomUUID(),
    openId: user.openId,
    createdAt: new Date().toISOString(),
    profile,
    question,
    model,
  };
  appendJsonLine(questionsMetadataFile, record);
  return record;
}

function questionForClient(record) {
  return {
    id: record.id,
    ...record.question,
  };
}

function findOwnedQuestion(questionId, openId) {
  return readJsonLines(questionsMetadataFile).find(
    (record) => record.id === questionId && recordOpenId(record) === openId,
  );
}

app.get("/auth/dingtalk", (req, res) => {
  if (!isDingTalkConfigured()) {
    return res.status(503).send("DingTalk authentication is not configured.");
  }

  res.redirect(buildDingTalkAuthUrl(req, safeText(req.query.redirect, "/")));
});

app.get("/auth/dingtalk/callback", async (req, res) => {
  if (!isDingTalkConfigured()) {
    return res.status(503).send("DingTalk authentication is not configured.");
  }

  const code = safeText(req.query.authCode || req.query.code);
  if (!code) {
    return res.status(400).send("Missing DingTalk authorization code.");
  }

  try {
    const token = await requestDingTalkUserAccessToken(code);
    const rawUser = await requestDingTalkCurrentUser(token.accessToken);
    const user = normalizeDingTalkUser(rawUser);
    if (!user.openId) {
      return res.status(403).send("DingTalk did not return an openId for this account.");
    }
    setSessionCookie(res, user);
    res.redirect(parseOAuthState(safeText(req.query.state)).redirectPath);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

app.post("/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  res.json({
    configured: isDingTalkConfigured(),
    user: readSession(req),
  });
});

app.post("/api/generate-question", requireAuth, async (req, res) => {
  const profile = req.body?.profile || {};
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash";

  if (!apiKey) {
    const record = persistQuestion(req.user, profile, fallbackQuestion(profile), "fallback");
    return res.status(500).json({
      error: "OPENROUTER_API_KEY is not configured.",
      question: questionForClient(record),
    });
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost",
        "X-Title": "EnglishEval",
      },
      body: JSON.stringify({
        model,
        temperature: 0.8,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are an expert English speaking examiner. Produce concise, practical interview-style assessment prompts.",
          },
          {
            role: "user",
            content: buildPrompt(profile),
          },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      return res.status(response.status).json({
        error: `OpenRouter request failed: ${detail}`,
        question: fallbackQuestion(profile),
      });
    }

    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    let question = content ? JSON.parse(content) : fallbackQuestion(profile);

    question = {
      question: safeText(question.question, fallbackQuestion(profile).question),
      focus: safeText(question.focus, "English speaking quality"),
      expectedDurationSeconds: Number(question.expectedDurationSeconds) || 90,
      followUp: safeText(question.followUp, ""),
    };

    const record = persistQuestion(req.user, profile, question, model);
    res.json({ question: questionForClient(record), model, user: req.user });
  } catch (error) {
    const record = persistQuestion(req.user, profile, fallbackQuestion(profile), "fallback");
    res.status(500).json({
      error: error.message,
      question: questionForClient(record),
    });
  }
});

app.post("/api/save-answer", requireAuth, upload.single("video"), async (req, res) => {
  const questionId = safeText(req.body.questionId);
  const questionRecord = findOwnedQuestion(questionId, req.user.openId);
  if (!questionRecord) {
    if (req.file) removePath(req.file.path);
    return res.status(400).json({ error: "The question is missing or does not belong to this user." });
  }

  const profile = questionRecord.profile;
  const question = questionRecord.question;
  const startedAt = safeText(req.body.startedAt);
  const finishedAt = new Date().toISOString();
  const id = crypto.randomUUID();

  if (!req.file) {
    const record = {
      id,
      hasVideo: false,
      filename: null,
      mimeType: null,
      bytes: 0,
      startedAt,
      finishedAt,
      openId: req.user.openId,
      user: req.user,
      profile,
      questionId,
      question,
      evaluation: {
        status: "skipped",
        reason: "No video was recorded for this question.",
      },
    };

    appendJsonLine(metadataFile, record);
    return res.json({
      ok: true,
      id,
      hasVideo: false,
      filename: null,
      path: null,
      evaluation: record.evaluation,
    });
  }

  const baseName = `${finishedAt.replace(/[:.]/g, "-")}-${id}`;
  const originalExtension = getExtensionFromMime(req.file.mimetype);
  let filename = `${baseName}.mp4`;
  let finalPath = path.join(recordingsDir, filename);
  let storedMimeType = "video/mp4";
  let convertedToMp4 = req.file.mimetype !== "video/mp4";

  try {
    if (req.file.mimetype === "video/mp4") {
      fs.renameSync(req.file.path, finalPath);
    } else {
      await convertToMp4(req.file.path, finalPath);
      fs.unlinkSync(req.file.path);
    }
  } catch (error) {
    filename = `${baseName}${originalExtension}`;
    finalPath = path.join(recordingsDir, filename);
    storedMimeType = req.file.mimetype;
    convertedToMp4 = false;
    fs.renameSync(req.file.path, finalPath);
  }

  const record = {
    id,
    hasVideo: true,
    filename,
    mimeType: storedMimeType,
    originalMimeType: req.file.mimetype,
    convertedToMp4,
    bytes: fs.statSync(finalPath).size,
    startedAt,
    finishedAt,
    openId: req.user.openId,
    user: req.user,
    profile,
    questionId,
    question,
  };

  try {
    record.evaluation = await evaluateSavedVideo({
      videoPath: finalPath,
      artifactBaseDir: path.join(artifactsDir, id),
      profile,
      question,
    });
  } catch (error) {
    record.evaluation = {
      status: "failed",
      reason: error.message,
    };
  }

  appendJsonLine(metadataFile, record);

  res.json({
    ok: true,
    id,
    hasVideo: true,
    filename,
    path: `/api/recordings/${id}/video`,
    evaluation: record.evaluation,
  });
});

app.get("/api/recordings", requireAuth, (req, res) => {
  const recordings = readJsonLines(metadataFile)
    .filter((record) => recordOpenId(record) === req.user.openId)
    .map((record) => ({
      ...record,
      hasVideo: record.hasVideo !== false && Boolean(record.filename),
      path: record.filename ? `/api/recordings/${record.id}/video` : null,
    }))
    .reverse();

  res.json({ recordings });
});

app.get("/api/recordings/:id/video", requireAuth, (req, res) => {
  const record = readJsonLines(metadataFile).find(
    (item) => item.id === req.params.id && recordOpenId(item) === req.user.openId,
  );
  if (!record || !record.filename || path.basename(record.filename) !== record.filename) {
    return res.status(404).json({ error: "Recording not found." });
  }

  const videoPath = path.join(recordingsDir, record.filename);
  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ error: "Recording file not found." });
  }

  res.type(record.mimeType || "video/mp4");
  res.sendFile(videoPath);
});

function sendAppShell(_req, res) {
  res.sendFile(path.join(publicDir, "index.html"));
}

app.get("/", sendAppShell);
app.get("/play", sendAppShell);
app.get("/history", sendAppShell);
app.get("/docs", (_req, res) => {
  res.sendFile(path.join(publicDir, "docs.html"));
});

app.listen(port, () => {
  console.log(`EnglishEval is running at http://localhost:${port}`);
});

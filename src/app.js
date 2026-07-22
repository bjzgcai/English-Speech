const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const express = require("express");
const multer = require("multer");
const QRCode = require("qrcode");
const ffmpegPath = require("ffmpeg-static");
const swaggerUiDistPath = require("swagger-ui-dist").getAbsoluteFSPath();
const config = require("./config");
const { appendJsonLine, readJsonLines, writeJsonLines } = require("./storage");
const { createQuestionService } = require("./questions");
const { registerPageRoutes } = require("./routes/pages");
const { buildMockPartnerUsers } = require("./mock-evaluations");
const {
  availableChallenges,
  challengeQuestion,
  currentChallenge,
  leaderboardForChallenge,
} = require("./game");

const app = express();
const {
  port,
  publicDir,
  recordingsDir,
  artifactsDir,
  recordingTmpDir,
  metadataFile,
  leaderboardIdentitiesFile,
  questionsMetadataFile,
  commentsMetadataFile,
  consentsMetadataFile,
} = config;
const sessionCookieName = "englisheval_session";
const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;
const oauthNonceCookieName = "englisheval_oauth_nonce";
const oauthStateTtlMs = 10 * 60 * 1000;
const privacyPolicyVersion = "2026-07-15";
const internalLlmChatCompletionsUrl =
  process.env.INTERNAL_LLM_CHAT_COMPLETIONS_URL ||
  "https://llm.zgci.org/hub/v1/chat/completions";
const internalLlmTranscriptionsUrl =
  process.env.INTERNAL_LLM_TRANSCRIPTIONS_URL ||
  "https://llm.zgci.org/hub/v1/audio/transcriptions";
const internalLlmQuestionModel = process.env.INTERNAL_LLM_QUESTION_MODEL || "glm";
const internalLlmTranscribeModel = process.env.INTERNAL_LLM_TRANSCRIBE_MODEL || "qwen-asr";
const openRouterChatCompletionsUrl =
  process.env.OPENROUTER_CHAT_COMPLETIONS_URL ||
  "https://openrouter.ihainan.me/api/v1/chat/completions";
const openRouterEvalModel = process.env.OPENROUTER_EVAL_MODEL || "google/gemini-3.5-flash";
const maximumVideoBytes = 250 * 1024 * 1024;
const standaloneEvaluationMaxSeconds = 2 * 60;
const answerCancellationTtlMs = 60 * 60 * 1000;
const canceledAnswerSaves = new Map();
const evaluationRubricStandard = Object.freeze({
  id: "english-speaking-evaluation",
  version: "1.2.0",
  name: "English Speaking Evaluation",
  scoreScale: {
    minimum: 0,
    maximum: 100,
    higherIsBetter: true,
  },
  overallScore: {
    method: "weighted_average",
    formula: "sum(dimension.score * dimension.weight / 100)",
    rounding: "nearest_integer",
  },
  scoreBands: [
    { minimum: 90, maximum: 100, level: "exceptional", meaning: "Consistently effective, precise, and confident." },
    { minimum: 80, maximum: 89, level: "strong", meaning: "Effective overall with only minor limitations." },
    { minimum: 70, maximum: 79, level: "competent", meaning: "Generally clear and successful with noticeable room to improve." },
    { minimum: 60, maximum: 69, level: "developing", meaning: "Meaning is usually recoverable, but weaknesses regularly affect delivery." },
    { minimum: 0, maximum: 59, level: "needs_improvement", meaning: "Frequent limitations materially reduce clarity or task success." },
  ],
  dimensions: [
    {
      key: "pronunciation",
      label: "Pronunciation / intelligibility",
      weight: 20,
      description: "Sound clarity, stress, rhythm, and how reliably a listener can understand the words.",
      evidence: ["speech intelligibility", "sound clarity", "stress and rhythm", "transcription reliability"],
      guidance: "Do not penalize accent when intelligibility is strong. State when evidence is limited.",
    },
    {
      key: "fluency",
      label: "Fluency",
      weight: 10,
      description: "Pacing, hesitation, pauses, self-correction, and the ability to sustain an answer.",
      evidence: ["speaking rate", "pause frequency and length", "hesitation", "continuity"],
      guidance: "Speed is not the goal; thoughtful pauses are acceptable when communication remains smooth.",
    },
    {
      key: "grammar",
      label: "Grammar",
      weight: 20,
      description: "Control of sentence structure, tense, agreement, and word order.",
      evidence: ["sentence formation", "tense control", "agreement", "word order", "effect of errors on meaning"],
      guidance: "Prioritize whether errors change or obscure meaning over isolated minor mistakes.",
    },
    {
      key: "vocabulary",
      label: "Vocabulary",
      weight: 15,
      description: "Range, precision, and appropriateness of word choice.",
      evidence: ["lexical range", "word precision", "appropriateness", "repetition and vague language"],
      guidance: "Reward precise, natural language rather than rare or unnecessarily complex words.",
    },
    {
      key: "coherence",
      label: "Coherence / task relevance",
      weight: 25,
      description: "Logical connection of ideas, relevance to the question, and clarity of the main point.",
      evidence: ["task completion", "logical sequence", "connections between ideas", "clear main point"],
      guidance: "Avoid double-counting language errors already scored under grammar, vocabulary, or fluency.",
    },
    {
      key: "visualDelivery",
      label: "Visual delivery",
      weight: 10,
      description: "Camera-facing posture, eye contact, facial engagement, framing, and distracting movement.",
      evidence: ["posture", "camera eye contact", "facial engagement", "framing", "distracting movement"],
      guidance: "Assess communication behavior only; do not score appearance or personal characteristics.",
    },
  ],
});

app.use((_req, res, next) => {
  res.set("Permissions-Policy", "camera=(self), microphone=(self)");
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use(
  express.static(publicDir, {
    index: false,
  }),
);
app.use("/api-docs/assets", express.static(swaggerUiDistPath));

const upload = multer({
  dest: recordingTmpDir,
  limits: {
    fileSize: maximumVideoBytes,
  },
  fileFilter: (_req, file, callback) => {
    const allowedMimeTypes = new Set([
      "video/mp4",
      "video/webm",
      "video/ogg",
      "video/quicktime",
      "video/x-matroska",
    ]);
    if (!allowedMimeTypes.has(file.mimetype)) {
      return callback(new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
    }
    callback(null, true);
  },
});

function safeText(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function decodeUtf8UploadFilename(value) {
  const filename = safeText(value);
  if (!filename) return "";

  const normalized = filename.normalize("NFC");
  const looksLikeUtf8DecodedAsLatin1 = /[\u0080-\u009f]|[ÃÂÐÑð]/.test(normalized);
  if (!looksLikeUtf8DecodedAsLatin1) return normalized;

  const sourceBytes = Buffer.from(normalized, "latin1");
  const decoded = sourceBytes.toString("utf8");
  if (
    decoded.includes("\uFFFD") ||
    !Buffer.from(decoded, "utf8").equals(sourceBytes)
  ) {
    return normalized;
  }
  return decoded.normalize("NFC");
}

function standaloneEvaluationTitle(filename) {
  const decodedFilename = decodeUtf8UploadFilename(filename) || "Standalone speech";
  const baseName = path.basename(decodedFilename);
  const withoutExtension = baseName.replace(/\.[^.]+$/, "");
  const normalized = withoutExtension
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (normalized || "Standalone speech").slice(0, 100);
}

function isPublicEvaluation(record) {
  const id = safeText(record?.id);
  return (
    record?.sourceType === "upload" &&
    record?.evaluation?.status === "completed" &&
    /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)
  );
}

function publicEvaluationForClient(record) {
  if (!isPublicEvaluation(record)) return null;

  const rubric = Object.fromEntries(
    Object.entries(record.evaluation.rubric || {}).map(([key, dimension]) => [
      key,
      {
        label: safeText(dimension?.label, "Evaluation dimension"),
        weight: Number.isFinite(Number(dimension?.weight)) ? Number(dimension.weight) : null,
        score: Number.isFinite(Number(dimension?.score)) ? Number(dimension.score) : null,
        feedback: safeText(dimension?.feedback),
        available: dimension?.available !== false,
      },
    ]),
  );
  const posterPath = path.join(artifactsDir, record.id, "frames", "frame-001.jpg");
  const hasVideo =
    safeText(record.filename) &&
    path.basename(record.filename) === record.filename &&
    fs.existsSync(path.join(recordingsDir, record.filename));
  const storedTitle = decodeUtf8UploadFilename(record.title);
  const originalFilename = decodeUtf8UploadFilename(record.originalFilename);

  return {
    id: record.id,
    title: originalFilename
      ? standaloneEvaluationTitle(originalFilename)
      : storedTitle || "Standalone speech",
    finishedAt: safeText(record.finishedAt),
    overallScore: Number.isFinite(Number(record.evaluation.overallScore))
      ? Number(record.evaluation.overallScore)
      : null,
    summary: safeText(record.evaluation.summary),
    rubric,
    mediaValidation: {
      visualEvaluated: record.evaluation.mediaValidation?.visualEvaluated === true,
      truncated: record.evaluation.mediaValidation?.truncated === true,
      notice: safeText(record.evaluation.mediaValidation?.notice),
    },
    posterPath: fs.existsSync(posterPath)
      ? `/api/public-evaluations/${encodeURIComponent(record.id)}/poster`
      : null,
    videoPath: hasVideo
      ? `/api/public-evaluations/${encodeURIComponent(record.id)}/video`
      : null,
  };
}

function shareServiceUrl(req) {
  const configuredUrl = safeText(process.env.APP_BASE_URL);
  if (configuredUrl) {
    try {
      const parsed = new URL(configuredUrl);
      if (["http:", "https:"].includes(parsed.protocol)) {
        parsed.hash = "";
        parsed.search = "";
        if (!parsed.pathname.endsWith("/")) parsed.pathname += "/";
        return parsed.toString();
      }
    } catch {
      // Fall back to the origin serving the current request.
    }
  }

  return `${req.protocol}://${req.get("host")}/`;
}

app.get("/api/share-qr", async (req, res, next) => {
  try {
    const png = await QRCode.toBuffer(shareServiceUrl(req), {
      type: "png",
      width: 320,
      margin: 2,
      errorCorrectionLevel: "M",
      color: {
        dark: "#17201B",
        light: "#FFFFFFFF",
      },
    });
    res.set({
      "Cache-Control": "private, max-age=3600",
      "Content-Type": "image/png",
    });
    res.send(png);
  } catch (error) {
    next(error);
  }
});

function getBaseUrl(req) {
  return process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
}

function isDingTalkConfigured() {
  return Boolean(process.env.DINGTALK_APP_KEY && process.env.DINGTALK_APP_SECRET);
}

function isDingTalkInAppConfigured() {
  return isDingTalkConfigured() && Boolean(safeText(process.env.DINGTALK_CORP_ID));
}

function secureTextEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requirePartnerApiKey(req, res, next) {
  const configuredKey = safeText(process.env.PARTNER_API_KEY);
  if (!configuredKey) {
    return res.status(503).json({ error: "Partner API is not configured." });
  }

  const authorization = safeText(req.get("authorization"));
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const providedKey = safeText(match?.[1]);
  if (!providedKey || !secureTextEqual(providedKey, configuredKey)) {
    res.set("WWW-Authenticate", 'Bearer realm="OScanner-Eng Partner API"');
    return res.status(401).json({ error: "A valid partner API bearer token is required." });
  }

  res.set("Cache-Control", "no-store");
  next();
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
  if (process.env.NODE_ENV === "production") {
    return true;
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

function setOAuthNonceCookie(res, nonce) {
  res.cookie(oauthNonceCookieName, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: useSecureSessionCookie(),
    maxAge: oauthStateTtlMs,
    path: "/auth/dingtalk/callback",
  });
}

function clearOAuthNonceCookie(res) {
  res.clearCookie(oauthNonceCookieName, {
    httpOnly: true,
    sameSite: "lax",
    secure: useSecureSessionCookie(),
    path: "/auth/dingtalk/callback",
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

function findCurrentPrivacyConsent(openId) {
  return readJsonLines(consentsMetadataFile)
    .reverse()
    .find(
      (record) =>
        safeText(record.openId) === safeText(openId) &&
        record.policyVersion === privacyPolicyVersion &&
        record.privacyAgreed === true &&
        record.sensitiveInfoAgreed === true,
    );
}

function requirePrivacyConsent(req, res, next) {
  if (!findCurrentPrivacyConsent(req.user.openId)) {
    return res.status(403).json({
      code: "PRIVACY_CONSENT_REQUIRED",
      error: "Please review and agree to the privacy policy before generating a question.",
      policyVersion: privacyPolicyVersion,
      privacyUrl: "/privacy",
    });
  }
  next();
}

function recordOpenId(record) {
  return safeText(record?.openId || record?.user?.openId);
}

function recordUserInfo(record) {
  const user = record?.user || {};
  return {
    openId: recordOpenId(record),
    unionId: safeText(record?.unionId || user.unionId),
    userId: safeText(record?.userId || user.userId),
    jobNumber: safeText(record?.jobNumber || user.jobNumber),
    name: safeText(record?.name || user.name),
    email: safeText(record?.email || user.email),
    orgEmail: safeText(record?.orgEmail || user.orgEmail),
  };
}

function mergeUserInfo(current, incoming) {
  return {
    openId: safeText(incoming.openId) || safeText(current.openId),
    unionId: safeText(incoming.unionId) || safeText(current.unionId),
    userId: safeText(incoming.userId) || safeText(current.userId),
    jobNumber: safeText(incoming.jobNumber) || safeText(current.jobNumber),
    name: safeText(incoming.name) || safeText(current.name),
    email: safeText(incoming.email) || safeText(current.email),
    orgEmail: safeText(incoming.orgEmail) || safeText(current.orgEmail),
  };
}

const cuteAliasAdjectives = Object.freeze([
  "Breezy", "Bright", "Bubbly", "Cheery", "Clever", "Cozy", "Dapper", "Gentle",
  "Happy", "Jolly", "Lucky", "Merry", "Peppy", "Sunny", "Swift", "Twinkly",
]);
const cuteAliasAnimals = Object.freeze([
  "Alpaca", "Bunny", "Capybara", "Dolphin", "Fox", "Koala", "Otter", "Panda",
  "Penguin", "Puffin", "Quokka", "Robin", "Seal", "Shiba", "Sparrow", "Turtle",
]);

function leaderboardIdentities() {
  const identities = new Map();
  readJsonLines(leaderboardIdentitiesFile).forEach((record) => {
    const openId = safeText(record?.openId);
    const alias = safeText(record?.alias);
    if (openId && alias && typeof record?.useAlias === "boolean") {
      identities.set(openId, { ...record, openId, alias });
    }
  });
  return identities;
}

function cuteAliasForUser(openId, identities = leaderboardIdentities()) {
  const digest = crypto.createHash("sha256").update(openId).digest();
  const adjective = cuteAliasAdjectives[digest[0] % cuteAliasAdjectives.length];
  const animal = cuteAliasAnimals[digest[1] % cuteAliasAnimals.length];
  const usedAliases = new Set(
    [...identities.values()]
      .filter((identity) => identity.openId !== openId)
      .map((identity) => identity.alias.toLocaleLowerCase("en-US")),
  );

  for (let offset = 0; offset < 10_000; offset += 1) {
    const suffix = ((digest.readUInt16BE(2) + offset) % 10_000).toString().padStart(4, "0");
    const candidate = `${adjective} ${animal} ${suffix}`;
    if (!usedAliases.has(candidate.toLocaleLowerCase("en-US"))) return candidate;
  }
  return `Friendly Player ${crypto.randomBytes(4).toString("hex")}`;
}

function normalizeLeaderboardAlias(value) {
  const alias = safeText(value).normalize("NFC").replace(/\s+/g, " ");
  if (
    alias.length < 2 ||
    alias.length > 32 ||
    /[\u0000-\u001f\u007f]/.test(alias)
  ) {
    return "";
  }
  return alias;
}

function leaderboardIdentityForClient(user, identity, identities = leaderboardIdentities()) {
  const alias = identity?.alias || cuteAliasForUser(user.openId, identities);
  const useAlias = identity?.useAlias === true;
  const actualName = safeText(user.name, "DingTalk user");
  return {
    alias,
    useAlias,
    actualName,
    displayName: useAlias ? alias : actualName,
    saved: Boolean(identity),
  };
}

function partnerEvaluation(record) {
  const evaluation = record?.evaluation || {};
  const rawStatus = safeText(evaluation.status);
  const status = ["completed", "skipped", "failed"].includes(rawStatus) ? rawStatus : "unknown";
  const rubricKeys = evaluationRubricStandard.dimensions.map((dimension) => dimension.key);
  const rubric = Object.fromEntries(
    rubricKeys
      .filter((key) => evaluation?.rubric?.[key])
      .map((key) => {
        const item = evaluation.rubric[key];
        return [
          key,
          {
            label: safeText(item?.label),
            weight: Number.isFinite(Number(item?.weight)) ? Number(item.weight) : null,
            score: Number.isFinite(Number(item?.score)) ? Number(item.score) : null,
            feedback: safeText(item?.feedback),
          },
        ];
      }),
  );
  const list = (value) =>
    Array.isArray(value) ? value.map((item) => safeText(item)).filter(Boolean) : [];

  return {
    id: safeText(record?.id),
    questionId: safeText(record?.questionId),
    startedAt: safeText(record?.startedAt),
    finishedAt: safeText(record?.finishedAt),
    profile: {
      name: safeText(record?.profile?.name),
      role: safeText(record?.profile?.role),
    },
    question: {
      question: safeText(record?.question?.question),
      focus: safeText(record?.question?.focus),
      expectedDurationSeconds: Number(record?.question?.expectedDurationSeconds) || null,
      followUp: safeText(record?.question?.followUp),
    },
    evaluation: {
      status,
      rubricId: safeText(evaluation.rubricId, evaluationRubricStandard.id),
      rubricVersion: safeText(evaluation.rubricVersion, evaluationRubricStandard.version),
      reason: safeText(evaluation.reason),
      overallScore: Number.isFinite(Number(evaluation.overallScore))
        ? Number(evaluation.overallScore)
        : null,
      summary: safeText(evaluation.summary),
      rubric,
      strengths: list(evaluation.strengths),
      improvements: list(evaluation.improvements),
    },
  };
}

function partnerUsers() {
  const questions = readJsonLines(questionsMetadataFile);
  const recordings = readJsonLines(metadataFile);
  const users = new Map(
    buildMockPartnerUsers(evaluationRubricStandard).map((user) => [user.openId, user]),
  );

  [...questions, ...recordings].forEach((record) => {
    const incoming = recordUserInfo(record);
    const key = incoming.openId || incoming.userId;
    if (!key) return;

    const current = users.get(key) || {
      ...incoming,
      evaluations: [],
    };
    const merged = {
      ...mergeUserInfo(current, incoming),
      evaluations: current.evaluations,
    };
    users.set(key, merged);
  });

  recordings.forEach((record) => {
    const incoming = recordUserInfo(record);
    const key = incoming.openId || incoming.userId;
    const user = users.get(key);
    if (user) user.evaluations.push(partnerEvaluation(record));
  });

  return [...users.values()]
    .map((user) => {
      user.evaluations.sort((left, right) => right.finishedAt.localeCompare(left.finishedAt));
      return {
        ...user,
        job_number: user.jobNumber,
        latestEvaluationAt: user.evaluations[0]?.finishedAt || "",
      };
    })
    .sort((left, right) => right.latestEvaluationAt.localeCompare(left.latestEvaluationAt));
}

function removePath(targetPath) {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch (error) {
    console.warn(`Unable to remove legacy path ${targetPath}: ${error.message}`);
  }
}

function validAnswerSaveId(value) {
  const id = safeText(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ? id
    : "";
}

function pruneCanceledAnswerSaves(now = Date.now()) {
  canceledAnswerSaves.forEach((cancellation, id) => {
    if (now - cancellation.requestedAt > answerCancellationTtlMs) {
      canceledAnswerSaves.delete(id);
    }
  });
}

function requestAnswerCancellation(id, openId) {
  pruneCanceledAnswerSaves();
  canceledAnswerSaves.set(id, { openId, requestedAt: Date.now() });
}

function isAnswerCancellationRequested(id, openId) {
  pruneCanceledAnswerSaves();
  return canceledAnswerSaves.get(id)?.openId === openId;
}

function discardPersistedAnswer({
  id,
  openId,
  metadataPath = metadataFile,
  recordingsPath = recordingsDir,
  artifactsPath = artifactsDir,
  requireSubmissionId = false,
}) {
  const records = readJsonLines(metadataPath);
  const matchesDiscard = (record) =>
    record.id === id &&
    recordOpenId(record) === openId &&
    (!requireSubmissionId || record.submissionId === id);
  const discardedRecords = records.filter(matchesDiscard);

  if (discardedRecords.length) {
    discardedRecords.forEach((record) => {
      if (record.filename && path.basename(record.filename) === record.filename) {
        removePath(path.join(recordingsPath, record.filename));
      }
    });
    writeJsonLines(
      metadataPath,
      records.filter((record) => !matchesDiscard(record)),
    );
    removePath(path.join(artifactsPath, id));
  }
  return discardedRecords.length;
}

function convertToMp4(inputPath, outputPath, { maximumDurationSeconds = null } = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-i",
      inputPath,
    ];
    if (maximumDurationSeconds) {
      args.push("-t", String(maximumDurationSeconds));
    }
    args.push(
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
    );
    const ffmpeg = spawn(ffmpegPath, args);

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

function inspectMedia(inputPath) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(ffmpegPath, ["-hide_banner", "-i", inputPath]);
    let output = "";
    ffmpeg.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    ffmpeg.on("error", reject);
    ffmpeg.on("close", () => {
      const hasAudio = /Stream #\S+.*Audio:/i.test(output);
      const hasVideo = /Stream #\S+.*Video:/i.test(output);
      if (!hasAudio && !hasVideo) {
        return reject(new Error("The file does not contain a usable audio or video stream."));
      }
      resolve({ hasAudio, hasVideo, durationSeconds: parseDurationSeconds(output) });
    });
  });
}

function limitStandaloneMediaInfo(mediaInfo) {
  const originalDurationSeconds = mediaInfo.durationSeconds;
  const hasKnownDuration = Number.isFinite(originalDurationSeconds);
  return {
    ...mediaInfo,
    truncated: hasKnownDuration && originalDurationSeconds > standaloneEvaluationMaxSeconds,
    originalDurationSeconds,
    durationSeconds: hasKnownDuration
      ? Math.min(originalDurationSeconds, standaloneEvaluationMaxSeconds)
      : standaloneEvaluationMaxSeconds,
  };
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

async function audioMaximumVolume(audioPath) {
  const output = await runFfmpeg([
    "-i",
    audioPath,
    "-af",
    "volumedetect",
    "-f",
    "null",
    "-",
  ]);
  return Number(output.match(/max_volume:\s*(-?[0-9.]+)\s*dB/i)?.[1]);
}

async function hasAudibleAudio(audioPath) {
  const maximumVolume = await audioMaximumVolume(audioPath);
  return Number.isFinite(maximumVolume) && maximumVolume >= -50;
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

function modelMessageText(message) {
  return safeText(message?.content) || safeText(message?.reasoning_content);
}

function isEvaluationTimeout(error) {
  return error?.name === "TimeoutError" || error?.cause?.name === "TimeoutError";
}

function evaluationTimeoutMessage(timeoutMs) {
  const timeoutSeconds = Math.round(timeoutMs / 1000);
  return `Evaluation timed out after ${timeoutSeconds} seconds. Your recording was saved, but feedback could not be generated. Please try again later.`;
}

function normalizeScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

const nonVerbalTranscriptWords = new Set([
  "ah",
  "er",
  "erm",
  "ha",
  "haha",
  "hm",
  "hmm",
  "hmmm",
  "huh",
  "mm",
  "mmm",
  "oh",
  "ooh",
  "uh",
  "uhh",
  "um",
  "umm",
]);

function meaningfulEnglishWords(transcript) {
  return safeText(transcript)
    .replace(/\[[^\]]*\]|\([^)]*\)|<[^>]*>/g, " ")
    .toLowerCase()
    .match(/[a-z]+(?:'[a-z]+)?/g)
    ?.filter((word) => !nonVerbalTranscriptWords.has(word)) || [];
}

function hasScorableEnglishSpeech(transcript) {
  return meaningfulEnglishWords(transcript).length >= 2;
}

function normalizeRedirectPath(value) {
  const redirectPath = safeText(value, "/");
  if (
    !redirectPath.startsWith("/") ||
    redirectPath.startsWith("//") ||
    redirectPath.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(redirectPath)
  ) {
    return "/";
  }
  return redirectPath;
}

function signOAuthStatePayload(payload) {
  return signSessionPayload(`oauth:${payload}`);
}

function createOAuthState(nonce, redirectPath, now = Date.now()) {
  const payload = base64UrlEncode(
    JSON.stringify({ nonce, redirectPath: normalizeRedirectPath(redirectPath), ts: now }),
  );
  return `${payload}.${signOAuthStatePayload(payload)}`;
}

function buildDingTalkAuthUrl(req, nonce, redirectPath = "/") {
  const redirectUri = `${getBaseUrl(req)}/auth/dingtalk/callback`;
  const state = createOAuthState(nonce, redirectPath);
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

function parseOAuthState(value, expectedNonce, now = Date.now()) {
  if (!value || !expectedNonce) return null;
  try {
    const [payload, signature, extra] = value.split(".");
    if (!payload || !signature || extra || !secureTextEqual(signature, signOAuthStatePayload(payload))) {
      return null;
    }
    const state = JSON.parse(base64UrlDecode(payload));
    if (
      !secureTextEqual(safeText(state.nonce), expectedNonce) ||
      !Number.isFinite(state.ts) ||
      state.ts > now + 30_000 ||
      now - state.ts > oauthStateTtlMs
    ) {
      return null;
    }
    return {
      redirectPath: normalizeRedirectPath(state.redirectPath),
    };
  } catch {
    return null;
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

async function requestDingTalkAppAccessToken() {
  const response = await fetch("https://api.dingtalk.com/v1.0/oauth2/accessToken", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      appKey: process.env.DINGTALK_APP_KEY,
      appSecret: process.env.DINGTALK_APP_SECRET,
    }),
  });

  if (!response.ok) {
    throw new Error(`DingTalk app token request failed with HTTP ${response.status}.`);
  }

  const token = await response.json();
  if (!safeText(token?.accessToken)) {
    throw new Error("DingTalk app token response did not include an access token.");
  }
  return token.accessToken;
}

async function requestDingTalkInAppUserInfo(accessToken, authCode) {
  const url = new URL("https://oapi.dingtalk.com/topapi/v2/user/getuserinfo");
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ code: authCode }),
  });

  if (!response.ok) {
    throw new Error(`DingTalk in-app identity lookup failed with HTTP ${response.status}.`);
  }

  const body = await response.json();
  if (Number(body?.errcode) !== 0) {
    throw new Error(
      `DingTalk in-app identity lookup failed with error ${body?.errcode ?? "unknown"}.`,
    );
  }
  if (!safeText(body?.result?.userid || body?.result?.userId)) {
    throw new Error("DingTalk in-app identity lookup did not return an organization user ID.");
  }
  return body.result;
}

async function requestDingTalkUserIdByUnionId(accessToken, unionId) {
  const url = new URL("https://oapi.dingtalk.com/topapi/user/getbyunionid");
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ unionid: unionId }),
  });

  if (!response.ok) {
    throw new Error(`DingTalk user ID lookup failed with HTTP ${response.status}.`);
  }

  const body = await response.json();
  if (Number(body?.errcode) !== 0) {
    throw new Error(`DingTalk user ID lookup failed with error ${body?.errcode ?? "unknown"}.`);
  }

  const userId = safeText(body?.result?.userid || body?.result?.userId);
  if (!userId) {
    throw new Error("DingTalk user ID lookup did not return an organization user ID.");
  }
  return userId;
}

async function requestDingTalkUserDetails(accessToken, userId) {
  const response = await fetch(
    `https://api.dingtalk.com/v1.0/contact/users/${encodeURIComponent(userId)}`,
    {
      headers: {
        "x-acs-dingtalk-access-token": accessToken,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`DingTalk user details lookup failed with HTTP ${response.status}.`);
  }

  return response.json();
}

async function requestDingTalkOrganizationUser(rawUser) {
  const unionId = safeText(rawUser?.unionId);
  if (!unionId) return null;

  const accessToken = await requestDingTalkAppAccessToken();
  const userId =
    safeText(rawUser?.userId) || (await requestDingTalkUserIdByUnionId(accessToken, unionId));
  const details = await requestDingTalkUserDetails(accessToken, userId);
  return { ...details, userId };
}

function normalizeDingTalkUser(rawUser, organizationUser = null) {
  return {
    openId: safeText(rawUser?.openId),
    unionId: safeText(rawUser?.unionId),
    userId: safeText(
      organizationUser?.userId || organizationUser?.userid || rawUser?.userId || rawUser?.userid,
    ),
    jobNumber: safeText(organizationUser?.jobNumber || organizationUser?.job_number),
    email: safeText(organizationUser?.email || rawUser?.email),
    orgEmail: safeText(organizationUser?.orgEmail || organizationUser?.org_email),
    name: safeText(rawUser?.nick || rawUser?.name, "DingTalk user"),
    avatarUrl: safeText(rawUser?.avatarUrl),
    mobile: safeText(rawUser?.mobile),
  };
}

function knownOpenIdForDingTalkUser(user) {
  const unionId = safeText(user?.unionId);
  const userId = safeText(user?.userId);
  if (!unionId && !userId) return "";

  return [...readJsonLines(questionsMetadataFile), ...readJsonLines(metadataFile)]
    .reverse()
    .map(recordUserInfo)
    .find(
      (candidate) =>
        safeText(candidate.openId) &&
        ((unionId && safeText(candidate.unionId) === unionId) ||
          (userId && safeText(candidate.userId) === userId)),
    )?.openId || "";
}

function inAppOwnerOpenId(user) {
  const knownOpenId = knownOpenIdForDingTalkUser(user);
  if (knownOpenId) return knownOpenId;

  const stableUserId = safeText(user?.unionId || user?.userId);
  const corpId = safeText(process.env.DINGTALK_CORP_ID);
  if (!stableUserId || !corpId) return "";
  const digest = crypto
    .createHash("sha256")
    .update(`dingtalk-in-app\0${corpId}\0${stableUserId}`)
    .digest("base64url");
  return `inapp_${digest}`;
}

function normalizeDingTalkInAppUser(rawUser, organizationUser = null) {
  const user = {
    openId: "",
    unionId: safeText(
      organizationUser?.unionId || organizationUser?.unionid || rawUser?.unionId || rawUser?.unionid,
    ),
    userId: safeText(
      organizationUser?.userId || organizationUser?.userid || rawUser?.userId || rawUser?.userid,
    ),
    jobNumber: safeText(organizationUser?.jobNumber || organizationUser?.job_number),
    email: safeText(organizationUser?.email),
    orgEmail: safeText(organizationUser?.orgEmail || organizationUser?.org_email),
    name: safeText(organizationUser?.name || rawUser?.name, "DingTalk user"),
    avatarUrl: safeText(organizationUser?.avatarUrl || organizationUser?.avatar),
    mobile: safeText(organizationUser?.mobile),
    identitySource: "dingtalk-in-app",
  };
  user.openId = inAppOwnerOpenId(user);
  return user;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function nonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function normalizeEvaluation(
  rawEvaluation,
  { visualAvailable = true, hasScorableSpeech = true, transcript = "" } = {},
) {
  const modelSpeechFlag = rawEvaluation?.hasScorableEnglishSpeech;
  const modelFoundScorableSpeech =
    modelSpeechFlag !== false && safeText(modelSpeechFlag).toLowerCase() !== "false";
  const shouldScore = hasScorableSpeech && modelFoundScorableSpeech;
  const rubric = Object.fromEntries(
    evaluationRubricStandard.dimensions.map((dimension) => [
      dimension.key,
      {
        label: dimension.label,
        weight: dimension.weight,
        score:
          dimension.key === "visualDelivery" && !visualAvailable
            ? null
            : shouldScore
              ? normalizeScore(rawEvaluation?.rubric?.[dimension.key]?.score)
              : 0,
        feedback:
          dimension.key === "visualDelivery" && !visualAvailable
            ? "Not scored because the file contains usable speech but no video picture."
            : shouldScore
              ? safeText(rawEvaluation?.rubric?.[dimension.key]?.feedback)
              : "No scorable English speech was detected, so this dimension received 0.",
        available: dimension.key !== "visualDelivery" || visualAvailable,
      },
    ]),
  );

  const availableItems = Object.values(rubric).filter((item) => item.available);
  const availableWeight = availableItems.reduce((total, item) => total + item.weight, 0);
  const overallScore = availableItems.reduce(
    (total, item) => total + item.score * (item.weight / availableWeight),
    0,
  );

  return {
    rubricId: evaluationRubricStandard.id,
    rubricVersion: evaluationRubricStandard.version,
    hasScorableEnglishSpeech: shouldScore,
    overallScore: shouldScore ? normalizeScore(overallScore) : 0,
    summary: shouldScore
      ? safeText(rawEvaluation?.summary, "Evaluation completed.")
      : "No scorable English speech was detected. This attempt received 0 out of 100.",
    transcript: safeText(transcript, safeText(rawEvaluation?.transcript)),
    improvedAnswer: shouldScore
      ? safeText(rawEvaluation?.improvedAnswer, safeText(rawEvaluation?.betterAnswer)).slice(0, 6000)
      : "",
    rubric,
    strengths: shouldScore && Array.isArray(rawEvaluation?.strengths)
      ? rawEvaluation.strengths.map((item) => safeText(item)).filter(Boolean).slice(0, 4)
      : [],
    improvements: shouldScore && Array.isArray(rawEvaluation?.improvements)
      ? rawEvaluation.improvements.map((item) => safeText(item)).filter(Boolean).slice(0, 4)
      : shouldScore
        ? []
        : ["Start speaking in English and give at least one complete response to the question."],
    model: {
      transcribe: internalLlmTranscribeModel,
      evaluate: openRouterEvalModel,
    },
  };
}

function transcriptionMimeType(audioPath) {
  return path.extname(audioPath).toLowerCase() === ".wav" ? "audio/wav" : "audio/mpeg";
}

function isRetryableTranscriptionError(error) {
  return error?.retryable === true || /upstream_error|BytesIO object|fetch failed/i.test(
    String(error?.message || error),
  );
}

function transcriptionRetryDelay(attempt) {
  return new Promise((resolve) => setTimeout(resolve, attempt * 300));
}

async function transcribeAudioFile(audioPath) {
  const apiKey = process.env.INTERNAL_LLM_API_KEY;
  const maximumAttempts = Math.min(
    positiveInteger(Number(process.env.TRANSCRIPTION_MAX_ATTEMPTS), 3),
    5,
  );

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const formData = new FormData();
    const file = new Blob([fs.readFileSync(audioPath)], {
      type: transcriptionMimeType(audioPath),
    });

    formData.append("model", internalLlmTranscribeModel);
    formData.append("file", file, path.basename(audioPath));
    formData.append("language", "en");

    try {
      const response = await fetch(internalLlmTranscriptionsUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const detail = await response.text();
        const error = new Error(`Transcription failed: ${detail}`);
        error.retryable = response.status >= 500;
        throw error;
      }

      const payload = await response.json();
      return safeText(payload.text);
    } catch (error) {
      if (attempt === maximumAttempts || !isRetryableTranscriptionError(error)) throw error;
      await transcriptionRetryDelay(attempt);
    }
  }

  return "";
}

function isTranscriptionSizeError(error) {
  return /embedding tokens|encoder cache size|reduce the input size|limit-mm-per-prompt/i.test(
    String(error?.message || error),
  );
}

function isTranscriptionFileOpenError(error) {
  return /BytesIO object|File does not exist or is not a regular file|possibly a pipe|Failed to apply Qwen3ASRProcessor/i.test(
    String(error?.message || error),
  );
}

async function transcribeAlternateAudioFormat(audioPath) {
  const sourceIsWav = path.extname(audioPath).toLowerCase() === ".wav";
  const fallbackPath = path.join(
    path.dirname(audioPath),
    sourceIsWav ? "transcription-fallback.mp3" : "transcription-fallback.wav",
  );
  removePath(fallbackPath);

  try {
    const args = [
      "-y",
      "-i",
      audioPath,
      "-ac",
      "1",
      "-ar",
      "16000",
    ];
    if (sourceIsWav) {
      args.push("-b:a", "64k");
    } else {
      args.push("-c:a", "pcm_s16le");
    }
    args.push(fallbackPath);
    await runFfmpeg(args);
    return await transcribeAudioFile(fallbackPath);
  } finally {
    removePath(fallbackPath);
  }
}

async function transcribeAudioFileWithFormatFallback(audioPath) {
  try {
    return await transcribeAudioFile(audioPath);
  } catch (error) {
    if (!isTranscriptionFileOpenError(error)) throw error;
    return transcribeAlternateAudioFormat(audioPath);
  }
}

async function transcribeAudioInChunks(audioPath, chunkSeconds = 30) {
  const chunkDir = path.join(path.dirname(audioPath), "transcription-chunks");
  removePath(chunkDir);
  fs.mkdirSync(chunkDir, { recursive: true });

  try {
    await runFfmpeg([
      "-y",
      "-i",
      audioPath,
      "-f",
      "segment",
      "-segment_time",
      String(chunkSeconds),
      "-reset_timestamps",
      "1",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      path.join(chunkDir, "chunk-%03d.wav"),
    ]);

    const chunkPaths = fs
      .readdirSync(chunkDir)
      .filter((filename) => filename.endsWith(".wav"))
      .sort()
      .map((filename) => path.join(chunkDir, filename));
    if (!chunkPaths.length) {
      throw new Error("The audio could not be divided into transcription segments.");
    }

    const transcriptParts = [];
    for (let index = 0; index < chunkPaths.length; index += 1) {
      try {
        const maximumVolume = await audioMaximumVolume(chunkPaths[index]);
        if (!Number.isFinite(maximumVolume) || maximumVolume < -50) continue;
        const part = await transcribeAudioFileWithFormatFallback(chunkPaths[index]);
        if (part) transcriptParts.push(part);
      } catch (error) {
        if (isTranscriptionSizeError(error)) {
          throw new Error(
            `Audio segment ${index + 1} is still too long for the transcription service.`,
          );
        }
        throw error;
      }
    }
    return transcriptParts.join(" ").trim();
  } finally {
    removePath(chunkDir);
  }
}

async function transcribeAudio(audioPath, { durationSeconds = null } = {}) {
  const configuredChunkSeconds = positiveInteger(
    Number(process.env.TRANSCRIPTION_CHUNK_SECONDS),
    30,
  );
  const chunkSeconds = Math.min(configuredChunkSeconds, 40);

  if (durationSeconds && durationSeconds > chunkSeconds) {
    return transcribeAudioInChunks(audioPath, chunkSeconds);
  }

  try {
    return await transcribeAudioFileWithFormatFallback(audioPath);
  } catch (error) {
    if (!isTranscriptionSizeError(error)) throw error;
    return transcribeAudioInChunks(audioPath, chunkSeconds);
  }
}

function buildEvaluationPrompt({ profile, question, transcript, audioMetrics, frameCount, evaluationMode }) {
  const weights = evaluationRubricStandard.dimensions
    .map((dimension) => `${dimension.key} ${dimension.weight}`)
    .join(", ");
  const rubricSchema = Object.fromEntries(
    evaluationRubricStandard.dimensions.map((dimension) => [
      dimension.key,
      { score: 0, feedback: "" },
    ]),
  );
  return [
    "Evaluate this user's English speaking performance from the transcript and sampled video frames.",
    "Return strict JSON only. Do not include markdown.",
    "Use a 0-100 score for each dimension.",
    "Set hasScorableEnglishSpeech to false when the response contains no meaningful English words or only silence, noise, humming, filler sounds, or isolated exclamations. In that case, return 0 for every dimension and 0 overall.",
    `The weights must be: ${weights}.`,
    `Apply this rubric standard: ${JSON.stringify({ scoreBands: evaluationRubricStandard.scoreBands, dimensions: evaluationRubricStandard.dimensions })}`,
    "Use the audio metrics to evaluate fluency and pacing. Pronunciation should be inferred from transcription reliability and intelligibility clues.",
    "Be direct, specific, and useful to the learner. Do not over-penalize accent when intelligibility is strong.",
    "Create improvedAnswer as a polished, more clearly structured version of the user's transcript.",
    "Preserve the user's first-person voice, intended meaning, facts, examples, and level of certainty. Never invent or infer missing experiences, achievements, numbers, events, reasons, or opinions.",
    "Correct grammar, sentence structure, word choice, repetition, and awkward phrasing while keeping the result natural for spoken English.",
    "Organize improvedAnswer into short paragraphs: a direct answer or main point, connected supporting details, a concrete example only when the transcript provides one, and a concise close.",
    "Keep improvedAnswer close to the transcript's length and no longer than 1.25 times its length. If the transcript is very short, polish only the available content instead of filling factual gaps.",
    evaluationMode === "standalone-speech"
      ? "This is a standalone speech, not an answer to a question. Score coherence by whether the speaker stays internally consistent, develops a stable main point, and connects ideas without contradictions. Do not assess task relevance."
      : "This is an answer to the supplied question. Include task relevance when scoring coherence.",
    frameCount > 0
      ? "Use the sampled frames to score visual delivery."
      : "No visual frames are available. Do not infer visual delivery; return 0 for that dimension and explain that it was not assessed.",
    "Schema:",
    JSON.stringify({
      hasScorableEnglishSpeech: true,
      overallScore: 0,
      summary: "",
      transcript: "",
      improvedAnswer: "",
      rubric: rubricSchema,
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

async function evaluateAnswer({
  profile,
  question,
  transcript,
  audioMetrics,
  framePaths,
  evaluationMode = "question-answer",
}) {
  const transcriptHasScorableSpeech = hasScorableEnglishSpeech(transcript);
  if (!transcriptHasScorableSpeech) {
    return normalizeEvaluation(
      {},
      {
        visualAvailable: framePaths.length > 0,
        hasScorableSpeech: false,
        transcript,
      },
    );
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  const requestTimeoutMs = positiveInteger(Number(process.env.EVAL_REQUEST_TIMEOUT_MS), 600_000);
  const content = [
    {
      type: "text",
      text: buildEvaluationPrompt({
        profile,
        question,
        transcript,
        audioMetrics,
        frameCount: framePaths.length,
        evaluationMode,
      }),
    },
    ...framePaths.map((framePath) => ({
      type: "image_url",
      image_url: {
        url: fileToDataUrl(framePath, "image/jpeg"),
      },
    })),
  ];

  try {
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-OpenRouter-Title": "OScanner-Eng",
    };
    if (safeText(process.env.APP_BASE_URL)) {
      headers["HTTP-Referer"] = safeText(process.env.APP_BASE_URL);
    }

    const response = await fetch(openRouterChatCompletionsUrl, {
      method: "POST",
      signal: AbortSignal.timeout(requestTimeoutMs),
      headers,
      body: JSON.stringify({
        model: openRouterEvalModel,
        temperature: 0.1,
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
      throw new Error(`OpenRouter evaluation failed: ${detail}`);
    }

    const payload = await response.json();
    const outputText = modelMessageText(payload.choices?.[0]?.message);
    return normalizeEvaluation(extractJsonObject(outputText), {
      visualAvailable: framePaths.length > 0,
      hasScorableSpeech: transcriptHasScorableSpeech,
      transcript,
    });
  } catch (error) {
    if (isEvaluationTimeout(error)) {
      throw new Error(evaluationTimeoutMessage(requestTimeoutMs), { cause: error });
    }
    throw error;
  }
}

async function evaluateSavedVideo({
  videoPath,
  artifactBaseDir,
  profile,
  question,
  evaluationMode = "question-answer",
  mediaInfo = null,
}) {
  const missingConfiguration = [
    !process.env.INTERNAL_LLM_API_KEY && "INTERNAL_LLM_API_KEY",
    !process.env.OPENROUTER_API_KEY && "OPENROUTER_API_KEY",
  ].filter(Boolean);
  if (missingConfiguration.length) {
    return {
      status: "skipped",
      reason: `${missingConfiguration.join(" and ")} ${missingConfiguration.length === 1 ? "is" : "are"} not configured.`,
    };
  }

  const audioPath = path.join(artifactBaseDir, "audio.mp3");
  const frameDir = path.join(artifactBaseDir, "frames");

  fs.mkdirSync(artifactBaseDir, { recursive: true });
  const inspectedMedia = mediaInfo || (await inspectMedia(videoPath));
  if (!inspectedMedia.hasAudio) {
    throw new Error("The video has a picture but no usable audio track, so speech cannot be evaluated.");
  }
  await extractAudio(videoPath, audioPath);
  const audibleAudio = await hasAudibleAudio(audioPath);
  const maxFrames = positiveInteger(Number(process.env.EVAL_MAX_FRAMES), 18);
  const [transcript, framePaths] = await Promise.all([
    audibleAudio
      ? transcribeAudio(audioPath, { durationSeconds: inspectedMedia.durationSeconds })
      : Promise.resolve(""),
    inspectedMedia.hasVideo ? sampleFrames(videoPath, frameDir, maxFrames) : Promise.resolve([]),
  ]);
  const audioMetrics = await inspectAudio(audioPath, transcript);
  const result = await evaluateAnswer({
    profile,
    question,
    transcript,
    audioMetrics,
    framePaths,
    evaluationMode,
  });

  return {
    status: "completed",
    audioFile: path.relative(recordingsDir, audioPath),
    frameCount: framePaths.length,
    mediaValidation: {
      hasAudio: inspectedMedia.hasAudio,
      hasVideo: inspectedMedia.hasVideo,
      visualEvaluated: framePaths.length > 0,
      truncated: inspectedMedia.truncated === true,
      originalDurationSeconds: inspectedMedia.originalDurationSeconds || null,
      evaluatedDurationSeconds: inspectedMedia.durationSeconds || null,
      notice: [
        inspectedMedia.truncated
          ? "The video was longer than two minutes, so only the first two minutes were evaluated."
          : "",
        !result.hasScorableEnglishSpeech
          ? "No scorable English speech was detected, so this attempt received 0 out of 100."
          : framePaths.length
            ? "Speech and visual delivery were evaluated."
            : "Speech was evaluated from audio. Visual delivery was not scored because the file has no video picture.",
      ]
        .filter(Boolean)
        .join(" "),
    },
    audioMetrics,
    ...result,
  };
}

const {
  buildPrompt,
  fallbackQuestion,
  persistQuestion,
  questionForClient,
  findOwnedQuestion,
} = createQuestionService({ safeText, recordOpenId });

app.get("/auth/dingtalk", (req, res) => {
  if (!isDingTalkConfigured()) {
    return res.status(503).send("DingTalk authentication is not configured.");
  }

  const nonce = crypto.randomBytes(24).toString("base64url");
  setOAuthNonceCookie(res, nonce);
  res.redirect(buildDingTalkAuthUrl(req, nonce, req.query.redirect));
});

app.get("/auth/dingtalk/callback", async (req, res) => {
  if (!isDingTalkConfigured()) {
    return res.status(503).send("DingTalk authentication is not configured.");
  }

  const code = safeText(req.query.authCode || req.query.code);
  if (!code) {
    return res.status(400).send("Missing DingTalk authorization code.");
  }
  const oauthState = parseOAuthState(
    safeText(req.query.state),
    parseCookies(req)[oauthNonceCookieName],
  );
  clearOAuthNonceCookie(res);
  if (!oauthState) {
    return res.status(400).send("Invalid or expired DingTalk OAuth state.");
  }

  try {
    const token = await requestDingTalkUserAccessToken(code);
    const rawUser = await requestDingTalkCurrentUser(token.accessToken);
    let organizationUser = null;
    try {
      organizationUser = await requestDingTalkOrganizationUser(rawUser);
    } catch (error) {
      console.warn(`Unable to enrich DingTalk user details: ${error.message}`);
    }
    const user = normalizeDingTalkUser(rawUser, organizationUser);
    if (!user.openId) {
      return res.status(403).send("DingTalk did not return an openId for this account.");
    }
    setSessionCookie(res, user);
    res.redirect(oauthState.redirectPath);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

app.post("/auth/dingtalk/in-app", async (req, res) => {
  if (!isDingTalkInAppConfigured()) {
    return res.status(503).json({ error: "DingTalk in-app authentication is not configured." });
  }

  const authCode = safeText(req.body?.authCode);
  if (!authCode || authCode.length > 512) {
    return res.status(400).json({ error: "A valid DingTalk in-app authorization code is required." });
  }

  try {
    const accessToken = await requestDingTalkAppAccessToken();
    const rawUser = await requestDingTalkInAppUserInfo(accessToken, authCode);
    const userId = safeText(rawUser?.userid || rawUser?.userId);
    let organizationUser = null;
    try {
      organizationUser = await requestDingTalkUserDetails(accessToken, userId);
    } catch (error) {
      console.warn(`Unable to enrich DingTalk in-app user details: ${error.message}`);
    }
    const user = normalizeDingTalkInAppUser(rawUser, organizationUser);
    if (!user.openId) {
      return res.status(403).json({ error: "DingTalk did not return a stable user identity." });
    }
    setSessionCookie(res, user);
    res.set("Cache-Control", "no-store");
    res.json({ user });
  } catch (error) {
    console.error(`DingTalk in-app authentication failed: ${error.message}`);
    res.status(502).json({ error: "DingTalk in-app authentication could not be completed." });
  }
});

app.post("/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/v1/users", requirePartnerApiKey, (req, res) => {
  const filterKeys = ["openId", "userId", "jobNumber", "email", "orgEmail"];
  let users = partnerUsers().filter((user) =>
    filterKeys.every((key) => {
      const requested = safeText(req.query[key]).toLowerCase();
      return !requested || safeText(user[key]).toLowerCase() === requested;
    }) &&
    (!safeText(req.query.job_number) ||
      safeText(user.job_number).toLowerCase() === safeText(req.query.job_number).toLowerCase()),
  );
  const total = users.length;
  const limit = Math.min(positiveInteger(req.query.limit, 50), 200);
  const offset = nonNegativeInteger(req.query.offset);
  users = users.slice(offset, offset + limit);

  res.json({
    users,
    pagination: { total, limit, offset },
  });
});

app.get("/api/v1/users/:userId", requirePartnerApiKey, (req, res) => {
  const requestedUserId = safeText(req.params.userId);
  const user = partnerUsers().find((item) => item.userId === requestedUserId);
  if (!user) {
    return res.status(404).json({ error: "User not found." });
  }
  res.json({ user });
});

app.get("/api/v1/rubrics", requirePartnerApiKey, (_req, res) => {
  res.json({ rubric: evaluationRubricStandard });
});

app.get("/api/me", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    configured: isDingTalkConfigured(),
    inAppAuth: {
      configured: isDingTalkInAppConfigured(),
      corpId: isDingTalkInAppConfigured() ? safeText(process.env.DINGTALK_CORP_ID) : "",
    },
    user: readSession(req),
  });
});

app.get("/api/privacy-consent", requireAuth, (req, res) => {
  const consent = findCurrentPrivacyConsent(req.user.openId);
  res.set("Cache-Control", "no-store");
  res.json({
    agreed: Boolean(consent),
    policyVersion: privacyPolicyVersion,
    acceptedAt: consent?.acceptedAt || null,
  });
});

app.post("/api/privacy-consent", requireAuth, (req, res) => {
  if (req.body?.privacyAgreed !== true || req.body?.sensitiveInfoAgreed !== true) {
    return res.status(400).json({
      error: "Both privacy acknowledgements are required to use the speaking evaluation.",
    });
  }

  const existingConsent = findCurrentPrivacyConsent(req.user.openId);
  if (existingConsent) {
    return res.json({
      agreed: true,
      policyVersion: privacyPolicyVersion,
      acceptedAt: existingConsent.acceptedAt,
    });
  }

  const consent = {
    id: crypto.randomUUID(),
    openId: req.user.openId,
    userId: safeText(req.user.userId),
    policyVersion: privacyPolicyVersion,
    privacyAgreed: true,
    sensitiveInfoAgreed: true,
    acceptedAt: new Date().toISOString(),
  };
  appendJsonLine(consentsMetadataFile, consent);
  res.status(201).json({
    agreed: true,
    policyVersion: consent.policyVersion,
    acceptedAt: consent.acceptedAt,
  });
});

const commentPages = new Set(["prepare", "methodology"]);

function commentForClient(comment) {
  return {
    id: comment.id,
    page: comment.page,
    parentId: comment.parentId || null,
    username: comment.username,
    content: comment.content,
    createdAt: comment.createdAt,
  };
}

app.get("/api/comments", (req, res) => {
  const page = safeText(req.query.page).toLowerCase();
  if (!commentPages.has(page)) {
    return res.status(400).json({ error: "A valid comment page is required." });
  }

  const comments = readJsonLines(commentsMetadataFile)
    .filter((comment) => comment.page === page)
    .map(commentForClient);
  res.set("Cache-Control", "no-store");
  res.json({ comments });
});

app.post("/api/comments", requireAuth, (req, res) => {
  const page = safeText(req.body?.page).toLowerCase();
  const content = safeText(req.body?.content);
  const requestedParentId = safeText(req.body?.parentId);

  if (!commentPages.has(page)) {
    return res.status(400).json({ error: "A valid comment page is required." });
  }
  if (!content || content.length > 1000) {
    return res.status(400).json({ error: "Comments must contain 1 to 1000 characters." });
  }

  let parentId = null;
  if (requestedParentId) {
    const requestedParent = readJsonLines(commentsMetadataFile).find(
      (comment) => comment.id === requestedParentId && comment.page === page,
    );
    if (!requestedParent) {
      return res.status(404).json({ error: "The comment you are replying to was not found." });
    }
    parentId = requestedParent.parentId || requestedParent.id;
  }

  const comment = {
    id: crypto.randomUUID(),
    page,
    parentId,
    openId: req.user.openId,
    username: safeText(req.user.name, "DingTalk user"),
    content,
    createdAt: new Date().toISOString(),
  };
  appendJsonLine(commentsMetadataFile, comment);
  res.status(201).json({ comment: commentForClient(comment) });
});

function gameChallengeForClient(challenge) {
  return {
    id: challenge.id,
    title: challenge.title,
    question: challenge.question,
    focus: challenge.focus,
    expectedDurationSeconds: challenge.expectedDurationSeconds,
    followUp: challenge.followUp,
    startsAt: challenge.startsAt,
    endsAt: challenge.endsAt,
    structuralGuide: challenge.structuralGuide,
    prizeDraft: challenge.prizeDraft || null,
  };
}

app.get("/api/game/challenge", requireAuth, (_req, res) => {
  const challenge = currentChallenge();
  res.set("Cache-Control", "no-store");
  res.json({
    challenge: gameChallengeForClient(challenge),
    challenges: availableChallenges().map(gameChallengeForClient),
  });
});

app.get("/api/game/identity", requireAuth, (req, res) => {
  const identities = leaderboardIdentities();
  res.set("Cache-Control", "no-store");
  res.json({
    identity: leaderboardIdentityForClient(
      req.user,
      identities.get(req.user.openId),
      identities,
    ),
  });
});

app.post("/api/game/identity", requireAuth, (req, res) => {
  if (typeof req.body?.useAlias !== "boolean") {
    return res.status(400).json({ error: "Choose whether to show your alias or actual name." });
  }

  const identities = leaderboardIdentities();
  const current = identities.get(req.user.openId);
  const alias = req.body?.alias === undefined
    ? current?.alias || cuteAliasForUser(req.user.openId, identities)
    : normalizeLeaderboardAlias(req.body.alias);
  if (!alias) {
    return res.status(400).json({ error: "Your alias must contain 2 to 32 characters." });
  }

  const duplicate = [...identities.values()].find(
    (identity) =>
      identity.openId !== req.user.openId &&
      identity.alias.toLocaleLowerCase("en-US") === alias.toLocaleLowerCase("en-US"),
  );
  if (duplicate) {
    return res.status(409).json({ error: "That alias is already in use. Try another cute name." });
  }

  const identity = {
    id: crypto.randomUUID(),
    openId: req.user.openId,
    alias,
    useAlias: req.body.useAlias,
    actualName: safeText(req.user.name, "DingTalk user"),
    updatedAt: new Date().toISOString(),
  };
  appendJsonLine(leaderboardIdentitiesFile, identity);
  identities.set(req.user.openId, identity);
  res.json({ identity: leaderboardIdentityForClient(req.user, identity, identities) });
});

app.get("/api/game/leaderboard", requireAuth, (req, res) => {
  const challenges = availableChallenges();
  const requestedId = safeText(req.query.challengeId);
  const challenge = requestedId
    ? challenges.find((item) => item.id === requestedId)
    : challenges[0];
  if (!challenge) {
    return res.status(400).json({ error: "Choose an available weekly challenge." });
  }

  const leaderboard = leaderboardForChallenge(
    readJsonLines(metadataFile),
    challenge,
    req.user.openId,
    leaderboardIdentities(),
  );
  res.set("Cache-Control", "no-store");
  res.json({ challenge: gameChallengeForClient(challenge), ...leaderboard });
});

app.post("/api/game/question", requireAuth, requirePrivacyConsent, (req, res) => {
  const challenge = currentChallenge();
  const profile = {
    name: safeText(req.user.name, "DingTalk user"),
    role: "Weekly everyday speaking challenge",
  };
  const record = persistQuestion(
    req.user,
    profile,
    challengeQuestion(challenge),
    "weekly-fixed-topic",
  );
  res.status(201).json({
    question: questionForClient(record),
    challenge: gameChallengeForClient(challenge),
    model: "weekly-fixed-topic",
    user: req.user,
  });
});

app.post("/api/generate-question", requireAuth, requirePrivacyConsent, async (req, res) => {
  const profile = {
    ...(req.body?.profile || {}),
    name: safeText(req.user.name, "DingTalk user"),
  };
  const apiKey = process.env.INTERNAL_LLM_API_KEY;

  if (!apiKey) {
    const record = persistQuestion(req.user, profile, fallbackQuestion(profile), "fallback");
    return res.status(500).json({
      error: "INTERNAL_LLM_API_KEY is not configured.",
      question: questionForClient(record),
    });
  }

  try {
    const response = await fetch(internalLlmChatCompletionsUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: internalLlmQuestionModel,
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
      const record = persistQuestion(req.user, profile, fallbackQuestion(profile), "fallback");
      return res.status(response.status).json({
        error: `Internal model request failed: ${detail}`,
        question: questionForClient(record),
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

    const record = persistQuestion(req.user, profile, question, internalLlmQuestionModel);
    res.json({ question: questionForClient(record), model: internalLlmQuestionModel, user: req.user });
  } catch (error) {
    const record = persistQuestion(req.user, profile, fallbackQuestion(profile), "fallback");
    res.status(500).json({
      error: error.message,
      question: questionForClient(record),
    });
  }
});

app.post("/api/save-answer/:id/cancel", requireAuth, (req, res) => {
  const id = validAnswerSaveId(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "A valid answer save ID is required." });
  }

  requestAnswerCancellation(id, req.user.openId);
  const removedRecordCount = discardPersistedAnswer({
    id,
    openId: req.user.openId,
    requireSubmissionId: true,
  });
  res.json({
    ok: true,
    id,
    cancellationRequested: true,
    removedRecordCount,
  });
});

app.post("/api/save-answer", requireAuth, upload.single("video"), async (req, res) => {
  const questionId = safeText(req.body.questionId);
  const questionRecord = findOwnedQuestion(questionId, req.user.openId);
  if (!questionRecord) {
    if (req.file) removePath(req.file.path);
    return res.status(400).json({ error: "The question is missing or does not belong to this user." });
  }

  const requestedId = safeText(req.body.submissionId);
  const id = requestedId ? validAnswerSaveId(requestedId) : crypto.randomUUID();
  if (!id) {
    if (req.file) removePath(req.file.path);
    return res.status(400).json({ error: "A valid answer save ID is required." });
  }
  if (readJsonLines(metadataFile).some((record) => record.id === id)) {
    if (req.file) removePath(req.file.path);
    return res.status(409).json({ error: "This answer save ID has already been used." });
  }
  if (isAnswerCancellationRequested(id, req.user.openId)) {
    if (req.file) removePath(req.file.path);
    return res.status(409).json({ error: "This answer was discarded.", code: "ANSWER_DISCARDED" });
  }

  const profile = questionRecord.profile;
  const question = questionRecord.question;
  const startedAt = safeText(req.body.startedAt);
  const finishedAt = new Date().toISOString();

  if (!req.file) {
    const record = {
      id,
      submissionId: requestedId ? id : null,
      hasVideo: false,
      filename: null,
      mimeType: null,
      bytes: 0,
      startedAt,
      finishedAt,
      openId: req.user.openId,
      userId: req.user.userId,
      jobNumber: req.user.jobNumber,
      email: req.user.email,
      orgEmail: req.user.orgEmail,
      user: req.user,
      profile,
      questionId,
      question,
      evaluation: {
        status: "skipped",
        reason: "No video was recorded for this question.",
      },
    };

    if (isAnswerCancellationRequested(id, req.user.openId)) {
      return res.status(409).json({ error: "This answer was discarded.", code: "ANSWER_DISCARDED" });
    }
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
  const filename = `${baseName}.mp4`;
  const finalPath = path.join(recordingsDir, filename);
  const convertedPath = path.join(recordingTmpDir, filename);
  let evaluationMediaInfo;

  try {
    evaluationMediaInfo = limitStandaloneMediaInfo(await inspectMedia(req.file.path));
    await convertToMp4(req.file.path, convertedPath, {
      maximumDurationSeconds: standaloneEvaluationMaxSeconds,
    });
    fs.chmodSync(convertedPath, 0o600);
    fs.renameSync(convertedPath, finalPath);
  } catch (error) {
    removePath(req.file.path);
    removePath(convertedPath);
    removePath(finalPath);
    return res.status(400).json({ error: "The uploaded file is not a valid supported video." });
  }
  removePath(req.file.path);

  if (isAnswerCancellationRequested(id, req.user.openId)) {
    removePath(finalPath);
    removePath(path.join(artifactsDir, id));
    return res.status(409).json({ error: "This answer was discarded.", code: "ANSWER_DISCARDED" });
  }

  const record = {
    id,
    submissionId: requestedId ? id : null,
    hasVideo: true,
    filename,
    mimeType: "video/mp4",
    originalMimeType: req.file.mimetype,
    convertedToMp4: true,
    bytes: fs.statSync(finalPath).size,
    startedAt,
    finishedAt,
    openId: req.user.openId,
    userId: req.user.userId,
    jobNumber: req.user.jobNumber,
    email: req.user.email,
    orgEmail: req.user.orgEmail,
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
      mediaInfo: evaluationMediaInfo,
    });
  } catch (error) {
    record.evaluation = {
      status: "failed",
      reason: error.message,
    };
  }

  if (isAnswerCancellationRequested(id, req.user.openId)) {
    removePath(finalPath);
    removePath(path.join(artifactsDir, id));
    return res.status(409).json({ error: "This answer was discarded.", code: "ANSWER_DISCARDED" });
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

app.post(
  "/api/evaluate-video",
  requireAuth,
  upload.single("video"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "Choose a video file to evaluate." });
    }

    const id = crypto.randomUUID();
    const finishedAt = new Date().toISOString();
    const baseName = `${finishedAt.replace(/[:.]/g, "-")}-${id}`;
    const inputPath = req.file.path;
    const convertedPath = path.join(recordingTmpDir, `${baseName}.mp4`);
    const filename = `${baseName}.mp4`;
    const finalPath = path.join(recordingsDir, filename);

    try {
      const mediaInfo = await inspectMedia(inputPath);
      if (!mediaInfo.hasAudio) {
        throw new Error(
          "This video has a picture but no audio track. OScanner-Eng needs spoken audio to evaluate it.",
        );
      }
      const limitedMediaInfo = limitStandaloneMediaInfo(mediaInfo);
      await convertToMp4(inputPath, convertedPath, {
        maximumDurationSeconds: standaloneEvaluationMaxSeconds,
      });
      fs.chmodSync(convertedPath, 0o600);
      fs.renameSync(convertedPath, finalPath);

      const profile = { name: safeText(req.user.name, "DingTalk user") };
      const question = {
        question: "Standalone speech",
        focus: "Speech consistency and English communication",
      };
      const evaluation = await evaluateSavedVideo({
        videoPath: finalPath,
        artifactBaseDir: path.join(artifactsDir, id),
        profile,
        question,
        evaluationMode: "standalone-speech",
        mediaInfo: limitedMediaInfo,
      });
      if (evaluation.rubric?.coherence) {
        evaluation.rubric.coherence.label = "Coherence / speech consistency";
      }
      const originalFilename = decodeUtf8UploadFilename(req.file.originalname);
      const record = {
        id,
        title: standaloneEvaluationTitle(originalFilename),
        originalFilename: path.basename(originalFilename),
        hasVideo: true,
        filename,
        mimeType: "video/mp4",
        originalMimeType: req.file.mimetype,
        convertedToMp4: true,
        bytes: fs.statSync(finalPath).size,
        startedAt: finishedAt,
        finishedAt,
        openId: req.user.openId,
        userId: req.user.userId,
        jobNumber: req.user.jobNumber,
        email: req.user.email,
        orgEmail: req.user.orgEmail,
        user: req.user,
        profile,
        questionId: null,
        question,
        sourceType: "upload",
        evaluationMode: "standalone-speech",
        evaluation,
      };
      appendJsonLine(metadataFile, record);
      return res.json({
        ok: true,
        id,
        path: `/api/recordings/${id}/video`,
        evaluation,
        publicEvaluation: publicEvaluationForClient(record),
      });
    } catch (error) {
      removePath(convertedPath);
      removePath(finalPath);
      removePath(path.join(artifactsDir, id));
      return res.status(422).json({ error: error.message });
    } finally {
      removePath(req.file.path);
    }
  },
);

app.get("/api/public-evaluations", (_req, res) => {
  const evaluations = readJsonLines(metadataFile)
    .filter(isPublicEvaluation)
    .map(publicEvaluationForClient)
    .filter(Boolean)
    .sort((left, right) => right.finishedAt.localeCompare(left.finishedAt));

  res.set("Cache-Control", "no-store");
  res.json({ evaluations });
});

app.get("/api/public-evaluations/:id/poster", (req, res) => {
  const record = readJsonLines(metadataFile).find(
    (item) => item.id === req.params.id && isPublicEvaluation(item),
  );
  if (!record) {
    return res.status(404).json({ error: "Evaluation poster not found." });
  }

  const posterPath = path.join(artifactsDir, record.id, "frames", "frame-001.jpg");
  if (!fs.existsSync(posterPath)) {
    return res.status(404).json({ error: "Evaluation poster not found." });
  }

  res.set({
    "Cache-Control": "public, max-age=86400",
    "X-Content-Type-Options": "nosniff",
  });
  res.type("image/jpeg");
  res.sendFile(posterPath);
});

app.get("/api/public-evaluations/:id/video", (req, res) => {
  const record = readJsonLines(metadataFile).find(
    (item) => item.id === req.params.id && isPublicEvaluation(item),
  );
  if (
    !record ||
    !record.filename ||
    path.basename(record.filename) !== record.filename
  ) {
    return res.status(404).json({ error: "Evaluation video not found." });
  }

  const videoPath = path.join(recordingsDir, record.filename);
  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ error: "Evaluation video not found." });
  }

  res.set({
    "Cache-Control": "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });
  res.type("video/mp4");
  res.sendFile(videoPath);
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

  res.set("X-Content-Type-Options", "nosniff");
  res.type("video/mp4");
  res.sendFile(videoPath);
});

registerPageRoutes(app);

app.use((error, _req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      error: "Only MP4, WebM, Ogg, MOV, or MKV video uploads up to 250 MB are supported.",
    });
  }
  next(error);
});

function startServer() {
  return app.listen(port, () => {
    console.log(`OScanner-Eng is running at http://localhost:${port}`);
  });
}

module.exports = {
  app,
  startServer,
  testHelpers: {
    buildEvaluationPrompt,
    createOAuthState,
    createSessionToken,
    decodeUtf8UploadFilename,
    discardPersistedAnswer,
    evaluateAnswer,
    extractJsonObject,
    evaluationTimeoutMessage,
    hasScorableEnglishSpeech,
    inAppOwnerOpenId,
    isDingTalkInAppConfigured,
    isTranscriptionSizeError,
    isTranscriptionFileOpenError,
    limitStandaloneMediaInfo,
    modelMessageText,
    normalizeEvaluation,
    normalizeDingTalkInAppUser,
    normalizeRedirectPath,
    parseOAuthState,
    publicEvaluationForClient,
    standaloneEvaluationTitle,
    transcribeAudio,
    useSecureSessionCookie,
    validAnswerSaveId,
  },
};

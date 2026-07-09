const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const express = require("express");
const multer = require("multer");
const ffmpegPath = require("ffmpeg-static");
require("dotenv").config();

const app = express();
const port = Number(process.env.PORT || 3000);
const rootDir = __dirname;
const publicDir = path.join(rootDir, "public");
const recordingsDir = path.join(rootDir, "recordings");
const metadataFile = path.join(recordingsDir, "metadata.jsonl");

fs.mkdirSync(recordingsDir, { recursive: true });

app.use(express.json({ limit: "1mb" }));
app.use(express.static(publicDir));

const upload = multer({
  dest: path.join(recordingsDir, "tmp"),
  limits: {
    fileSize: 250 * 1024 * 1024,
  },
});

function safeText(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function parseJsonField(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

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

function buildPrompt(profile) {
  const name = safeText(profile.name, "the candidate");
  const role = safeText(profile.role, "English learner");

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
  const role = safeText(profile.role, "your current role");
  return {
    question: `Tell me about a recent challenge in ${role}. What happened, what did you do, and what was the result?`,
    focus: "Fluency, organization, detail, and past-tense narration",
    expectedDurationSeconds: 120,
    followUp: "What would you do differently next time?",
  };
}

app.post("/api/generate-question", async (req, res) => {
  const profile = req.body?.profile || {};
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash";

  if (!apiKey) {
    return res.status(500).json({
      error: "OPENROUTER_API_KEY is not configured.",
      question: fallbackQuestion(profile),
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

    res.json({ question, model });
  } catch (error) {
    res.status(500).json({
      error: error.message,
      question: fallbackQuestion(profile),
    });
  }
});

app.post("/api/save-answer", upload.single("video"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No video file uploaded." });
  }

  const profile = parseJsonField(req.body.profile);
  const question = parseJsonField(req.body.question);
  const startedAt = safeText(req.body.startedAt);
  const finishedAt = new Date().toISOString();
  const id = crypto.randomUUID();
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
    filename,
    mimeType: storedMimeType,
    originalMimeType: req.file.mimetype,
    convertedToMp4,
    bytes: fs.statSync(finalPath).size,
    startedAt,
    finishedAt,
    profile,
    question,
  };

  fs.appendFileSync(metadataFile, `${JSON.stringify(record)}\n`);

  res.json({
    ok: true,
    id,
    filename,
    path: `/recordings/${filename}`,
  });
});

app.get("/api/recordings", (_req, res) => {
  if (!fs.existsSync(metadataFile)) {
    return res.json({ recordings: [] });
  }

  const recordings = fs
    .readFileSync(metadataFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .reverse();

  res.json({ recordings });
});

app.use("/recordings", express.static(recordingsDir));

app.listen(port, () => {
  console.log(`EnglishEval is running at http://localhost:${port}`);
});

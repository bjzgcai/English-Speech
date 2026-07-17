const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const ffmpegPath = require("ffmpeg-static");

process.env.NODE_ENV = "test";

const { testHelpers } = require("../src/app");

test("evaluation reads normal model content", () => {
  const message = {
    content: '{"summary":"from content"}',
    reasoning_content: '{"summary":"from reasoning"}',
  };

  assert.equal(testHelpers.modelMessageText(message), message.content);
  assert.deepEqual(testHelpers.extractJsonObject(testHelpers.modelMessageText(message)), {
    summary: "from content",
  });
});

test("evaluation falls back to reasoning content when normal content is absent", () => {
  const message = {
    content: null,
    reasoning_content: 'The model result is {"summary":"from reasoning"}',
  };

  assert.deepEqual(testHelpers.extractJsonObject(testHelpers.modelMessageText(message)), {
    summary: "from reasoning",
  });
});

test("provides a user-facing evaluation timeout message", () => {
  assert.equal(
    testHelpers.evaluationTimeoutMessage(600_000),
    "Evaluation timed out after 600 seconds. Your recording was saved, but feedback could not be generated. Please try again later.",
  );
});

test("standalone speech prompt scores consistency instead of task relevance", () => {
  const prompt = testHelpers.buildEvaluationPrompt({
    profile: {},
    question: { question: "Standalone speech" },
    transcript: "The speaker develops one connected idea.",
    audioMetrics: {},
    frameCount: 0,
    evaluationMode: "standalone-speech",
  });

  assert.match(prompt, /internally consistent/);
  assert.match(prompt, /Do not assess task relevance/);
  assert.match(prompt, /No visual frames are available/);
});

test("audio-only evaluation excludes visual delivery from the weighted total", () => {
  const evaluation = testHelpers.normalizeEvaluation(
    {
      rubric: {
        pronunciation: { score: 80 },
        fluency: { score: 80 },
        grammar: { score: 80 },
        vocabulary: { score: 80 },
        coherence: { score: 80 },
        visualDelivery: { score: 10 },
      },
    },
    { visualAvailable: false },
  );

  assert.equal(evaluation.overallScore, 80);
  assert.equal(evaluation.rubric.visualDelivery.score, null);
  assert.equal(evaluation.rubric.visualDelivery.available, false);
});

test("standalone videos are capped at the end of the second minute", () => {
  const exactLimit = testHelpers.limitStandaloneMediaInfo({
    hasAudio: true,
    hasVideo: true,
    durationSeconds: 120,
  });
  const overLimit = testHelpers.limitStandaloneMediaInfo({
    hasAudio: true,
    hasVideo: true,
    durationSeconds: 181.4,
  });

  assert.equal(exactLimit.truncated, false);
  assert.equal(exactLimit.durationSeconds, 120);
  assert.equal(overLimit.truncated, true);
  assert.equal(overLimit.originalDurationSeconds, 181.4);
  assert.equal(overLimit.durationSeconds, 120);
});

test("recognizes the upstream encoder-cache error as a chunking signal", () => {
  assert.equal(
    testHelpers.isTranscriptionSizeError(
      new Error("audio item with 5673 embedding tokens exceeds encoder cache size 2048"),
    ),
    true,
  );
  assert.equal(
    testHelpers.isTranscriptionFileOpenError(
      new Error("Failed to apply Qwen3ASRProcessor on uploaded audio data"),
    ),
    true,
  );
});

test("retries transient transcription gateway failures", async (context) => {
  const originalFetch = global.fetch;
  const originalAttempts = process.env.TRANSCRIPTION_MAX_ATTEMPTS;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-transcription-retry-"));
  const audioPath = path.join(tempDir, "audio.mp3");
  fs.writeFileSync(audioPath, "test audio bytes");
  process.env.TRANSCRIPTION_MAX_ATTEMPTS = "2";

  context.after(() => {
    global.fetch = originalFetch;
    if (originalAttempts === undefined) delete process.env.TRANSCRIPTION_MAX_ATTEMPTS;
    else process.env.TRANSCRIPTION_MAX_ATTEMPTS = originalAttempts;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  let requestCount = 0;
  global.fetch = async () => {
    requestCount += 1;
    if (requestCount === 1) {
      return new Response('{"error":{"type":"upstream_error"}}', { status: 500 });
    }
    return new Response(JSON.stringify({ text: "retry succeeded" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const transcript = await testHelpers.transcribeAudio(audioPath);
  assert.equal(requestCount, 2);
  assert.equal(transcript, "retry succeeded");
});

test("falls back to normalized WAV for the upstream BytesIO decoder bug", async (context) => {
  const originalFetch = global.fetch;
  const originalAttempts = process.env.TRANSCRIPTION_MAX_ATTEMPTS;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-transcription-wav-"));
  const audioPath = path.join(tempDir, "audio.mp3");
  const generated = spawnSync(
    ffmpegPath,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=0.2",
      "-ac",
      "1",
      "-ar",
      "16000",
      audioPath,
    ],
    { encoding: "utf8" },
  );
  assert.equal(generated.status, 0, generated.stderr);
  process.env.TRANSCRIPTION_MAX_ATTEMPTS = "1";

  context.after(() => {
    global.fetch = originalFetch;
    if (originalAttempts === undefined) delete process.env.TRANSCRIPTION_MAX_ATTEMPTS;
    else process.env.TRANSCRIPTION_MAX_ATTEMPTS = originalAttempts;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const uploadedFiles = [];
  global.fetch = async (_url, options) => {
    const uploadedFile = options.body.get("file");
    uploadedFiles.push({ name: uploadedFile.name, type: uploadedFile.type });
    if (uploadedFile.name.endsWith(".mp3")) {
      return new Response(
        'upstream service returned 500: Error opening <_io.BytesIO object>: File does not exist or is not a regular file (possibly a pipe?)',
        { status: 500 },
      );
    }
    return new Response(JSON.stringify({ text: "wav succeeded" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const transcript = await testHelpers.transcribeAudio(audioPath);
  assert.deepEqual(uploadedFiles, [
    { name: "audio.mp3", type: "audio/mpeg" },
    { name: "transcription-fallback.wav", type: "audio/wav" },
  ]);
  assert.equal(transcript, "wav succeeded");
  assert.equal(fs.existsSync(path.join(tempDir, "transcription-fallback.wav")), false);
});

test("long audio is transcribed in ordered chunks", async (context) => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.INTERNAL_LLM_API_KEY;
  const originalChunkSeconds = process.env.TRANSCRIPTION_CHUNK_SECONDS;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-transcription-"));
  const audioPath = path.join(tempDir, "audio.mp3");
  const generated = spawnSync(
    ffmpegPath,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=2.2",
      "-ac",
      "1",
      "-ar",
      "16000",
      audioPath,
    ],
    { encoding: "utf8" },
  );
  assert.equal(generated.status, 0, generated.stderr);
  process.env.INTERNAL_LLM_API_KEY = "test-transcription-key";
  process.env.TRANSCRIPTION_CHUNK_SECONDS = "1";

  context.after(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.INTERNAL_LLM_API_KEY;
    else process.env.INTERNAL_LLM_API_KEY = originalApiKey;
    if (originalChunkSeconds === undefined) delete process.env.TRANSCRIPTION_CHUNK_SECONDS;
    else process.env.TRANSCRIPTION_CHUNK_SECONDS = originalChunkSeconds;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  let requestCount = 0;
  global.fetch = async () => {
    requestCount += 1;
    return new Response(JSON.stringify({ text: `segment ${requestCount}` }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const transcript = await testHelpers.transcribeAudio(audioPath, { durationSeconds: 2.2 });
  assert.equal(requestCount, 3);
  assert.equal(transcript, "segment 1 segment 2 segment 3");
});

test("sends evaluations through the OpenRouter proxy with Gemini 3.5 Flash and JSON mode", async (context) => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.OPENROUTER_API_KEY;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-openrouter-"));
  const framePath = path.join(tempDir, "frame.jpg");
  fs.writeFileSync(framePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";

  context.after(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalApiKey;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  let capturedUrl;
  let capturedOptions;
  global.fetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: "Clear overall response.",
                transcript: "A test answer.",
                rubric: {
                  pronunciation: { score: 80, feedback: "Clear." },
                  fluency: { score: 80, feedback: "Smooth." },
                  grammar: { score: 80, feedback: "Accurate." },
                  vocabulary: { score: 80, feedback: "Appropriate." },
                  coherence: { score: 80, feedback: "Logical." },
                  visualDelivery: { score: 80, feedback: "Engaged." },
                },
                strengths: ["Clear"],
                improvements: ["Add detail"],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const evaluation = await testHelpers.evaluateAnswer({
    profile: { level: "B2" },
    question: { prompt: "Tell me about a project." },
    transcript: "A test answer.",
    audioMetrics: { speakingRateWpm: 120 },
    framePaths: [framePath],
  });

  const body = JSON.parse(capturedOptions.body);
  assert.equal(capturedUrl, "https://openrouter.ihainan.me/api/v1/chat/completions");
  assert.equal(capturedOptions.headers.Authorization, "Bearer test-openrouter-key");
  assert.equal(capturedOptions.headers["X-OpenRouter-Title"], "EnglishEval");
  assert.equal(body.model, "google/gemini-3.5-flash");
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.messages[1].content[1].type, "image_url");
  assert.equal(evaluation.model.evaluate, "google/gemini-3.5-flash");
  assert.equal(evaluation.overallScore, 80);
});

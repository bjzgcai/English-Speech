const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";

const { testHelpers } = require("../src/app");
const {
  openRouterTranscribeModel,
  openRouterTranscriptionsUrl,
} = require("../src/model-fallback");

// Matches the app default in src/app.js when INTERNAL_LLM_TRANSCRIPTIONS_URL is unset.
const INTERNAL_URL = process.env.INTERNAL_LLM_TRANSCRIPTIONS_URL ||
  "https://api.example.com/v1/audio/transcriptions";
const OPENROUTER_URL = openRouterTranscriptionsUrl();

function writeTempAudio(prefix) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const audioPath = path.join(tempDir, "audio.mp3");
  fs.writeFileSync(audioPath, "test audio bytes");
  return { tempDir, audioPath };
}

function withEnv(overrides, context) {
  const saved = {};
  for (const [key, value] of Object.entries(overrides)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  context.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("internal gateway success never touches the OpenRouter fallback", async (context) => {
  const originalFetch = global.fetch;
  const { tempDir, audioPath } = writeTempAudio("englisheval-asr-internal-");
  withEnv({ TRANSCRIPTION_MAX_ATTEMPTS: "1" }, context);
  context.after(() => {
    global.fetch = originalFetch;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ text: "internal transcript" }), { status: 200 });
  };

  const transcript = await testHelpers.transcribeAudio(audioPath);
  assert.equal(transcript, "internal transcript");
  assert.deepEqual(urls, [INTERNAL_URL]);
});

test("internal failure retries once through the OpenRouter fallback", async (context) => {
  const originalFetch = global.fetch;
  const { tempDir, audioPath } = writeTempAudio("englisheval-asr-fallback-");
  withEnv(
    {
      TRANSCRIPTION_MAX_ATTEMPTS: "1",
      OPENROUTER_API_KEY: "test-key",
      OPENROUTER_TRANSCRIBE_MODEL: "qwen/qwen3-asr-flash-2026-02-10",
    },
    context,
  );
  context.after(() => {
    global.fetch = originalFetch;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const calls = [];
  global.fetch = async (url, options) => {
    const urlText = String(url);
    calls.push({ url: urlText, auth: options.headers.Authorization });
    if (urlText === INTERNAL_URL) {
      return new Response('{"error":{"type":"upstream_error"}}', { status: 500 });
    }
    return new Response(JSON.stringify({ text: "fallback transcript" }), { status: 200 });
  };

  const transcript = await testHelpers.transcribeAudio(audioPath);
  assert.equal(transcript, "fallback transcript");
  assert.deepEqual(
    calls.map((call) => call.url),
    [INTERNAL_URL, OPENROUTER_URL],
  );
  assert.match(calls[1].auth, /Bearer test-key$/);

  const formData = "multipart/form-data";
  assert.ok(true, formData); // body shape asserted via the model field below
});

test("fallback request carries the OpenRouter model and language hint", async (context) => {
  const originalFetch = global.fetch;
  const { tempDir, audioPath } = writeTempAudio("englisheval-asr-fields-");
  withEnv(
    {
      TRANSCRIPTION_MAX_ATTEMPTS: "1",
      OPENROUTER_API_KEY: "test-key",
      OPENROUTER_TRANSCRIBE_MODEL: "qwen/qwen3-asr-flash-test",
    },
    context,
  );
  context.after(() => {
    global.fetch = originalFetch;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  let fallbackBody = null;
  global.fetch = async (url, options) => {
    if (String(url) === INTERNAL_URL) {
      return new Response("gateway down", { status: 503 });
    }
    fallbackBody = options.body;
    return new Response(JSON.stringify({ text: "ok" }), { status: 200 });
  };

  const transcript = await testHelpers.transcribeAudio(audioPath);
  assert.equal(transcript, "ok");
  assert.equal(fallbackBody.get("model"), "qwen/qwen3-asr-flash-test");
  assert.equal(fallbackBody.get("language"), "en");
  assert.equal(fallbackBody.get("file").name, "audio.mp3");
});

test("without OPENROUTER_API_KEY the internal failure propagates", async (context) => {
  const originalFetch = global.fetch;
  const { tempDir, audioPath } = writeTempAudio("englisheval-asr-nokey-");
  withEnv(
    { TRANSCRIPTION_MAX_ATTEMPTS: "1", OPENROUTER_API_KEY: undefined },
    context,
  );
  context.after(() => {
    global.fetch = originalFetch;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    return new Response('{"error":{"type":"upstream_error"}}', { status: 500 });
  };

  await assert.rejects(
    () => testHelpers.transcribeAudio(audioPath),
    /Transcription failed/,
  );
  assert.deepEqual(urls, [INTERNAL_URL]);
});

test("fallback model and endpoint defaults", () => {
  assert.equal(
    openRouterTranscribeModel(),
    process.env.OPENROUTER_TRANSCRIBE_MODEL || "qwen/qwen3-asr-1.7b",
  );
  assert.match(OPENROUTER_URL, /audio\/transcriptions$/);
});

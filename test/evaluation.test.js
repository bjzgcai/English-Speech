const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

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

test("sends evaluations to OpenRouter with Kimi K2.6 and JSON mode", async (context) => {
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
  assert.equal(capturedUrl, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(capturedOptions.headers.Authorization, "Bearer test-openrouter-key");
  assert.equal(capturedOptions.headers["X-OpenRouter-Title"], "EnglishEval");
  assert.equal(body.model, "moonshotai/kimi-k2.6");
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.messages[1].content[1].type, "image_url");
  assert.equal(evaluation.model.evaluate, "moonshotai/kimi-k2.6");
  assert.equal(evaluation.overallScore, 80);
});

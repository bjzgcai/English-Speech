const assert = require("node:assert/strict");
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

test("evaluation falls back to MiniMax reasoning content", () => {
  const message = {
    content: null,
    reasoning_content: 'The model result is {"summary":"from reasoning"}',
  };

  assert.deepEqual(testHelpers.extractJsonObject(testHelpers.modelMessageText(message)), {
    summary: "from reasoning",
  });
});

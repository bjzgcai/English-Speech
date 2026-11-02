const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");
const { mediaConcurrency, pipelineConcurrency } = require("../src/media-config");
const { modelConcurrency } = require("../src/model-guard");

const profile = dotenv.parse(
  fs.readFileSync(path.join(__dirname, "../ops/englisheval-capacity.env")),
);

test("production capacity profile extends scoring without increasing media or internal pressure", () => {
  assert.equal(pipelineConcurrency(profile.WORKER_CONCURRENCY), 10);
  assert.equal(mediaConcurrency(profile.FFMPEG_CONCURRENCY, 4), 3);
  assert.equal(modelConcurrency("transcription", profile.MODEL_TRANSCRIPTION_CONCURRENT), 3);
  assert.equal(modelConcurrency("scoring", profile.MODEL_SCORING_CONCURRENT), 6);
  assert.equal(profile.MODEL_SCORING_RPM, "18");
  assert.equal(profile.MODEL_SCORING_TPM, "600000");
});

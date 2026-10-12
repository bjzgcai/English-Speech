const test = require("node:test");
const assert = require("node:assert/strict");
const { testHelpers } = require("../src/app");
const { mediaCompleteness } = testHelpers;

// A recorder that stalls keeps the container's timeline running while the media
// stops. The inspected duration then describes a file that is mostly missing, so
// the report must describe the seconds that were really decoded.
test("a recording whose samples stop early is reported as incomplete", () => {
  const result = mediaCompleteness(
    { originalDurationSeconds: 108.758333, durationSeconds: 108.758333 },
    { durationSeconds: 10.0053125 },
  );
  assert.equal(result.incomplete, true);
  assert.equal(result.claimedSeconds, 108.758333);
  assert.equal(result.expectedSeconds, 108.758333);
  assert.equal(result.evaluatedSeconds, 10.0053125);
});

test("the evaluated duration is the decoded duration, never the container's claim", () => {
  const result = mediaCompleteness(
    { originalDurationSeconds: 81.196666, durationSeconds: 81.196666 },
    { durationSeconds: 15.5093125 },
  );
  assert.equal(result.evaluatedSeconds, 15.5093125);
  assert.notEqual(result.evaluatedSeconds, result.claimedSeconds);
});

test("a complete recording is not flagged", () => {
  const result = mediaCompleteness(
    { originalDurationSeconds: 119.95, durationSeconds: 119.95 },
    { durationSeconds: 119.68 },
  );
  assert.equal(result.incomplete, false);
  assert.equal(result.expectedSeconds, 119.95);
  assert.equal(result.evaluatedSeconds, 119.68);
});

test("stop latency within the tolerance is not a lost recording", () => {
  assert.equal(mediaCompleteness({ durationSeconds: 60 }, { durationSeconds: 57 }).incomplete, false);
  assert.equal(mediaCompleteness({ durationSeconds: 20 }, { durationSeconds: 16.5 }).incomplete, false);
});

test("a shortened answer is still reported once it loses a fifth of itself", () => {
  assert.equal(mediaCompleteness({ durationSeconds: 60 }, { durationSeconds: 45 }).incomplete, true);
  assert.equal(mediaCompleteness({ durationSeconds: 120 }, { durationSeconds: 40 }).incomplete, true);
});

test("a recording longer than the two-minute limit counts as truncated, not incomplete", () => {
  const result = mediaCompleteness({ originalDurationSeconds: 300, durationSeconds: 120 }, { durationSeconds: 120 });
  assert.equal(result.incomplete, false);
  assert.equal(result.claimedSeconds, 300);
  assert.equal(result.expectedSeconds, 120);
  assert.equal(result.evaluatedSeconds, 120);
});

test("an unmeasurable file falls back to the inspected duration without a false alarm", () => {
  assert.equal(mediaCompleteness({ durationSeconds: 60 }, null).incomplete, false);
  assert.equal(mediaCompleteness({ durationSeconds: 60 }, {}).incomplete, false);
  assert.equal(mediaCompleteness(null, { durationSeconds: 10 }).incomplete, false);
  assert.equal(mediaCompleteness({ durationSeconds: 0 }, { durationSeconds: 10 }).incomplete, false);
  assert.equal(mediaCompleteness({ durationSeconds: 10 }, { durationSeconds: 10 }).incomplete, false);
});

test("an audio-only recording reports its decoded seconds too", () => {
  const result = mediaCompleteness({ originalDurationSeconds: 17.878667, durationSeconds: 17.878667 }, { durationSeconds: 17.8 });
  assert.equal(result.incomplete, false);
  assert.equal(result.evaluatedSeconds, 17.8);
});

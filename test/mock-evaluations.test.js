const assert = require("node:assert/strict");
const test = require("node:test");

const { buildMockPartnerUsers, MOCK_USER_COUNT } = require("../src/mock-evaluations");

const rubric = {
  id: "english-speaking-evaluation",
  version: "1.0.0",
  dimensions: [
    { key: "pronunciation", label: "Pronunciation", weight: 25 },
    { key: "fluency", label: "Fluency", weight: 15 },
    { key: "grammar", label: "Grammar", weight: 20 },
    { key: "vocabulary", label: "Vocabulary", weight: 15 },
    { key: "coherence", label: "Coherence", weight: 10 },
    { key: "visualDelivery", label: "Visual delivery", weight: 15 },
  ],
};

test("builds 28 deterministic synthetic completed evaluations", () => {
  const users = buildMockPartnerUsers(rubric);

  assert.equal(MOCK_USER_COUNT, 28);
  assert.equal(users.length, 28);
  assert.equal(new Set(users.map((user) => user.userId)).size, 28);
  assert.equal(users.every((user) => user.evaluations.length === 1), true);
  assert.equal(users.every((user) => user.evaluations[0].evaluation.status === "completed"), true);
  assert.deepEqual(users, buildMockPartnerUsers(rubric));
  assert.match(users[0].email, /@example\.com$/);
});

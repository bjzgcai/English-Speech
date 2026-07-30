const assert = require("node:assert/strict");
const test = require("node:test");

const {
  EXPERIENCE_RATING_COOLDOWN_DAYS,
  ExperienceRatingValidationError,
  experienceRatingStatus,
  listExperienceRatingsForAdmin,
  parseExperienceRating,
} = require("../src/experience-ratings");

test("experience rating eligibility uses the same 90-day cooldown after any outcome", () => {
  const now = Date.parse("2026-07-30T12:00:00.000Z");
  const recent = new Date(now - 89 * 24 * 60 * 60 * 1000).toISOString();
  const expired = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString();

  assert.equal(EXPERIENCE_RATING_COOLDOWN_DAYS, 90);
  assert.equal(experienceRatingStatus([], "user-1", now).eligible, true);
  assert.equal(experienceRatingStatus([], "", now).eligible, false);
  assert.equal(
    experienceRatingStatus([{ openId: "user-1", createdAt: recent }], "user-1", now).eligible,
    false,
  );
  assert.equal(
    experienceRatingStatus([{ openId: "user-1", createdAt: expired }], "user-1", now).eligible,
    true,
  );
  assert.equal(
    experienceRatingStatus([{ openId: "another-user", createdAt: recent }], "user-1", now)
      .eligible,
    true,
  );
});

test("rated responses accept a 1-5 score and matching optional tags", () => {
  assert.deepEqual(
    parseExperienceRating({
      outcome: "RATED",
      score: 5,
      tags: ["Helpful feedback", "Clear workflow", "Helpful feedback"],
    }),
    {
      outcome: "RATED",
      score: 5,
      tags: ["Helpful feedback", "Clear workflow"],
    },
  );
  assert.deepEqual(parseExperienceRating({ outcome: "DISMISSED" }), {
    outcome: "DISMISSED",
    score: null,
    tags: [],
  });

  assert.throws(
    () => parseExperienceRating({ outcome: "RATED", score: 6, tags: [] }),
    ExperienceRatingValidationError,
  );
  assert.throws(
    () => parseExperienceRating({ outcome: "RATED", score: "5", tags: [] }),
    /Choose a rating/,
  );
  assert.throws(
    () =>
      parseExperienceRating({
        outcome: "RATED",
        score: 2,
        tags: ["Helpful feedback"],
      }),
    /do not match/,
  );
  assert.throws(
    () => parseExperienceRating({ outcome: "DISMISSED", score: 3 }),
    /cannot include/,
  );
});

test("admin rating projection strips ownership identifiers and sorts newest first", () => {
  const result = listExperienceRatingsForAdmin([
    {
      id: "old",
      openId: "private-open-id",
      userId: "private-user-id",
      userName: "Older User",
      jobNumber: "100",
      outcome: "RATED",
      score: 4,
      tags: ["Clear workflow"],
      createdAt: "2026-07-01T00:00:00.000Z",
    },
    {
      id: "new",
      openId: "private-open-id-2",
      userName: "Newer User",
      outcome: "DISMISSED",
      score: null,
      tags: [],
      createdAt: "2026-07-30T00:00:00.000Z",
    },
  ]);

  assert.deepEqual(result.map((rating) => rating.id), ["new", "old"]);
  assert.equal("openId" in result[0], false);
  assert.equal("userId" in result[0], false);
  assert.equal(result[1].context, "EVALUATION");
});

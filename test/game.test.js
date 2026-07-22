const test = require("node:test");
const assert = require("node:assert/strict");
const {
  availableChallenges,
  challengeForIndex,
  currentChallenge,
  leaderboardForChallenge,
  weeklyTopics,
} = require("../src/game");

test("weekly game starts on 2026-07-22 and rotates ten everyday topics", () => {
  assert.equal(weeklyTopics.length, 10);
  const challenge = currentChallenge(new Date("2026-07-22T12:00:00+08:00"));
  assert.equal(challenge.id, "weekly-2026-07-22");
  assert.equal(challenge.startsAt, "2026-07-21T16:00:00.000Z");
  assert.equal(challenge.endsAt, "2026-07-28T16:00:00.000Z");
  assert.equal(challenge.title, "A habit that makes your day easier");
  assert.equal(challenge.structuralGuide.length, 4);
  assert.equal(challenge.prizeDraft.rewards.length, 3);
  assert.match(challenge.prizeDraft.rule, /first place chooses first/i);
  assert.equal(challengeForIndex(1).prizeDraft, null);
  assert.equal(challengeForIndex(10).title, challenge.title);
});

test("available challenges include the current week followed by past weeks", () => {
  const launchWeek = availableChallenges(new Date("2026-07-22T12:00:00+08:00"), 10);
  assert.deepEqual(launchWeek.map((challenge) => challenge.id), ["weekly-2026-07-22"]);

  const challenges = availableChallenges(new Date("2026-08-06T12:00:00+08:00"), 3);
  assert.deepEqual(
    challenges.map((challenge) => challenge.id),
    ["weekly-2026-08-05", "weekly-2026-07-29", "weekly-2026-07-22"],
  );
});

test("leaderboard keeps each participant's best score and uses earlier completion as tie-break", () => {
  const challenge = challengeForIndex(0);
  const records = [
    {
      openId: "user-a",
      user: { name: "Amina Rahman" },
      finishedAt: "2026-07-23T09:00:00.000Z",
      question: { challengeId: challenge.id },
      evaluation: { status: "completed", overallScore: 81 },
    },
    {
      openId: "user-a",
      user: { name: "Amina Rahman" },
      finishedAt: "2026-07-24T09:00:00.000Z",
      question: { challengeId: challenge.id },
      evaluation: { status: "completed", overallScore: 88 },
    },
    {
      openId: "user-b",
      user: { name: "Mateo Silva" },
      finishedAt: "2026-07-24T10:00:00.000Z",
      question: { challengeId: challenge.id },
      evaluation: { status: "completed", overallScore: 88 },
    },
    {
      openId: "ignored",
      question: { challengeId: "another-week" },
      evaluation: { status: "completed", overallScore: 99 },
    },
  ];

  const leaderboard = leaderboardForChallenge(records, challenge, "user-b");
  assert.equal(leaderboard.participantCount, 2);
  assert.equal(leaderboard.viewerRank, 2);
  assert.deepEqual(leaderboard.entries, [
    { rank: 1, name: "Amina Rahman", score: 88, attempts: 2, isViewer: false },
    { rank: 2, name: "Mateo Silva", score: 88, attempts: 1, isViewer: true },
  ]);
});

test("leaderboard identity applies one current alias to every challenge entry", () => {
  const challenge = challengeForIndex(0);
  const records = [
    {
      openId: "alias-user",
      user: { name: "Actual Name" },
      finishedAt: "2026-07-23T09:00:00.000Z",
      question: { challengeId: challenge.id },
      evaluation: { status: "completed", overallScore: 91 },
    },
  ];

  const anonymous = leaderboardForChallenge(
    records,
    challenge,
    "alias-user",
    new Map([["alias-user", { alias: "Breezy Otter 2048", useAlias: true }]]),
  );
  assert.equal(anonymous.entries[0].name, "Breezy Otter 2048");

  const identified = leaderboardForChallenge(
    records,
    challenge,
    "alias-user",
    new Map([[
      "alias-user",
      { alias: "Breezy Otter 2048", useAlias: false, actualName: "Current Actual Name" },
    ]]),
  );
  assert.equal(identified.entries[0].name, "Current Actual Name");
});

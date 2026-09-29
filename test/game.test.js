const test = require("node:test");
const assert = require("node:assert/strict");
const {
  availableChallenges,
  challengeForIndex,
  currentChallenge,
  leaderboardForChallenge,
  normalizeGameGroup,
  weeklyTopics,
} = require("../src/game");

test("academic English course starts on 2026-09-28 with sixteen lessons", () => {
  assert.equal(weeklyTopics.length, 16);
  assert.ok(weeklyTopics.every((topic) => topic.unitNumber >= 1 && topic.unitNumber <= 8));
  assert.ok(weeklyTopics.every((topic) => topic.title && topic.question && topic.focus && topic.followUp));
  assert.equal(new Set(weeklyTopics.map((topic) => topic.title)).size, 16);

  // Lesson 1 spans two weeks: 2026-09-28 to 2026-10-12 (UTC+8).
  const challenge = currentChallenge(new Date("2026-09-28T12:00:00+08:00"));
  assert.equal(challenge.id, "weekly-2026-09-28");
  assert.equal(challenge.startsAt, "2026-09-27T16:00:00.000Z");
  assert.equal(challenge.endsAt, "2026-10-11T16:00:00.000Z");
  assert.equal(challenge.title, "Introducing yourself as a researcher");
  assert.equal(challenge.lessonNumber, 1);
  assert.equal(challenge.unitNumber, 1);
  assert.equal(challenge.instructor, "Liu Junli");
  assert.equal(challenge.structuralGuide.length, 4);
  assert.equal(challenge.prizeDraft, undefined);

  // The fortnight still resolves to lesson 1 on its final day.
  assert.equal(currentChallenge(new Date("2026-10-11T12:00:00+08:00")).id, "weekly-2026-09-28");
});

test("lesson 2 starts on Monday 2026-10-12 and lessons run weekly thereafter", () => {
  const lesson2 = challengeForIndex(1);
  assert.equal(lesson2.id, "weekly-2026-10-12");
  assert.equal(lesson2.startsAt, "2026-10-11T16:00:00.000Z");
  assert.equal(lesson2.endsAt, "2026-10-18T16:00:00.000Z");
  assert.equal(lesson2.title, "Structuring an academic presentation");
  assert.equal(lesson2.lessonNumber, 2);

  assert.equal(currentChallenge(new Date("2026-10-12T00:00:00+08:00")).id, "weekly-2026-10-12");

  const lesson16 = challengeForIndex(15);
  assert.equal(lesson16.id, "weekly-2027-01-18");
  assert.equal(lesson16.title, "Round-table defense");
  assert.equal(lesson16.lessonNumber, 16);
  assert.equal(lesson16.unitNumber, 8);
});

test("after lesson 16 the schedule wraps around to lesson 1", () => {
  const wrapped = challengeForIndex(16);
  assert.equal(wrapped.id, "weekly-2027-01-25");
  assert.equal(wrapped.topicIndex, 0);
  assert.equal(wrapped.title, "Introducing yourself as a researcher");
  assert.equal(wrapped.lessonNumber, 1);
  assert.equal(currentChallenge(new Date("2027-01-25T12:00:00+08:00")).topicIndex, 0);
});

test("available challenges list the current lesson first, then past lessons", () => {
  // During the two-week launch lesson only that lesson exists.
  const launch = availableChallenges(new Date("2026-09-30T12:00:00+08:00"), 10);
  assert.deepEqual(launch.map((challenge) => challenge.id), ["weekly-2026-09-28"]);

  const challenges = availableChallenges(new Date("2026-10-21T12:00:00+08:00"), 3);
  assert.deepEqual(
    challenges.map((challenge) => challenge.id),
    ["weekly-2026-10-19", "weekly-2026-10-12", "weekly-2026-09-28"],
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

test("an unknown group token falls back to the default group", () => {
  assert.equal(normalizeGameGroup("g1"), "g1");
  assert.equal(normalizeGameGroup("g2"), "g2");
  assert.equal(normalizeGameGroup("G2"), "g2");
  assert.equal(normalizeGameGroup(" g2 "), "g2");
  assert.equal(normalizeGameGroup("2"), "g2");
  assert.equal(normalizeGameGroup(2), "g2");
  assert.equal(normalizeGameGroup("1"), "g1");
  assert.equal(normalizeGameGroup("group 2"), "g2");
  assert.equal(normalizeGameGroup("group-2"), "g2");
  assert.equal(normalizeGameGroup("group1"), "g1");
  assert.equal(normalizeGameGroup("g3"), "g1");
  assert.equal(normalizeGameGroup(""), "g1");
  assert.equal(normalizeGameGroup(undefined), "g1");
  assert.equal(currentChallenge(new Date("2026-09-29T12:00:00+08:00"), "nonsense").group, "g1");
});

test("parallel group 2 walks the same topic pool in the schedule's chapter order", () => {
  const units = Array.from({ length: 16 }, (_, slot) =>
    challengeForIndex(slot, "g2").unitNumber,
  );
  assert.deepEqual(units, [4, 4, 7, 7, 5, 5, 6, 6, 3, 3, 1, 1, 2, 2, 8, 8]);

  // Each group still covers every one of the sixteen topics exactly once.
  const titles = Array.from({ length: 16 }, (_, slot) => challengeForIndex(slot, "g2").title);
  assert.equal(new Set(titles).size, 16);
  assert.deepEqual([...titles].sort(), weeklyTopics.map((topic) => topic.title).sort());

  // A chapter's two topics keep their existing order inside the group schedule.
  assert.equal(challengeForIndex(0, "g2").topicIndex, 6);
  assert.equal(challengeForIndex(1, "g2").topicIndex, 7);
  assert.equal(challengeForIndex(14, "g2").topicIndex, 14);
  assert.equal(challengeForIndex(15, "g2").topicIndex, 15);

  const launch = currentChallenge(new Date("2026-09-29T12:00:00+08:00"), "g2");
  assert.equal(launch.group, "g2");
  assert.equal(launch.lessonNumber, 1);
  assert.equal(launch.unitNumber, 4);
  assert.equal(launch.title, "Explaining an experimental figure");
  assert.equal(launch.instructor, "Wang Xudong");
});

test("the two groups share lesson dates but never share a challenge id", () => {
  for (let slot = 0; slot < 18; slot += 1) {
    const first = challengeForIndex(slot, "g1");
    const second = challengeForIndex(slot, "g2");
    assert.equal(first.startsAt, second.startsAt, `slot ${slot} start`);
    assert.equal(first.endsAt, second.endsAt, `slot ${slot} end`);
    assert.equal(first.lessonNumber, second.lessonNumber, `slot ${slot} lesson number`);
    assert.notEqual(first.id, second.id, `slot ${slot} id`);
    assert.equal(second.id, `${first.id}-g2`);
    assert.equal(first.group, "g1");
    assert.equal(second.group, "g2");
  }

  // Group 1 keeps its historical identifiers so existing records stay readable.
  assert.equal(challengeForIndex(0).id, "weekly-2026-09-28");
  assert.equal(challengeForIndex(15).id, "weekly-2027-01-18");

  // Group 2 wraps past lesson 16 on the same course calendar.
  const wrapped = challengeForIndex(16, "g2");
  assert.equal(wrapped.id, "weekly-2027-01-25-g2");
  assert.equal(wrapped.lessonNumber, 1);
  assert.equal(wrapped.topicIndex, 6);
  assert.equal(wrapped.startsAt, challengeForIndex(16, "g1").startsAt);
});

test("available challenges and leaderboards stay inside one group", () => {
  const now = new Date("2026-10-21T12:00:00+08:00");
  assert.deepEqual(
    availableChallenges(now, 3, "g2").map((challenge) => challenge.id),
    ["weekly-2026-10-19-g2", "weekly-2026-10-12-g2", "weekly-2026-09-28-g2"],
  );

  const first = challengeForIndex(0, "g1");
  const second = challengeForIndex(0, "g2");
  const records = [
    {
      openId: "group-one",
      user: { name: "Group One" },
      finishedAt: "2026-07-23T09:00:00.000Z",
      question: { challengeId: first.id },
      evaluation: { status: "completed", overallScore: 81 },
    },
    {
      openId: "group-two",
      user: { name: "Group Two" },
      finishedAt: "2026-07-24T09:00:00.000Z",
      question: { challengeId: second.id },
      evaluation: { status: "completed", overallScore: 95 },
    },
  ];

  const firstBoard = leaderboardForChallenge(records, first, "group-one");
  assert.deepEqual(firstBoard.entries.map((entry) => entry.name), ["Group One"]);
  const secondBoard = leaderboardForChallenge(records, second, "group-two");
  assert.deepEqual(secondBoard.entries.map((entry) => entry.name), ["Group Two"]);
});

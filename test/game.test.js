const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  GAME_GROUPS,
  availableChallenges,
  challengeForIndex,
  challengeQuestion,
  currentChallenge,
  leaderboardForChallenge,
  matchesChallengeId,
  normalizeGameGroup,
  requiresCameraForQuestion,
  shandongTopics,
  weeklyTopics,
} = require("../src/game");

const publicDir = path.join(__dirname, "..", "public");

// The lessons whose task material is a figure the learner must interpret.
const FIGURE_LESSON_SLUGS = {
  "Structuring an academic presentation": "l02-presentation-structure",
  "Finding the main line of a talk": "l03-talk-mainline",
  "Three-pass reading of an AI paper": "l05-paper-three-pass",
  "Explaining an experimental figure": "l07-experimental-figure",
  "Managing the boundaries of your results": "l10-results-boundaries",
  "Title and abstract information structure": "l12-title-abstract",
};

test("academic English course starts on 2026-09-28 with sixteen shared topics", () => {
  assert.equal(weeklyTopics.length, 16);
  assert.ok(weeklyTopics.every((topic) => topic.unitNumber >= 1 && topic.unitNumber <= 8));
  assert.ok(weeklyTopics.every((topic) => topic.title && topic.question && topic.focus && topic.followUp));
  assert.equal(new Set(weeklyTopics.map((topic) => topic.title)).size, 16);

  // Lesson 1 spans two weeks: 2026-09-28 to 2026-10-13 (UTC+8) after the
  // one-time 24h handover extension.
  const challenge = currentChallenge(new Date("2026-09-28T12:00:00+08:00"));
  assert.equal(challenge.id, "weekly-2026-09-28");
  assert.equal(challenge.startsAt, "2026-09-27T16:00:00.000Z");
  assert.equal(challenge.endsAt, "2026-10-12T16:00:00.000Z");
  assert.equal(challenge.title, "Introducing yourself as a researcher");
  assert.equal(challenge.lessonNumber, 1);
  assert.equal(challenge.unitNumber, 1);
  assert.equal(challenge.instructor, "Liu Junli");
  assert.equal(challenge.structuralGuide.length, 4);
  assert.equal(challenge.prizeDraft, undefined);

  // The fortnight still resolves to lesson 1 on its final day, including the
  // extension window (2026-10-12 up to 24:00 UTC+8).
  assert.equal(currentChallenge(new Date("2026-10-11T12:00:00+08:00")).id, "weekly-2026-09-28");
  assert.equal(currentChallenge(new Date("2026-10-12T23:59:59+08:00")).id, "weekly-2026-09-28");
});

test("lesson 2 starts 2026-10-13 after the handover and lessons run weekly thereafter", () => {
  const lesson2 = challengeForIndex(1);
  assert.equal(lesson2.id, "weekly-2026-10-13");
  assert.equal(lesson2.startsAt, "2026-10-12T16:00:00.000Z");
  // Lesson 2 is extended through the end of Monday 2026-10-19 (23:59:59.999
  // UTC+8); its exclusive end boundary is midnight going into 2026-10-20.
  assert.equal(lesson2.endsAt, "2026-10-19T16:00:00.000Z");
  assert.equal(lesson2.title, "Structuring an academic presentation");
  assert.equal(lesson2.lessonNumber, 2);

  assert.equal(currentChallenge(new Date("2026-10-13T00:00:00+08:00")).id, "weekly-2026-10-13");

  // Lesson 2 stays live all day Monday 2026-10-19, including noon and the
  // final minute before midnight.
  assert.equal(currentChallenge(new Date("2026-10-19T11:59:59+08:00")).id, "weekly-2026-10-13");
  assert.equal(currentChallenge(new Date("2026-10-19T12:00:00+08:00")).id, "weekly-2026-10-13");
  assert.equal(currentChallenge(new Date("2026-10-19T23:59:59+08:00")).id, "weekly-2026-10-13");

  // Lesson 3 goes live at midnight into 2026-10-20 and runs to the first
  // Monday-noon switch (2026-10-26 12:00 UTC+8).
  const lesson3 = currentChallenge(new Date("2026-10-20T00:00:00+08:00"));
  assert.equal(lesson3.id, "weekly-2026-10-20");
  assert.equal(lesson3.startsAt, "2026-10-19T16:00:00.000Z");
  assert.equal(lesson3.endsAt, "2026-10-26T04:00:00.000Z");

  // From lesson 3's end onward, weekly switches land at Monday 12:00 exactly:
  // lesson 3 is still live just before noon and lesson 4 appears at 12:00.
  assert.equal(currentChallenge(new Date("2026-10-26T11:59:59+08:00")).id, "weekly-2026-10-20");
  const lesson4 = currentChallenge(new Date("2026-10-26T12:00:00+08:00"));
  assert.equal(lesson4.id, "weekly-2026-10-26");
  assert.equal(lesson4.startsAt, "2026-10-26T04:00:00.000Z");
  assert.equal(lesson4.endsAt, "2026-11-02T04:00:00.000Z");

  const lesson15 = challengeForIndex(14);
  assert.equal(lesson15.id, "weekly-2027-01-11");
  assert.equal(lesson15.title, "Round-table defense");
  assert.equal(lesson15.lessonNumber, 15);
  assert.equal(lesson15.unitNumber, 8);
});

test("after the fifteen-lesson academic schedule it wraps to lesson 1", () => {
  const wrapped = challengeForIndex(15);
  assert.equal(wrapped.id, "weekly-2027-01-18");
  assert.equal(wrapped.topicIndex, 0);
  assert.equal(wrapped.title, "Introducing yourself as a researcher");
  assert.equal(wrapped.lessonNumber, 1);
  assert.equal(currentChallenge(new Date("2027-01-18T12:00:00+08:00")).topicIndex, 0);
  // Noon boundary applies to later weeks too: the outgoing lesson stays live
  // until 12:00 (noon) UTC+8 on switch Monday.
  assert.equal(currentChallenge(new Date("2027-01-18T11:59:59+08:00")).topicIndex, 15);
});

test("available challenges list the current lesson first, then past lessons", () => {
  // During the two-week launch lesson only that lesson exists.
  const launch = availableChallenges(new Date("2026-09-30T12:00:00+08:00"), 10);
  assert.deepEqual(launch.map((challenge) => challenge.id), ["weekly-2026-09-28"]);

  const challenges = availableChallenges(new Date("2026-10-21T12:00:00+08:00"), 3);
  assert.deepEqual(
    challenges.map((challenge) => challenge.id),
    ["weekly-2026-10-20", "weekly-2026-10-13", "weekly-2026-09-28"],
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
    { rank: 1, name: "Amina Rahman", score: 88, attempts: 2, isViewer: false, answerId: undefined, mediaType: undefined },
    { rank: 2, name: "Mateo Silva", score: 88, attempts: 1, isViewer: true, answerId: undefined, mediaType: undefined },
  ]);
});

test("leaderboard exposes the best attempt's recording for playback", () => {
  const challenge = challengeForIndex(0);
  const records = [
    {
      id: "record-old",
      openId: "user-a",
      user: { name: "Amina Rahman" },
      finishedAt: "2026-07-23T09:00:00.000Z",
      filename: "old-answer.mp4",
      question: { challengeId: challenge.id },
      evaluation: { status: "completed", overallScore: 70 },
    },
    {
      id: "record-best",
      openId: "user-a",
      user: { name: "Amina Rahman" },
      finishedAt: "2026-07-24T09:00:00.000Z",
      filename: "best-answer.mp4",
      question: { challengeId: challenge.id },
      evaluation: { status: "completed", overallScore: 88 },
    },
    {
      id: "record-audio",
      openId: "user-b",
      user: { name: "Mateo Silva" },
      finishedAt: "2026-07-24T10:00:00.000Z",
      filename: "audio-answer.mp3",
      question: { challengeId: challenge.id },
      evaluation: { status: "completed", overallScore: 64 },
    },
    {
      // A lower attempt whose recording must not shadow the best one.
      id: "record-noise",
      openId: "user-b",
      user: { name: "Mateo Silva" },
      finishedAt: "2026-07-25T10:00:00.000Z",
      filename: "noise-answer.mp4",
      question: { challengeId: challenge.id },
      evaluation: { status: "completed", overallScore: 60 },
    },
    {
      // Answers without a stored recording still rank without a play button.
      openId: "user-c",
      user: { name: "No Recording" },
      finishedAt: "2026-07-24T11:00:00.000Z",
      question: { challengeId: challenge.id },
      evaluation: { status: "completed", overallScore: 55 },
    },
  ];

  const leaderboard = leaderboardForChallenge(records, challenge, "user-c");
  assert.deepEqual(leaderboard.entries, [
    { rank: 1, name: "Amina Rahman", score: 88, attempts: 2, isViewer: false, answerId: "record-best", mediaType: "video" },
    { rank: 2, name: "Mateo Silva", score: 64, attempts: 2, isViewer: false, answerId: "record-audio", mediaType: "audio" },
    { rank: 3, name: "No Recording", score: 55, attempts: 1, isViewer: true, answerId: undefined, mediaType: undefined },
  ]);
});

test("schedule-era legacy challenge ids still appear on their canonical board", () => {
  const lesson2 = challengeForIndex(1, "g2");
  assert.equal(lesson2.id, "weekly-2026-10-13-g2");
  assert.deepEqual(lesson2.aliasIds, ["weekly-2026-10-12-g2"]);

  const lesson3 = challengeForIndex(2, "g2");
  assert.equal(lesson3.id, "weekly-2026-10-20-g2");
  assert.deepEqual(lesson3.aliasIds, ["weekly-2026-10-19-g2"]);

  // The default group keeps un-suffixed legacy ids only.
  assert.deepEqual(challengeForIndex(1).aliasIds, ["weekly-2026-10-12"]);
  assert.deepEqual(challengeForIndex(2).aliasIds, ["weekly-2026-10-19"]);
  assert.deepEqual(challengeForIndex(0).aliasIds, []);

  const leaderboard = leaderboardForChallenge(
    [
      {
        id: "legacy-1",
        openId: "user-a",
        user: { name: "张鳐" },
        finishedAt: "2026-10-11T23:27:48.005Z",
        question: { challengeId: "weekly-2026-10-12-g2" },
        evaluation: { status: "completed", overallScore: 69 },
      },
    ],
    lesson2,
    null,
  );
  assert.equal(leaderboard.participantCount, 1);
  assert.equal(leaderboard.entries[0].name, "张鳐");

  assert.equal(matchesChallengeId(lesson2, "weekly-2026-10-13-g2"), true);
  assert.equal(matchesChallengeId(lesson2, "weekly-2026-10-12-g2"), true);
  // Group-scoped aliases never leak across groups.
  assert.equal(matchesChallengeId(lesson2, "weekly-2026-10-12"), false);
  assert.equal(matchesChallengeId(challengeForIndex(1), "weekly-2026-10-12-g2"), false);
  assert.equal(matchesChallengeId(lesson2, "weekly-2026-09-28-g2"), false);
  assert.equal(matchesChallengeId(lesson2, ""), false);
  assert.equal(matchesChallengeId(lesson2, undefined), false);
});

test("leaderboard always shows the real name; stored actualName wins over the record name", () => {
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

  const withStoredName = leaderboardForChallenge(
    records,
    challenge,
    "alias-user",
    new Map([["alias-user", { actualName: "Current Actual Name" }]]),
  );
  assert.equal(withStoredName.entries[0].name, "Current Actual Name");

  // Even a legacy alias record can no longer anonymise the board.
  const withLegacyAlias = leaderboardForChallenge(
    records,
    challenge,
    "alias-user",
    new Map([["alias-user", { alias: "Breezy Otter 2048", useAlias: true }]]),
  );
  assert.equal(withLegacyAlias.entries[0].name, "Actual Name");
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
  assert.equal(normalizeGameGroup("g3"), "g3");
  assert.equal(normalizeGameGroup("G3"), "g3");
  assert.equal(normalizeGameGroup("3"), "g3");
  assert.equal(normalizeGameGroup("group 3"), "g3");
  assert.equal(normalizeGameGroup(3), "g3");
  assert.equal(normalizeGameGroup(""), "g1");
  assert.equal(normalizeGameGroup(undefined), "g1");
  assert.equal(currentChallenge(new Date("2026-09-29T12:00:00+08:00"), "nonsense").group, "g1");
});

test("山东大学 starts in the current course week with its own two-minute topic cycle", () => {
  const expected = [
    ["weekly-2026-10-20-g3", "How do you use AI everyday?"],
    ["weekly-2026-10-26-g3", "The canteen dish I would defend in court"],
    ["weekly-2026-11-02-g3", "A survival guide for an 8 a.m. class"],
    ["weekly-2026-11-09-g3", "My class group chat has a personality"],
    ["weekly-2026-11-16-g3", "The package I waited for like a movie premiere"],
    ["weekly-2026-11-23-g3", "How to win the library seat battle"],
    ["weekly-2026-11-30-g3", "The one item in my dorm with main-character energy"],
    ["weekly-2026-12-07-g3", "The app I open for no reason"],
    ["weekly-2026-12-14-g3", "If AI planned my campus day"],
  ];

  assert.equal(shandongTopics.length, expected.length);
  expected.forEach(([id, title], offset) => {
    const challenge = challengeForIndex(2 + offset, "g3");
    assert.equal(challenge.id, id);
    assert.equal(challenge.title, title);
    assert.equal(challenge.group, "g3");
    assert.equal(challenge.groupLabel, "山东大学");
    assert.equal(challenge.topicIndex, offset);
    assert.equal(challenge.lessonNumber, offset + 1);
    assert.equal(challenge.expectedDurationSeconds, 120);
    assert.equal(challenge.requiresFigureUpload, false);
    assert.equal(challenge.figure, null);
    assert.equal(challenge.startsAt, challengeForIndex(2 + offset, "g1").startsAt);
  });

  const launch = currentChallenge(new Date("2026-10-22T12:00:00+08:00"), "g3");
  assert.equal(launch.id, "weekly-2026-10-20-g3");
  assert.equal(launch.title, "How do you use AI everyday?");
  assert.equal(launch.groupLabel, "山东大学");
  assert.equal(launch.lessonNumber, 1);
  assert.match(launch.question, /^How do you use AI in your everyday life\?/);

  // The group does not invent boards for course weeks before it launched.
  assert.deepEqual(availableChallenges(new Date("2026-10-19T12:00:00+08:00"), 10, "g3"), []);
  assert.deepEqual(
    availableChallenges(new Date("2026-10-22T12:00:00+08:00"), 10, "g3").map((item) => item.id),
    ["weekly-2026-10-20-g3"],
  );
  assert.deepEqual(
    availableChallenges(new Date("2026-10-27T12:00:00+08:00"), 10, "g3").map((item) => item.id),
    ["weekly-2026-10-26-g3", "weekly-2026-10-20-g3"],
  );

  // Lesson numbering keeps counting while the nine speaking topics repeat.
  const wrapped = challengeForIndex(11, "g3");
  assert.equal(wrapped.id, "weekly-2026-12-21-g3");
  assert.equal(wrapped.title, expected[0][1]);
  assert.equal(wrapped.topicIndex, 0);
  assert.equal(wrapped.lessonNumber, 10);
});

test("parallel group 2 walks the same topic pool in the schedule's chapter order", () => {
  const units = Array.from({ length: 15 }, (_, slot) =>
    challengeForIndex(slot, "g2").unitNumber,
  );
  assert.deepEqual(units, [4, 4, 7, 7, 5, 6, 6, 3, 3, 1, 1, 2, 2, 8, 8]);

  // Group 2 permanently omits its former Nov 9-16 topic from the rotation.
  const titles = Array.from({ length: 15 }, (_, slot) => challengeForIndex(slot, "g2").title);
  assert.equal(new Set(titles).size, 15);
  assert.ok(!titles.includes("Managing the boundaries of your results"));
  assert.deepEqual(
    [...titles].sort(),
    weeklyTopics
      .filter((topic) => topic.title !== "Managing the boundaries of your results")
      .map((topic) =>
        topic.title === "Handling hard questions"
          ? "Draft a short research abstract"
          : topic.title)
      .sort(),
  );

  // A chapter's two topics keep their existing order inside the group schedule.
  assert.equal(challengeForIndex(0, "g2").topicIndex, 6);
  assert.equal(challengeForIndex(1, "g2").topicIndex, 7);
  assert.equal(challengeForIndex(13, "g2").topicIndex, 14);
  assert.equal(challengeForIndex(14, "g2").topicIndex, 15);

  const launch = currentChallenge(new Date("2026-09-29T12:00:00+08:00"), "g2");
  assert.equal(launch.group, "g2");
  assert.equal(launch.lessonNumber, 1);
  assert.equal(launch.unitNumber, 4);
  assert.equal(launch.title, "Explaining an experimental figure");
  assert.equal(launch.instructor, "Wang Xudong");
});

test("academic groups permanently omit Nov 9-16 and shift later topics one week earlier", () => {
  const groupOneTitles = Array.from(
    { length: 15 },
    (_, slot) => challengeForIndex(slot, "g1").title,
  );
  const groupTwoTitles = Array.from(
    { length: 15 },
    (_, slot) => challengeForIndex(slot, "g2").title,
  );

  assert.equal(new Set(groupOneTitles).size, 15);
  assert.equal(new Set(groupTwoTitles).size, 15);
  assert.ok(!groupOneTitles.includes("From research question to contribution"));
  assert.ok(!groupTwoTitles.includes("Managing the boundaries of your results"));

  // The previous lesson stays live until noon, then the former Nov 16 pair
  // takes over the Nov 9 window.
  assert.equal(
    currentChallenge(new Date("2026-11-09T11:59:59+08:00"), "g1").title,
    "Writing an academic paper in English",
  );
  const groupOne = currentChallenge(new Date("2026-11-09T12:00:00+08:00"), "g1");
  assert.equal(groupOne.id, "weekly-2026-11-09");
  assert.equal(groupOne.lessonNumber, 6);
  assert.equal(groupOne.title, "Explaining an experimental figure");
  assert.equal(groupOne.instructor, "Wang Xudong");

  const groupTwo = currentChallenge(new Date("2026-11-09T12:00:00+08:00"), "g2");
  assert.equal(groupTwo.id, "weekly-2026-11-09-g2");
  assert.equal(groupTwo.lessonNumber, 6);
  assert.equal(groupTwo.title, "Two-minute group-meeting update");
  assert.equal(groupTwo.instructor, "Gao Kun");

  assert.equal(challengeForIndex(6, "g1").title, "Walking through your method");
  assert.equal(challengeForIndex(6, "g2").title, "Title and abstract information structure");

  const finalLesson = challengeForIndex(14, "g1");
  assert.equal(finalLesson.id, "weekly-2027-01-11");
  assert.equal(finalLesson.lessonNumber, 15);
  assert.equal(finalLesson.title, "Round-table defense");
  assert.equal(finalLesson.instructor, "Course faculty");
  assert.equal(finalLesson.endsAt, "2027-01-18T04:00:00.000Z");

  const nextCycle = currentChallenge(new Date("2027-01-18T12:00:00+08:00"), "g1");
  assert.equal(nextCycle.id, "weekly-2027-01-18");
  assert.equal(nextCycle.lessonNumber, 1);
  assert.equal(nextCycle.title, "Introducing yourself as a researcher");

  // 山东大学 keeps its own calendar and topic cycle during the removed week.
  const shandong = currentChallenge(new Date("2026-11-09T12:00:00+08:00"), "g3");
  assert.equal(shandong.id, "weekly-2026-11-09-g3");
  assert.equal(shandong.lessonNumber, 4);
  assert.equal(shandong.title, "My class group chat has a personality");
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

  for (let slot = 2; slot < 12; slot += 1) {
    const shandong = challengeForIndex(slot, "g3");
    assert.notEqual(shandong.id, challengeForIndex(slot, "g1").id);
    assert.notEqual(shandong.id, challengeForIndex(slot, "g2").id);
    assert.equal(shandong.id, `${challengeForIndex(slot, "g1").id}-g3`);
  }

  // Group 1 keeps its historical identifiers so existing records stay readable.
  assert.equal(challengeForIndex(0).id, "weekly-2026-09-28");
  assert.equal(challengeForIndex(14).id, "weekly-2027-01-11");

  // Group 2 wraps one week earlier on the same course calendar.
  const wrapped = challengeForIndex(15, "g2");
  assert.equal(wrapped.id, "weekly-2027-01-18-g2");
  assert.equal(wrapped.lessonNumber, 1);
  assert.equal(wrapped.topicIndex, 6);
  assert.equal(wrapped.startsAt, challengeForIndex(15, "g1").startsAt);
});

test("the shared three-minute research statement lands in g2 lesson 3", () => {
  const challenge = challengeForIndex(2, "g2");
  assert.equal(challenge.id, "weekly-2026-10-20-g2");
  assert.equal(
    challenge.title,
    "Three-minute research statement around one figure",
  );
  assert.equal(challenge.expectedDurationSeconds, 180);
  assert.equal(challenge.requiresFigureUpload, true);
  assert.equal(challenge.figure, null);
  assert.match(challenge.question, /^Deliver a 3-minute research statement/);
  assert.match(challenge.question, /1\. Context\/problem:.*~30s/);
  assert.match(challenge.question, /2\. Gap\/question:.*~20s/);
  assert.match(challenge.question, /3\. What we did:.*~40s/);
  assert.match(challenge.question, /4\. The figure:.*~60s/);
  assert.match(challenge.question, /5\. So-what \+ boundary:.*~30s/);
  assert.match(challenge.question, /figure carries the evidential weight/);
  assert.equal(challenge.followUp, "What is the one sentence you want remembered?");

  // The topic is shared by the parallel course, so group 1 receives it later.
  assert.equal(challengeForIndex(11, "g1").title, challenge.title);
  assert.equal(challengeForIndex(11, "g1").requiresFigureUpload, true);
  assert.equal(challengeQuestion(challenge).requiresFigureUpload, true);
});

test("group 1 has a one-week paper title and abstract override", () => {
  const current = currentChallenge(new Date("2026-10-29T12:00:00+08:00"), "g1");
  assert.equal(current.id, "weekly-2026-10-26");
  assert.equal(current.topicIndex, 3);
  assert.equal(current.instructor, "He Yuan");
  assert.equal(current.title, "Writing a paper title and abstract for your research project");
  assert.equal(current.expectedDurationSeconds, 120);
  assert.equal(current.requiresFigureUpload, false);
  assert.match(current.question, /^Write and present an English paper title and abstract/);
  assert.match(current.question, /no more than 18 English words/);
  assert.match(current.question, /Reflect the research question and main findings accurately/);
  assert.match(current.question, /180–220 words/);
  assert.match(current.question, /problem that remains unresolved/);
  assert.match(current.question, /what your study compared/);
  assert.match(current.question, /most important result/);
  assert.match(current.question, /trade-off between performance and inference cost/);
  assert.match(current.question, /cautious, accurate conclusion/);
  assert.match(current.question, /Title requirements:\n- /);
  assert.match(current.question, /Abstract requirements:\n- Write 180–220 words\.\n- /);
  assert.equal(
    current.followUp,
    "Which sentence in your abstract most clearly states the main finding, and what limitation must qualify it?",
  );

  // Only this group and week are overridden. Group 1 has another replacement
  // next week, and Group 2 has its own replacement for the same window.
  const nextWeek = challengeForIndex(4, "g1");
  assert.equal(nextWeek.id, "weekly-2026-11-02");
  assert.equal(nextWeek.title, "Writing an academic paper in English");
  assert.equal(nextWeek.instructor, "He Yuan");
  const parallelGroup = challengeForIndex(3, "g2");
  assert.equal(parallelGroup.title, "Draft a short research abstract");
  assert.equal(parallelGroup.instructor, "Hu Chen");
});

test("group 1 has a two-minute academic paper writing task for Nov 2", () => {
  const atBoundary = currentChallenge(new Date("2026-11-02T12:00:00+08:00"), "g1");
  assert.equal(atBoundary.id, "weekly-2026-11-02");
  assert.equal(atBoundary.lessonNumber, 5);
  assert.equal(atBoundary.instructor, "He Yuan");
  assert.equal(atBoundary.title, "Writing an academic paper in English");
  assert.equal(atBoundary.expectedDurationSeconds, 120);
  assert.equal(atBoundary.requiresFigureUpload, false);
  assert.equal(atBoundary.figure, null);
  assert.equal(atBoundary.unitNumber, 3);
  assert.equal(atBoundary.unitTitle, "AI paper structure & efficient reading");
  assert.match(atBoundary.question, /^Task requirements:\n1\. Choose one paper you know well/);
  assert.match(atBoundary.question, /research question and main contribution in one or two sentences/);
  assert.match(atBoundary.question, /purpose and order of its main sections/);
  assert.match(atBoundary.question, /precise verbs, cautious claims, topic sentences, or linking ideas/);
  assert.match(atBoundary.question, /identify the feedback or evidence you would need before submitting it/);
  assert.match(atBoundary.question, /Keep your response to about two minutes\.$/);
  assert.equal(
    atBoundary.focus,
    "A clear paper structure, precise English-writing choices, and a concrete revision plan",
  );
  assert.equal(atBoundary.followUp, "Which sentence or section would you revise first, and why?");
  assert.equal(atBoundary.endsAt, "2026-11-09T04:00:00.000Z");

  assert.equal(
    currentChallenge(new Date("2026-11-02T11:59:59+08:00"), "g1").title,
    "Writing a paper title and abstract for your research project",
  );
  const parallelGroup = currentChallenge(new Date("2026-11-02T12:00:00+08:00"), "g2");
  assert.equal(parallelGroup.title, "Stating contributions without overclaiming");
  assert.equal(parallelGroup.instructor, "Hu Chen");
});

test("group 2 has a one-week research abstract and revision workshop", () => {
  const current = currentChallenge(new Date("2026-10-29T12:00:00+08:00"), "g2");
  assert.equal(current.id, "weekly-2026-10-26-g2");
  assert.equal(current.lessonNumber, 4);
  assert.equal(current.instructor, "Hu Chen");
  assert.equal(current.title, "Draft a short research abstract");
  assert.equal(current.expectedDurationSeconds, 120);
  assert.equal(current.requiresFigureUpload, false);
  assert.equal(current.figure, null);
  assert.match(current.question, /^Task requirements:\n1\. Draft a short research abstract\./);
  assert.match(current.question, /around 150-180 words/);
  assert.match(current.question, /alternative opening of about 40 words/);
  assert.match(current.question, /two sentences about the findings or contribution/);
  assert.match(current.question, /Mark a sentence you would like to discuss or improve/);
  assert.match(current.question, /keep the original and revised versions/);
  assert.equal(
    current.followUp,
    "Which sentence did you choose for feedback, and what evidence supports it?",
  );

  // The override is limited to this group and week.
  assert.equal(challengeForIndex(4, "g2").title, "Stating contributions without overclaiming");
  assert.equal(challengeForIndex(3, "g1").instructor, "He Yuan");
});

test("available challenges and leaderboards stay inside one group", () => {
  const now = new Date("2026-10-21T12:00:00+08:00");
  assert.deepEqual(
    availableChallenges(now, 3, "g2").map((challenge) => challenge.id),
    ["weekly-2026-10-20-g2", "weekly-2026-10-13-g2", "weekly-2026-09-28-g2"],
  );

  const first = challengeForIndex(0, "g1");
  const second = challengeForIndex(0, "g2");
  const third = challengeForIndex(2, "g3");
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
    {
      openId: "group-three",
      user: { name: "Group Three" },
      finishedAt: "2026-10-22T09:00:00.000Z",
      question: { challengeId: third.id },
      evaluation: { status: "completed", overallScore: 89 },
    },
  ];

  const firstBoard = leaderboardForChallenge(records, first, "group-one");
  assert.deepEqual(firstBoard.entries.map((entry) => entry.name), ["Group One"]);
  const secondBoard = leaderboardForChallenge(records, second, "group-two");
  assert.deepEqual(secondBoard.entries.map((entry) => entry.name), ["Group Two"]);
  const thirdBoard = leaderboardForChallenge(records, third, "group-three");
  assert.deepEqual(thirdBoard.entries.map((entry) => entry.name), ["Group Three"]);
});

test("exactly the six supplied-figure lessons carry an interpretable asset", () => {
  const withFigure = weeklyTopics.filter((topic) => topic.figure);
  assert.equal(withFigure.length, Object.keys(FIGURE_LESSON_SLUGS).length);
  assert.deepEqual(
    withFigure.map((topic) => topic.title).sort(),
    Object.keys(FIGURE_LESSON_SLUGS).sort(),
  );

  for (const topic of withFigure) {
    const slug = FIGURE_LESSON_SLUGS[topic.title];
    assert.equal(topic.figure.src, `/assets/figures/${slug}.png`);
    assert.match(topic.figure.src, /^\/assets\/figures\/[a-z0-9-]+\.png$/);
    assert.ok(topic.figure.alt.length > 20, `${topic.title} needs descriptive alt text`);
    assert.equal(topic.figure.caption, "Illustrative figure — synthetic data");
    // Every referenced asset must ship with the repository.
    assert.equal(
      fs.existsSync(path.join(publicDir, topic.figure.src.replace(/^\//, ""))),
      true,
      `missing committed asset for ${topic.title}`,
    );
  }

  // The ten remaining lessons stay text-only; the research-statement lesson
  // requires a learner-uploaded figure instead of shipping a sample.
  assert.equal(weeklyTopics.filter((topic) => !topic.figure).length, 10);
});

test("the figure follows the topic, so both class groups receive the right one", () => {
  for (const group of ["g1", "g2"]) {
    for (const slot of Array.from({ length: 16 }, (_, index) => index)) {
      const challenge = challengeForIndex(slot, group);
      const topic = weeklyTopics[challenge.topicIndex];
      const dateKey = new Date(challenge.startsAt).toLocaleDateString("en-CA", {
        timeZone: "Asia/Shanghai",
      });
      const override = GAME_GROUPS[group].weekOverrides?.[dateKey];
      const expectedFigure = override && Object.hasOwn(override, "figure")
        ? override.figure
        : topic.figure || null;
      assert.deepEqual(
        challenge.figure,
        expectedFigure,
        `${group} slot ${slot} (${challenge.title}) figure`,
      );
    }
  }

  // Group 2 opens the course on a different topic and must receive its figure.
  const launch = currentChallenge(new Date("2026-09-29T12:00:00+08:00"), "g2");
  assert.equal(launch.title, "Explaining an experimental figure");
  assert.equal(launch.figure.src, "/assets/figures/l07-experimental-figure.png");

  const firstTopical = currentChallenge(new Date("2026-09-29T12:00:00+08:00"), "g1");
  assert.equal(firstTopical.figure, null);
});

test("the persisted question carries the figure so history and scoring keep it", () => {
  const lesson = challengeForIndex(5, "g1");
  const question = challengeQuestion(lesson);
  assert.equal(question.figure.src, lesson.figure.src);
  assert.equal(question.figure.caption, lesson.figure.caption);
  assert.equal(question.challengeId, lesson.id);

  const textOnly = challengeQuestion(challengeForIndex(0, "g1"));
  assert.equal(textOnly.figure, null);
});

test("groups 1 and 2 persist a camera requirement while group 3 stays optional", () => {
  for (const [group, expected] of [["g1", true], ["g2", true], ["g3", false]]) {
    const challenge = challengeForIndex(0, group);
    assert.equal(challenge.requiresCamera, expected, `${group} challenge`);
    assert.equal(challengeQuestion(challenge).requiresCamera, expected, `${group} question`);
  }

  assert.equal(requiresCameraForQuestion({ challengeId: "weekly-2026-09-28" }), true);
  assert.equal(requiresCameraForQuestion({ challengeId: "weekly-2026-09-28-g2" }), true);
  assert.equal(requiresCameraForQuestion({ challengeId: "weekly-2026-09-28-g3" }), false);
  assert.equal(requiresCameraForQuestion({ question: "General examine question" }), false);
  assert.equal(requiresCameraForQuestion({ challengeId: "weekly-2026-09-28-g2", requiresCamera: false }), false);
});

test("figure lessons read as plain tasks without an 'use the figure' opener", () => {
  const figureTopics = weeklyTopics.filter((topic) => topic.figure);
  assert.equal(figureTopics.length, 6);

  // The figure is the task material because it is shown beside the question and
  // labelled "Task figure"; the prompt itself stays a plain task statement.
  const stalePhrasing =
    /not your own|your own work|from your own|choose one|your current work|you recently heard|you have read recently/i;

  for (const topic of figureTopics) {
    assert.doesNotMatch(topic.question, /^use the\b/i, `${topic.title} must not open with an imperative`);
    assert.doesNotMatch(topic.question, /\bshown\b/i, `${topic.title} must not say "shown"`);
    assert.doesNotMatch(topic.question, stalePhrasing, `${topic.title} must not ask for own material`);
  }

  // Text-only lessons must not point at a figure that is not supplied.
  for (const topic of weeklyTopics.filter((topic) => !topic.figure)) {
    assert.doesNotMatch(topic.question, /\bshown\b/i, `${topic.title} has no figure to point at`);
  }
});

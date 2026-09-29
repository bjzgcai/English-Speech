const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// Academic English weekly course: lesson 1 launches Monday 2026-09-28 (UTC+8) and
// spans two weeks (until 2026-10-12). From lesson 2 onward each lesson runs one
// week, Monday to Monday. After lesson 16 the schedule wraps around (modulo 16).
const COURSE_ANCHOR_MS = Date.parse("2026-09-28T00:00:00+08:00");
const LESSON_COUNT = 16;
const LAUNCH_END_MS = COURSE_ANCHOR_MS + 2 * WEEK_MS;

const weeklyTopics = Object.freeze([
  // Unit 1 — Course launch & research survival communication (Liu Junli)
  {
    unitNumber: 1,
    unitTitle: "Course launch & research survival communication",
    instructor: "Liu Junli",
    title: "Introducing yourself as a researcher",
    question:
      "Introduce yourself as a researcher: the problem you care about, your research direction and methods, and your current progress.",
    focus: "Clear problem, direction, method, and a concrete progress update",
    followUp: "What will you do next, and why?",
  },
  {
    unitNumber: 1,
    unitTitle: "Course launch & research survival communication",
    instructor: "Liu Junli",
    title: "Structuring an academic presentation",
    question:
      "Outline how you would structure a strong academic presentation, and explain one PPT-design or body-language technique you will adopt and why.",
    focus: "Logical talk structure plus one specific delivery technique",
    followUp: "How would you open your talk in one sentence?",
  },
  // Unit 2 — Academic listening, notes & questions (Liu Junli)
  {
    unitNumber: 2,
    unitTitle: "Academic listening, notes & questions",
    instructor: "Liu Junli",
    title: "Finding the main line of a talk",
    question:
      "Describe how you identify the structure signposts and main line of a short academic talk, using a talk you recently heard as an example.",
    focus: "Concrete signposts and one real example",
    followUp: "What was the speaker's key message?",
  },
  {
    unitNumber: 2,
    unitTitle: "Academic listening, notes & questions",
    instructor: "Liu Junli",
    title: "Asking questions at a seminar",
    question:
      "Think of a question you would ask after a seminar talk. State your open or clarifying question, explain why it matters, and phrase it politely and professionally.",
    focus: "A well-phrased question with a clear motivation",
    followUp: "How would you follow up if the answer is unclear?",
  },
  // Unit 3 — AI paper structure & efficient reading (He Yuan)
  {
    unitNumber: 3,
    unitTitle: "AI paper structure & efficient reading",
    instructor: "He Yuan",
    title: "Three-pass reading of an AI paper",
    question:
      "Explain the abstract-figures-conclusion three-pass reading method, and show how you would apply it to one AI paper you have read recently.",
    focus: "Method explained plus one applied example",
    followUp: "What did the figures tell you before you read the text?",
  },
  {
    unitNumber: 3,
    unitTitle: "AI paper structure & efficient reading",
    instructor: "He Yuan",
    title: "From research question to contribution",
    question:
      "Summarize one AI paper's narrative: its research question, claimed contribution, and supporting evidence — and point out one assumption or limitation.",
    focus: "Question, contribution, evidence, and a boundary",
    followUp: "Which claim is weakest, and why?",
  },
  // Unit 4 — Explaining figures, methods & experiments (Wang Xudong)
  {
    unitNumber: 4,
    unitTitle: "Explaining figures, methods & experiments",
    instructor: "Wang Xudong",
    title: "Explaining an experimental figure",
    question:
      "Choose one experimental figure from your own work. Explain it following conclusion-comparison-evidence-boundary, including one trend, anomaly, or uncertainty and a baseline comparison.",
    focus: "Conclusion first, then comparison, evidence, and limits",
    followUp: "How does it compare with the baseline?",
  },
  {
    unitNumber: 4,
    unitTitle: "Explaining figures, methods & experiments",
    instructor: "Wang Xudong",
    title: "Walking through your method",
    question:
      "Explain your method as input-process-output: what goes in, what each stage does, what comes out, and how someone could reproduce it.",
    focus: "Clear pipeline with reproducible details",
    followUp: "Which stage is hardest to reproduce?",
  },
  // Unit 5 — Contributions, result boundaries & responsible claims (Hu Chen)
  {
    unitNumber: 5,
    unitTitle: "Contributions, result boundaries & responsible claims",
    instructor: "Hu Chen",
    title: "Stating contributions without overclaiming",
    question:
      "State your research question, your evidence, and your contribution in one careful paragraph, and name one common overclaiming trap you deliberately avoid.",
    focus: "Precise claim matched to evidence",
    followUp: "Where could your claim be misunderstood?",
  },
  {
    unitNumber: 5,
    unitTitle: "Contributions, result boundaries & responsible claims",
    instructor: "Hu Chen",
    title: "Managing the boundaries of your results",
    question:
      "Explain what your current results can and cannot support. Use hedging, contrast, and probability language to separate 'not yet known', 'cannot be inferred', and 'remains to be validated'.",
    focus: "Hedged, well-bounded statements",
    followUp: "What evidence would strengthen your claim?",
  },
  // Unit 6 — Group-meeting updates & core academic writing (Gao Kun)
  {
    unitNumber: 6,
    unitTitle: "Group-meeting updates & core academic writing",
    instructor: "Gao Kun",
    title: "Two-minute group-meeting update",
    question:
      "Give a two-minute update on your research: your progress since last time, the evidence for it, one obstacle, and your next step.",
    focus: "Progress, evidence, obstacle, next step",
    followUp: "What would unblock your obstacle?",
  },
  {
    unitNumber: 6,
    unitTitle: "Group-meeting updates & core academic writing",
    instructor: "Gao Kun",
    title: "Title and abstract information structure",
    question:
      "Draft a title and abstract for your current work and read them aloud, explaining your information-structure and audience choices; finish with one line from an academic email asking for collaboration.",
    focus: "Audience-aware information order",
    followUp: "What would you cut for a general audience?",
  },
  // Unit 7 — Research statements & conference Q&A (Wang Xudong)
  {
    unitNumber: 7,
    unitTitle: "Research statements & conference Q&A",
    instructor: "Wang Xudong",
    title: "A research statement around one figure",
    question:
      "Deliver a two-minute research statement built around one key figure: the problem, your approach, the main result, and why it matters.",
    focus: "One figure, one story, clear significance",
    followUp: "What is the one sentence you want remembered?",
  },
  {
    unitNumber: 7,
    unitTitle: "Research statements & conference Q&A",
    instructor: "Wang Xudong",
    title: "Handling hard questions",
    question:
      "Answer a hard question about your work: give a direct answer first, bridge to a related strength, clarify the question if needed, and honestly acknowledge what you do not know.",
    focus: "Direct answer, bridging, honest limits",
    followUp: "When should you say 'I don't know'?",
  },
  // Unit 8 — Integrated rehearsal, round table & post-test (Course faculty)
  {
    unitNumber: 8,
    unitTitle: "Integrated rehearsal, round table & post-test",
    instructor: "Course faculty",
    title: "Rehearsal after feedback",
    question:
      "Re-deliver your research statement after feedback: state what feedback you received, what you changed, and perform the improved version.",
    focus: "Feedback to revision to performance",
    followUp: "Which change helped the most?",
  },
  {
    unitNumber: 8,
    unitTitle: "Integrated rehearsal, round table & post-test",
    instructor: "Course faculty",
    title: "Round-table defense",
    question:
      "Present one core claim from your work, respond to a challenge against it, and describe your plan for continuing to use academic English after this course.",
    focus: "Claim, defense, and a forward plan",
    followUp: "What is your next English milestone?",
  },
]);

const structuralGuide = Object.freeze([
  { key: "answer", label: "Answer", prompt: "State your main point in one sentence." },
  { key: "reasons", label: "Reasons", prompt: "Add two reasons or useful details." },
  { key: "example", label: "Example", prompt: "Choose one real moment that makes it concrete." },
  { key: "close", label: "Close", prompt: "Finish with the result, lesson, or recommendation." },
]);

// Lesson-slot index: slot 0 is the two-week launch lesson (2026-09-28 to
// 2026-10-12); every later slot is one week starting Monday. Times before the
// launch clamp to slot 0.
function challengeIndexAt(now = new Date()) {
  const t = Math.max(0, now.getTime());
  if (t < LAUNCH_END_MS) return 0;
  return 1 + Math.floor((t - LAUNCH_END_MS) / WEEK_MS);
}

function challengeForIndex(index) {
  const topicIndex = ((index % LESSON_COUNT) + LESSON_COUNT) % LESSON_COUNT;
  const topic = weeklyTopics[topicIndex];
  const startMs = index === 0 ? COURSE_ANCHOR_MS : COURSE_ANCHOR_MS + (index + 1) * WEEK_MS;
  const endMs = index === 0 ? LAUNCH_END_MS : startMs + WEEK_MS;
  const dateKey = new Date(startMs).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });

  return {
    id: `weekly-${dateKey}`,
    topicIndex,
    lessonNumber: topicIndex + 1,
    unitNumber: topic.unitNumber,
    unitTitle: topic.unitTitle,
    instructor: topic.instructor,
    title: topic.title,
    question: topic.question,
    focus: topic.focus,
    expectedDurationSeconds: 120,
    followUp: topic.followUp,
    startsAt: new Date(startMs).toISOString(),
    endsAt: new Date(endMs).toISOString(),
    structuralGuide,
  };
}

function currentChallenge(now = new Date()) {
  return challengeForIndex(challengeIndexAt(now));
}

function availableChallenges(now = new Date(), limit = 10) {
  const currentIndex = challengeIndexAt(now);
  return Array.from({ length: Math.min(limit, currentIndex + 1) }, (_, offset) =>
    challengeForIndex(currentIndex - offset),
  );
}

function challengeQuestion(challenge) {
  return {
    question: challenge.question,
    focus: challenge.focus,
    expectedDurationSeconds: challenge.expectedDurationSeconds,
    followUp: challenge.followUp,
    challengeId: challenge.id,
    challengeTitle: challenge.title,
    challengeStartsAt: challenge.startsAt,
    challengeEndsAt: challenge.endsAt,
  };
}

function leaderboardForChallenge(records, challenge, viewerOpenId, identities = new Map()) {
  const bestByUser = new Map();

  records.forEach((record) => {
    if (
      record?.question?.challengeId !== challenge.id ||
      record?.evaluation?.status !== "completed" ||
      !Number.isFinite(Number(record?.evaluation?.overallScore))
    ) {
      return;
    }

    const openId = record?.openId || record?.user?.openId;
    if (!openId) return;

    const entry = {
      openId,
      name: record?.user?.name || record?.profile?.name || "DingTalk user",
      score: Math.round(Number(record.evaluation.overallScore)),
      finishedAt: record.finishedAt || "",
      attempts: 1,
    };
    const current = bestByUser.get(openId);
    if (!current) {
      bestByUser.set(openId, entry);
      return;
    }

    current.attempts += 1;
    if (
      entry.score > current.score ||
      (entry.score === current.score && entry.finishedAt < current.finishedAt)
    ) {
      current.score = entry.score;
      current.finishedAt = entry.finishedAt;
      current.name = entry.name;
    }
  });

  const entries = [...bestByUser.values()]
    .sort((left, right) => right.score - left.score || left.finishedAt.localeCompare(right.finishedAt))
    .map((entry, index) => {
      const identity = identities.get(entry.openId);
      return {
        rank: index + 1,
        name:
          identity?.useAlias === true && identity.alias
            ? identity.alias
            : identity?.actualName || entry.name,
        score: entry.score,
        attempts: entry.attempts,
        isViewer: entry.openId === viewerOpenId,
      };
    });

  return {
    entries,
    viewerRank: entries.find((entry) => entry.isViewer)?.rank || null,
    participantCount: entries.length,
  };
}

module.exports = {
  availableChallenges,
  challengeForIndex,
  challengeIndexAt,
  challengeQuestion,
  currentChallenge,
  leaderboardForChallenge,
  structuralGuide,
  weeklyTopics,
};

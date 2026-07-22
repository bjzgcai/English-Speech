const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const CHALLENGE_ANCHOR_MS = Date.parse("2026-07-22T00:00:00+08:00");

const weeklyTopics = Object.freeze([
  {
    title: "A habit that makes your day easier",
    question:
      "What is one small habit that makes your everyday life easier? Explain when you do it, why it helps, and give a recent example.",
    focus: "Clear structure, reasons, and a specific everyday example",
    followUp: "How could someone else start this habit?",
  },
  {
    title: "Planning everyday meals",
    question:
      "How do you usually decide what to eat on a normal day? Describe your routine, what influences your choice, and one meal you often enjoy.",
    focus: "Sequencing, everyday vocabulary, and supporting detail",
    followUp: "What would you change about this routine?",
  },
  {
    title: "A place in your neighborhood",
    question:
      "Tell us about a place in your neighborhood that you visit regularly. Describe it, explain why you go there, and share one memorable visit.",
    focus: "Description, personal relevance, and past-tense narration",
    followUp: "What would make this place even better?",
  },
  {
    title: "Keeping in touch",
    question:
      "How do you stay in touch with people who matter to you? Explain your usual approach and describe a recent conversation you valued.",
    focus: "Comparison, personal reflection, and a concrete example",
    followUp: "Has technology improved the way you communicate?",
  },
  {
    title: "A useful recent purchase",
    question:
      "Describe something you bought recently that is useful in daily life. Explain why you chose it, how you use it, and whether it met your expectations.",
    focus: "Description, reasons, and evaluation language",
    followUp: "Would you recommend it to someone else?",
  },
  {
    title: "Managing a busy morning",
    question:
      "What helps you manage a busy morning? Walk through your routine, identify the hardest part, and explain one strategy that saves time.",
    focus: "Logical sequence, problem solving, and practical detail",
    followUp: "What usually disrupts your morning plan?",
  },
  {
    title: "A simple way to stay healthy",
    question:
      "What is one realistic thing you do to stay healthy? Explain how it fits into your life, what makes it difficult, and what keeps you consistent.",
    focus: "Cause and effect, balanced reflection, and routine vocabulary",
    followUp: "What advice would you give a beginner?",
  },
  {
    title: "Sharing household chores",
    question:
      "How are everyday chores handled where you live? Describe the usual arrangement, one chore you prefer or avoid, and how you keep things fair.",
    focus: "Explanation, preferences, and everyday household vocabulary",
    followUp: "Which chore would you automate if you could?",
  },
  {
    title: "Your regular journey",
    question:
      "Describe a journey you make regularly, such as going to work, school, or the shops. Explain the route, what you notice, and how the trip could improve.",
    focus: "Sequencing, place vocabulary, and suggestions",
    followUp: "How is the journey different at busy times?",
  },
  {
    title: "Relaxing after a full day",
    question:
      "How do you relax after a busy day? Describe what you usually do, why it works for you, and a time when it helped you reset.",
    focus: "Routine language, reasons, and personal reflection",
    followUp: "Do you prefer relaxing alone or with other people?",
  },
]);

const structuralGuide = Object.freeze([
  { key: "answer", label: "Answer", prompt: "State your main point in one sentence." },
  { key: "reasons", label: "Reasons", prompt: "Add two reasons or useful details." },
  { key: "example", label: "Example", prompt: "Choose one real moment that makes it concrete." },
  { key: "close", label: "Close", prompt: "Finish with the result, lesson, or recommendation." },
]);

const launchWeekPrizeDraft = Object.freeze({
  eyebrow: "Week 1 prize drop",
  title: "Top three unlock the prize draft",
  imagePath: "/assets/week-one-prize-drop.png",
  rewards: Object.freeze([
    "Vinda tissue pack",
    "Vaseline hand cream",
    "Anti-fog wipes",
  ]),
  rule:
    "After the Week 1 standings close, first place chooses first, second place chooses from the two remaining prizes, and third place receives the final prize.",
});

function challengeIndexAt(now = new Date()) {
  return Math.max(0, Math.floor((now.getTime() - CHALLENGE_ANCHOR_MS) / WEEK_MS));
}

function challengeForIndex(index) {
  const startMs = CHALLENGE_ANCHOR_MS + index * WEEK_MS;
  const endMs = startMs + WEEK_MS;
  const topicIndex = ((index % weeklyTopics.length) + weeklyTopics.length) % weeklyTopics.length;
  const topic = weeklyTopics[topicIndex];
  const dateKey = new Date(startMs).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });

  return {
    id: `weekly-${dateKey}`,
    topicIndex,
    title: topic.title,
    question: topic.question,
    focus: topic.focus,
    expectedDurationSeconds: 120,
    followUp: topic.followUp,
    startsAt: new Date(startMs).toISOString(),
    endsAt: new Date(endMs).toISOString(),
    structuralGuide,
    prizeDraft: index === 0 ? launchWeekPrizeDraft : null,
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
  launchWeekPrizeDraft,
  structuralGuide,
  weeklyTopics,
};

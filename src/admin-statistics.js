const DAY_MS = 24 * 60 * 60 * 1000;
const SHANGHAI_TIME_ZONE = "Asia/Shanghai";

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function recordOpenId(record) {
  return text(record?.openId || record?.user?.openId);
}

function challengeId(record) {
  return text(record?.question?.challengeId);
}

function validScore(record) {
  const score = Number(record?.evaluation?.overallScore);
  return record?.evaluation?.status === "completed" && Number.isFinite(score)
    ? score
    : null;
}

function uniqueOpenIds(records) {
  return new Set(records.map(recordOpenId).filter(Boolean));
}

function percentage(numerator, denominator) {
  return denominator ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

function roundedAverage(values) {
  if (!values.length) return null;
  return Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 10) / 10;
}

function bestScoresByParticipant(records) {
  const bestScores = new Map();
  records.forEach((record) => {
    const openId = recordOpenId(record);
    const score = validScore(record);
    if (!openId || score === null) return;
    bestScores.set(openId, Math.max(score, bestScores.get(openId) ?? Number.NEGATIVE_INFINITY));
  });
  return bestScores;
}

function dateKeyInTimeZone(value, timeZone = SHANGHAI_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function recentDateKeys(now, count) {
  const todayKey = dateKeyInTimeZone(now);
  const [year, month, day] = todayKey.split("-").map(Number);
  const calendarDate = Date.UTC(year, month - 1, day);
  return Array.from({ length: count }, (_, index) =>
    new Date(calendarDate - (count - index - 1) * DAY_MS).toISOString().slice(0, 10),
  );
}

function recordTimestamp(record, preferredField) {
  return text(record?.[preferredField] || record?.finishedAt || record?.createdAt);
}

function buildDailyActivity(gameQuestions, gameRecords, now) {
  const days = new Map(
    recentDateKeys(now, 14).map((date) => [
      date,
      { date, questionsGenerated: 0, attemptsSubmitted: 0, activeParticipants: 0 },
    ]),
  );
  const activeIdsByDay = new Map([...days.keys()].map((date) => [date, new Set()]));

  gameQuestions.forEach((record) => {
    const date = dateKeyInTimeZone(recordTimestamp(record, "createdAt"));
    if (!days.has(date)) return;
    days.get(date).questionsGenerated += 1;
    const openId = recordOpenId(record);
    if (openId) activeIdsByDay.get(date).add(openId);
  });

  gameRecords.forEach((record) => {
    const date = dateKeyInTimeZone(recordTimestamp(record, "finishedAt"));
    if (!days.has(date)) return;
    days.get(date).attemptsSubmitted += 1;
    const openId = recordOpenId(record);
    if (openId) activeIdsByDay.get(date).add(openId);
  });

  return [...days.values()].map((day) => ({
    ...day,
    activeParticipants: activeIdsByDay.get(day.date).size,
  }));
}

function buildWeeklyBreakdown(gameQuestions, gameRecords) {
  const groups = new Map();
  const ensureGroup = (record) => {
    const id = challengeId(record);
    if (!id) return null;
    if (!groups.has(id)) {
      groups.set(id, {
        challengeId: id,
        title: text(record?.question?.challengeTitle) || "Weekly challenge",
        startsAt: text(record?.question?.challengeStartsAt),
        endsAt: text(record?.question?.challengeEndsAt),
        questions: [],
        records: [],
      });
    }
    const group = groups.get(id);
    group.title = text(record?.question?.challengeTitle) || group.title;
    group.startsAt = text(record?.question?.challengeStartsAt) || group.startsAt;
    group.endsAt = text(record?.question?.challengeEndsAt) || group.endsAt;
    return group;
  };

  gameQuestions.forEach((record) => ensureGroup(record)?.questions.push(record));
  gameRecords.forEach((record) => ensureGroup(record)?.records.push(record));

  return [...groups.values()]
    .map((group) => {
      const completed = group.records.filter((record) => validScore(record) !== null);
      const bestScores = [...bestScoresByParticipant(completed).values()];
      return {
        challengeId: group.challengeId,
        title: group.title,
        startsAt: group.startsAt,
        endsAt: group.endsAt,
        entrants: uniqueOpenIds([...group.questions, ...group.records]).size,
        submitters: uniqueOpenIds(group.records).size,
        scoredParticipants: uniqueOpenIds(completed).size,
        attempts: group.records.length,
        completedAttempts: completed.length,
        completionRate: percentage(completed.length, group.records.length),
        averageBestScore: roundedAverage(bestScores),
      };
    })
    .sort(
      (left, right) =>
        right.startsAt.localeCompare(left.startsAt) ||
        right.challengeId.localeCompare(left.challengeId),
    );
}

function buildScoreBands(scores) {
  const bands = [
    { key: "exceptional", label: "90-100", minimum: 90, maximum: 100, count: 0 },
    { key: "strong", label: "80-89", minimum: 80, maximum: 89.999, count: 0 },
    { key: "competent", label: "70-79", minimum: 70, maximum: 79.999, count: 0 },
    { key: "developing", label: "60-69", minimum: 60, maximum: 69.999, count: 0 },
    { key: "needsImprovement", label: "0-59", minimum: 0, maximum: 59.999, count: 0 },
  ];
  scores.forEach((score) => {
    const band = bands.find((item) => score >= item.minimum && score <= item.maximum);
    if (band) band.count += 1;
  });
  return bands.map(({ minimum, maximum, ...band }) => band);
}

function buildAdminStatistics({
  questions = [],
  recordings = [],
  currentChallenge,
  now = new Date(),
} = {}) {
  const currentChallengeId = text(currentChallenge?.id);
  const gameQuestions = questions.filter((record) => challengeId(record));
  const gameRecords = recordings.filter((record) => challengeId(record));
  const currentQuestions = gameQuestions.filter(
    (record) => challengeId(record) === currentChallengeId,
  );
  const currentRecords = gameRecords.filter(
    (record) => challengeId(record) === currentChallengeId,
  );
  const currentCompleted = currentRecords.filter((record) => validScore(record) !== null);
  const currentBestScores = [...bestScoresByParticipant(currentCompleted).values()];
  const entrantIds = uniqueOpenIds([...gameQuestions, ...gameRecords]);
  const submitterIds = uniqueOpenIds(gameRecords);
  const participantWeeks = new Map();

  gameRecords.forEach((record) => {
    const openId = recordOpenId(record);
    const id = challengeId(record);
    if (!openId || !id) return;
    if (!participantWeeks.has(openId)) participantWeeks.set(openId, new Set());
    participantWeeks.get(openId).add(id);
  });

  const completedAttempts = gameRecords.filter(
    (record) => record?.evaluation?.status === "completed",
  ).length;
  const failedAttempts = gameRecords.filter(
    (record) => record?.evaluation?.status === "failed",
  ).length;
  const skippedAttempts = gameRecords.filter(
    (record) => record?.evaluation?.status === "skipped",
  ).length;
  const totalBytes = recordings.reduce((total, record) => {
    const bytes = Number(record?.bytes);
    return total + (Number.isFinite(bytes) && bytes > 0 ? bytes : 0);
  }, 0);
  const storedMediaFiles = recordings.filter((record) => {
    const bytes = Number(record?.bytes);
    return Number.isFinite(bytes) && bytes > 0;
  }).length;

  return {
    generatedAt: now.toISOString(),
    timeZone: SHANGHAI_TIME_ZONE,
    currentChallenge: {
      id: currentChallengeId,
      title: text(currentChallenge?.title) || "Current weekly challenge",
      startsAt: text(currentChallenge?.startsAt),
      endsAt: text(currentChallenge?.endsAt),
    },
    overview: {
      allTimeEntrants: entrantIds.size,
      allTimeSubmitters: submitterIds.size,
      currentWeekEntrants: uniqueOpenIds([...currentQuestions, ...currentRecords]).size,
      currentWeekSubmitters: uniqueOpenIds(currentRecords).size,
      currentWeekScoredParticipants: uniqueOpenIds(currentCompleted).size,
      currentWeekAttempts: currentRecords.length,
      currentWeekAverageBestScore: roundedAverage(currentBestScores),
      totalGameAttempts: gameRecords.length,
      completedGameAttempts: completedAttempts,
      gameCompletionRate: percentage(completedAttempts, gameRecords.length),
      repeatParticipants: [...participantWeeks.values()].filter((weeks) => weeks.size >= 2).length,
      entrantsWithoutSubmission: [...entrantIds].filter((openId) => !submitterIds.has(openId)).length,
      storedMediaFiles,
      totalStoredBytes: totalBytes,
    },
    attemptStatus: {
      completed: completedAttempts,
      failed: failedAttempts,
      skipped: skippedAttempts,
      other: Math.max(0, gameRecords.length - completedAttempts - failedAttempts - skippedAttempts),
    },
    currentWeekScoreBands: buildScoreBands(currentBestScores),
    dailyActivity: buildDailyActivity(gameQuestions, gameRecords, now),
    weeklyBreakdown: buildWeeklyBreakdown(gameQuestions, gameRecords),
  };
}

module.exports = {
  buildAdminStatistics,
  dateKeyInTimeZone,
};

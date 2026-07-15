const crypto = require("crypto");

const MOCK_USER_COUNT = 28;

const feedback = Object.freeze({
  pronunciation: "Speech was clear overall, with a few sounds that could be articulated more precisely.",
  fluency: "The answer maintained a steady pace, with occasional pauses while organizing ideas.",
  grammar: "Sentence structures were mostly accurate, with minor errors that did not obscure meaning.",
  vocabulary: "Word choice was appropriate and sufficiently varied for the task.",
  coherence: "The response stayed relevant and connected its main ideas in a logical order.",
  visualDelivery: "Camera framing and posture supported a professional, engaged delivery.",
});

function deterministicUuid(seed) {
  const value = crypto.createHash("sha256").update(seed).digest("hex").slice(0, 32);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20)}`;
}

function buildMockPartnerUsers(evaluationRubricStandard) {
  return Array.from({ length: MOCK_USER_COUNT }, (_, index) => {
    const number = index + 1;
    const suffix = String(number).padStart(2, "0");
    const jobNumber = `MOCK${String(number).padStart(4, "0")}`;
    const name = `Mock User ${suffix}`;
    const scoreBase = 68 + ((index * 7) % 21);
    const rubric = Object.fromEntries(
      evaluationRubricStandard.dimensions.map((dimension, dimensionIndex) => [
        dimension.key,
        {
          label: dimension.label,
          weight: dimension.weight,
          score: Math.min(96, scoreBase + ((dimensionIndex * 3 + index) % 9) - 4),
          feedback: feedback[dimension.key],
        },
      ]),
    );
    const overallScore = Math.round(
      evaluationRubricStandard.dimensions.reduce(
        (total, dimension) => total + (rubric[dimension.key].score * dimension.weight) / 100,
        0,
      ),
    );
    const finishedAt = new Date(Date.UTC(2026, 5, 30 - (index % 20), 2 + (index % 8), 15)).toISOString();
    const startedAt = new Date(new Date(finishedAt).getTime() - 2 * 60 * 1000).toISOString();
    const seed = `synthetic-${jobNumber}`;

    return {
      openId: `mock_open_${jobNumber}`,
      unionId: `mock_union_${jobNumber}`,
      userId: `mock_user_${jobNumber}`,
      jobNumber,
      name,
      email: `mock.user.${suffix}@example.com`,
      orgEmail: "",
      latestEvaluationAt: finishedAt,
      evaluations: [
        {
          id: deterministicUuid(`mock-evaluation-${seed}`),
          questionId: deterministicUuid(`mock-question-${seed}`),
          startedAt,
          finishedAt,
          profile: { name, role: "Student" },
          question: {
            question: "Describe a technical project you worked on and explain one difficult decision you made.",
            focus: "Clear structure, technical vocabulary, and reflection on decision-making",
            expectedDurationSeconds: 120,
            followUp: "What would you do differently if you started the project again?",
          },
          evaluation: {
            status: "completed",
            rubricId: evaluationRubricStandard.id,
            rubricVersion: evaluationRubricStandard.version,
            reason: "",
            overallScore,
            summary: "A clear, relevant response with practical examples and some room for greater precision.",
            rubric,
            strengths: ["Relevant supporting example", "Logical answer structure"],
            improvements: ["Use more precise technical vocabulary", "Reduce hesitation between key points"],
          },
        },
      ],
    };
  });
}

module.exports = { buildMockPartnerUsers, MOCK_USER_COUNT };

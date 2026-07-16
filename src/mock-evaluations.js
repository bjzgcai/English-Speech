const crypto = require("crypto");

const mockRoster = Object.freeze([
  { name: "宋尚文", jobNumber: "251202006" },
  { name: "孙海然", jobNumber: "252303024" },
  { name: "吴彬", jobNumber: "252702023" },
  { name: "武震卿", jobNumber: "240806010" },
  { name: "曾辉", jobNumber: "253104047" },
  { name: "王蕴杰", jobNumber: "250402002" },
  { name: "庄禹", jobNumber: "252306045" },
  { name: "徐鹏鑫", jobNumber: "250806017" },
  { name: "杨茂林", jobNumber: "251705012" },
  { name: "张永伟", jobNumber: "250303040" },
  { name: "田钦中", jobNumber: "252901006" },
  { name: "许安杰", jobNumber: "240102011" },
  { name: "张禧阳", jobNumber: "240806011" },
  { name: "张益宁", jobNumber: "242303034" },
  { name: "黄勋", jobNumber: "241705014" },
  { name: "连仕杰", jobNumber: "241906054" },
  { name: "沈思成", jobNumber: "242303043" },
  { name: "曾翊晨", jobNumber: "241805016" },
  { name: "罗佳聪", jobNumber: "250105002" },
  { name: "袁良卿", jobNumber: "251903005" },
  { name: "黄相衡", jobNumber: "250302032" },
  { name: "梁浩哲", jobNumber: "252303029" },
  { name: "荚左龙", jobNumber: "250404012" },
  { name: "孙崇景", jobNumber: "252705030" },
  { name: "郭医铭", jobNumber: "252303027" },
  { name: "李锐", jobNumber: "250301033" },
  { name: "涂沛妍", jobNumber: "241506051" },
  { name: "闫沐西", jobNumber: "242205036" },
]);

const MOCK_USER_COUNT = mockRoster.length;

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
  return mockRoster.map(({ name, jobNumber }, index) => {
    const number = index + 1;
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
      email: "",
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

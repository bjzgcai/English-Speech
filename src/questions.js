const crypto = require("crypto");
const { questionsMetadataFile } = require("./config");
const { appendJsonLine, readJsonLines } = require("./storage");

function createQuestionService({ safeText, recordOpenId }) {
  function buildPrompt(profile) {
    const name = safeText(profile.name, "Biao");
    const role = safeText(profile.role, "AI engeering");
    return [
      "Create one English speaking assessment question based on this candidate profile.",
      "Return strict JSON only with keys: question, focus, expectedDurationSeconds, followUp.",
      "The question should be specific, realistic, and answerable without outside research.",
      "Avoid asking multiple unrelated questions.",
      "The answer must fit within 2 minutes. Set expectedDurationSeconds to 120.",
      "",
      `Name: ${name}`,
      `Role/background: ${role}`,
      "Target answer duration: 2 minutes",
    ].join("\n");
  }

  function fallbackQuestion(profile) {
    const role = safeText(profile.role, "AI engeering");
    return {
      question: `Tell me about a recent challenge in ${role}. What happened, what did you do, and what was the result?`,
      focus: "Fluency, organization, detail, and past-tense narration",
      expectedDurationSeconds: 120,
      followUp: "What would you do differently next time?",
    };
  }

  function persistQuestion(user, profile, question, model) {
    const record = {
      id: crypto.randomUUID(), openId: user.openId, userId: user.userId,
      jobNumber: user.jobNumber, email: user.email, orgEmail: user.orgEmail,
      user, createdAt: new Date().toISOString(), profile, question, model,
    };
    appendJsonLine(questionsMetadataFile, record);
    return record;
  }

  const questionForClient = (record) => ({ id: record.id, ...record.question });
  const findOwnedQuestion = (questionId, openId) =>
    readJsonLines(questionsMetadataFile).find(
      (record) => record.id === questionId && recordOpenId(record) === openId,
    );

  return { buildPrompt, fallbackQuestion, persistQuestion, questionForClient, findOwnedQuestion };
}

module.exports = { createQuestionService };

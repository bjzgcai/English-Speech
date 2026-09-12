const crypto = require("crypto");
const { questionsMetadataFile } = require("./config");
const { appendJsonLine, readJsonLines } = require("./storage");

function createQuestionService({ safeText, recordOpenId }) {
  function buildPrompt(profile) {
    const name = safeText(profile.name, "Biao");
    const role = safeText(profile.role, "AI engeering");
    return [
      "Create one concise English speaking assessment question from this candidate profile.",
      "Return strict JSON only with keys: question, focus, expectedDurationSeconds, followUp.",
      "Use one clear sentence of 20 words or fewer; keep it specific and realistic, with no outside research.",
      "Keep followUp to 10 words or fewer and focus to 8 words or fewer.",
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
      question: `What recent challenge did you face in ${role}, and what did you do and learn?`,
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

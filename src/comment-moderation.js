const fs = require("node:fs");
const path = require("node:path");
const config = require("./config");
const processing = require("./processing");
const { readJsonLines, updateJsonLines, appendJsonLine } = require("./storage");

function claimJob() {
  let claimed;
  updateJsonLines(config.commentsModerationFile, rows => {
    const job = rows.find(row => row.state === "queued" || (row.state === "retry" && (!row.retryAt || row.retryAt <= Date.now())));
    if (!job) return rows;
    claimed = { ...job, state: "processing", attempts: (job.attempts || 0) + 1 };
    return rows.map(row => row.id === job.id ? claimed : row);
  });
  return claimed;
}

async function processOne() {
  const job = claimJob();
  if (!job) return false;
  const latest = new Map(); for (const row of readJsonLines(config.commentsMetadataFile)) latest.set(row.id, row);
  const comment = latest.get(job.commentId);
  if (!comment) return true;
  try {
    const content = [{ type: "text", text: comment.content }];
    for (const image of comment.images || []) {
      const file = path.join(config.commentsMediaDir, image.filename);
      if (fs.existsSync(file)) content.push({ type: "image_url", image_url: { url: `data:image/webp;base64,${fs.readFileSync(file).toString("base64")}` } });
    }
    const url = process.env.INTERNAL_LLM_CHAT_COMPLETIONS_URL || "https://llm.zgci.org/hub/v1/chat/completions";
    const response = await processing.modelFetch(url, { method: "POST", headers: { Authorization: `Bearer ${process.env.INTERNAL_LLM_API_KEY || ""}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.INTERNAL_LLM_MODERATION_MODEL || "glm", max_tokens: 1024, response_format: { type: "json_object" }, messages: [{ role: "system", content: 'Return JSON only: {"blocked":true|false}. Block violence, threats, hate, self-harm encouragement, sexual abuse, harmful instructions, and disallowed visual content.' }, { role: "user", content }] }) }, "question");
    const body = await response.json(); const verdict = JSON.parse((body?.choices?.[0]?.message?.content || "{}").match(/\{[\s\S]*\}/)?.[0] || "{}");
    if (verdict.blocked === true) appendJsonLine(config.commentsMetadataFile, { ...comment, moderationStatus: "blocked", blockedAt: new Date().toISOString() });
    updateJsonLines(config.commentsModerationFile, rows => rows.map(row => row.id === job.id ? { ...row, state: "completed", verdict: Boolean(verdict.blocked), completedAt: new Date().toISOString() } : row));
  } catch (error) {
    updateJsonLines(config.commentsModerationFile, rows => rows.map(row => row.id === job.id ? { ...row, state: "retry", retryAt: Date.now() + Math.min(300000, 1000 * 2 ** Math.min(row.attempts || 1, 8)), error: error.message.slice(0, 200) } : row));
  }
  return true;
}

module.exports = { processOne };

// One-off salvage: re-enqueue uploads that landed in recordings/pending but
// never created a queue job because of the EXDEV figure-store bug (2026-10-08).
// Attribution was reconstructed from nginx access logs (IP + timing) against
// the generated-question records; identical retries are deduplicated by md5.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DRY_RUN = process.env.SALVAGE_DRY_RUN !== "false";

// submission id prefix -> owner (openId) + their generated question record id.
// Both question records were persisted before the uploads failed.
const OWNER_YANG = "gWu4CYuc5ASVQiPvkYmeFyQiEiE"; // 杨明政
const OWNER_DUAN = "HevYv9mMiPvKfRgiiYoO2tSAiEiE"; // 段永康
const PLAN = [
  { submissionId: "5ec9d34d-d2e5-4dd8-ae13-d940e601002a", owner: OWNER_YANG, questionId: "374cb496-5cfb-4d46-b1c4-af2322facba3" },
  { submissionId: "4c2eb350-3785-48d3-a76c-3e46492197e6", owner: OWNER_YANG, questionId: "374cb496-5cfb-4d46-b1c4-af2322facba3" },
  { submissionId: "acadd84e-beab-45d2-9f41-fcc6cfa92bb1", owner: OWNER_YANG, questionId: "374cb496-5cfb-4d46-b1c4-af2322facba3" },
  { submissionId: "7df9e0b8-6de8-4256-a062-c2734d690814", owner: OWNER_DUAN, questionId: "4378a6d6-e4a5-4f30-86ce-4829fd8e06b6" },
  { submissionId: "2c95d5e1-91ae-4e68-bad4-b3262f886057", owner: OWNER_DUAN, questionId: "4378a6d6-e4a5-4f30-86ce-4829fd8e06b6" },
];

const config = require(path.join(process.cwd(), "src", "config"));
const { Queue } = require(path.join(process.cwd(), "src", "queue"));

function main() {
  const questions = fs
    .readFileSync(config.questionsMetadataFile, "utf8")
    .split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const pendingDir = path.join(config.recordingsDir, "pending");
  const queue = new Queue(config.queueFile);
  let enqueued = 0;

  try {
    for (const item of PLAN) {
      const questionRecord = questions.find((r) => r.id === item.questionId && r.openId === item.owner);
      if (!questionRecord) { console.error(`SKIP ${item.submissionId}: question ${item.questionId} not found for owner`); continue; }

      const candidates = fs.readdirSync(pendingDir)
        .filter((name) => name.startsWith(item.submissionId));
      if (!candidates.length) { console.error(`SKIP ${item.submissionId}: no pending file`); continue; }
      const newest = candidates.map((name) => {
        const stat = fs.statSync(path.join(pendingDir, name));
        return { name, path: path.join(pendingDir, name), mtimeMs: stat.mtimeMs, size: stat.size };
      }).sort((a, b) => b.mtimeMs - a.mtimeMs)[0];

      if (queue.get("SELECT id FROM jobs WHERE id=?", item.submissionId)) {
        console.error(`SKIP ${item.submissionId}: job already exists`); continue;
      }
      if (fs.readFileSync(config.metadataFile, "utf8").includes(item.submissionId)) {
        console.error(`SKIP ${item.submissionId}: already in history metadata`); continue;
      }

      const finishedAt = new Date(newest.mtimeMs).toISOString();
      const filename = `${finishedAt.replace(/[:.]/g, "-")}-${item.submissionId}.mp4`;
      const user = questionRecord.user;
      const record = {
        id: item.submissionId, submissionId: item.submissionId, hasVideo: true, filename,
        mimeType: "video/mp4", originalMimeType: "video/webm", convertedToMp4: true,
        startedAt: finishedAt, finishedAt,
        openId: user.openId, userId: user.userId, jobNumber: user.jobNumber,
        email: user.email, orgEmail: user.orgEmail, user,
        profile: questionRecord.profile,
        questionId: questionRecord.id,
        publiclyShared: false,
        question: questionRecord.question,
        salvagedFrom: `EXDEV outage 2026-10-08; retries=${candidates.length}`,
      };
      const payload = { record, inputPath: newest.path, mode: "question-answer" };

      if (DRY_RUN) {
        console.log(`DRY ${item.submissionId} -> ${user.name} (${item.owner.slice(0, 8)}), file=${newest.name} (${(newest.size / 1048576).toFixed(1)} MB, ${candidates.length} copies)`);
        continue;
      }
      const admission = `salvage-${crypto.randomUUID()}`;
      queue.run(
        "INSERT INTO jobs(id,owner,admission,state,created,updated,payload) VALUES(?,?,?,'queued',?,?,?)",
        item.submissionId, item.owner, admission, Date.now(), Date.now(), JSON.stringify(payload),
      );
      queue.run("INSERT INTO telemetry(job,stage,created,data) VALUES(?,'salvage',?,?)",
        item.submissionId, Date.now(), JSON.stringify({ retries: candidates.length, questionId: questionRecord.id }));
      console.log(`ENQUEUED ${item.submissionId} -> ${user.name}, file=${newest.name} (${(newest.size / 1048576).toFixed(1)} MB)`);
      enqueued += 1;
    }
    console.log(DRY_RUN ? `dry run complete: ${PLAN.length} planned` : `enqueued ${enqueued}/${PLAN.length}`);
  } finally {
    queue.close();
  }
}

main();

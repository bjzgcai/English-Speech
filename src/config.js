const fs = require("fs");
const path = require("path");

function loadEnvironment() {
  require("dotenv").config();
  if (process.env.NODE_ENV !== "production") {
    require("dotenv").config({ path: ".env.local", override: true });
  }
}

loadEnvironment();

const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const recordingsDir = path.join(rootDir, "recordings");
const artifactsDir = path.join(recordingsDir, "artifacts");
const metadataFile = path.join(recordingsDir, "metadata.jsonl");
const questionsDir = path.join(rootDir, "questions");
const questionsMetadataFile = path.join(questionsDir, "metadata.jsonl");
const commentsDir = path.join(rootDir, "comments");
const commentsMetadataFile = path.join(commentsDir, "metadata.jsonl");

for (const directory of [recordingsDir, artifactsDir, questionsDir, commentsDir]) {
  fs.mkdirSync(directory, { recursive: true });
}

module.exports = {
  port: Number(process.env.PORT || 3000),
  rootDir,
  publicDir,
  recordingsDir,
  artifactsDir,
  metadataFile,
  questionsMetadataFile,
  commentsMetadataFile,
  openApiFile: path.join(rootDir, "openapi.yaml"),
  mockUsersFile: path.join(rootDir, "not-empty-user.json"),
};

const fs = require("fs");
const path = require("path");

function loadEnvironment() {
  if (process.env.NODE_ENV === "test") return;

  require("dotenv").config({ quiet: true });
  if (process.env.NODE_ENV !== "production") {
    require("dotenv").config({ path: ".env.local", override: true, quiet: true });
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
const consentsDir = path.join(rootDir, "consents");
const consentsMetadataFile = path.join(consentsDir, "metadata.jsonl");

for (const directory of [recordingsDir, artifactsDir, questionsDir, commentsDir, consentsDir]) {
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
  consentsMetadataFile,
  openApiFile: path.join(rootDir, "openapi.yaml"),
};

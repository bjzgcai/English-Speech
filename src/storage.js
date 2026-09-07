const fs = require("fs");
const cache = new Map();

function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const stat = fs.statSync(filePath);
  const key = `${stat.mtimeMs}:${stat.size}:${stat.ino}`;
  if (cache.get(filePath)?.key === key) return structuredClone(cache.get(filePath).records);

  const records = fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  cache.set(filePath, { key, records });
  return structuredClone(records);
}

function writeJsonLines(filePath, records) {
  const temporaryFile = `${filePath}.${process.pid}.tmp`;
  const contents = records.length
    ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n`
    : "";
  fs.writeFileSync(temporaryFile, contents, { mode: 0o600 });
  const descriptor = fs.openSync(temporaryFile, "r");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  fs.renameSync(temporaryFile, filePath);
  const directory = fs.openSync(require("node:path").dirname(filePath), "r");
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  cache.delete(filePath);
}

function appendJsonLine(filePath, record) {
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  const descriptor = fs.openSync(filePath, "r");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  cache.delete(filePath);
}

module.exports = { appendJsonLine, readJsonLines, writeJsonLines };

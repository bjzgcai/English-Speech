const fs = require("fs");

function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];

  return fs
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
}

function writeJsonLines(filePath, records) {
  const temporaryFile = `${filePath}.${process.pid}.tmp`;
  const contents = records.length
    ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n`
    : "";
  fs.writeFileSync(temporaryFile, contents, { mode: 0o600 });
  fs.renameSync(temporaryFile, filePath);
}

function appendJsonLine(filePath, record) {
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

module.exports = { appendJsonLine, readJsonLines, writeJsonLines };

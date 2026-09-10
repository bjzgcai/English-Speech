const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { readJsonLines, withFileLock, writeJsonLines } = require("../src/storage");

const storageModule = require.resolve("../src/storage");
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Returns a JSONL path inside a temporary directory that is removed afterwards.
function temporaryFile(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-storage-lock-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, "metadata.jsonl");
}

test("a rewrite cannot drop an append made by another process", async (context) => {
  const file = temporaryFile(context);
  const marker = `${file}.child-ready`;
  writeJsonLines(file, [{ id: "before" }]);

  const script = `
    const fs = require("node:fs");
    const { appendJsonLine } = require(${JSON.stringify(storageModule)});
    fs.writeFileSync(process.argv[1], "ready");
    appendJsonLine(process.argv[2], { id: "concurrent" });
  `;

  let child;
  withFileLock(file, () => {
    const records = readJsonLines(file);
    child = spawn(process.execPath, ["-e", script, marker, file], { stdio: "ignore" });
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(marker) && Date.now() < deadline) sleepSync(10);
    assert.equal(fs.existsSync(marker), true, "the child process never attempted its append");
    // Give the child time to reach the lock that this process still holds.
    sleepSync(200);
    // The re-entrant write must stay inside the same critical section.
    writeJsonLines(file, [...records, { id: "rewritten" }]);
  });

  await new Promise((resolve) => child.once("exit", resolve));

  // The ordering proves the child was blocked until this process released the
  // lock, so the rewrite could not overwrite the appended record.
  assert.deepEqual(readJsonLines(file).map((record) => record.id), ["before", "rewritten", "concurrent"]);
  assert.equal(fs.existsSync(`${file}.lock`), false);
});

test("a stale lock left by a crashed writer is reclaimed", (context) => {
  const file = temporaryFile(context);
  writeJsonLines(file, [{ id: "first" }]);

  fs.writeFileSync(`${file}.lock`, "");
  const stale = new Date(Date.now() - 120000);
  fs.utimesSync(`${file}.lock`, stale, stale);

  assert.deepEqual(withFileLock(file, () => readJsonLines(file).map((record) => record.id)), ["first"]);
  assert.equal(fs.existsSync(`${file}.lock`), false);
});

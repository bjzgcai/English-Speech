const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
test("concurrent processes can initialize the same new WAL queue", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-startup-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "queue.sqlite");
  const source = 'const {Queue}=require(process.argv[1]);const q=new Queue(process.argv[2],{health:()=>null});q.enter(process.argv[3]);q.close();';
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => new Promise(resolve => {
    const child = spawn(process.execPath, ["-e", source, path.join(__dirname, "../src/queue"), file, String(i)]);
    let output = ""; child.stderr.on("data", data => { output += data; });
    child.on("exit", code => resolve({ code, output }));
  })));
  for (const result of results) assert.equal(result.code, 0, result.output);
});

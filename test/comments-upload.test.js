const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { listenForTest } = require("../scripts/test-http");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "comment-upload-"));
Object.assign(process.env, { NODE_ENV: "test", DATA_DIR: dataDir, QUEUE_ENABLED: "false", SESSION_SECRET: "test-comments" });
const { app, testHelpers } = require("../src/app");
const config = require("../src/config");
const processing = require("../src/processing");
const { readJsonLines } = require("../src/storage");
let server, base;
test.before(async () => { server = await listenForTest(app); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(dataDir, { recursive: true, force: true }); });

async function post(files, extra = {}) {
  const body = new FormData();
  body.append("page", "prepare"); body.append("content", "Hello\u0000 世界");
  for (const file of files) body.append("images", new Blob([file], { type: "image/png" }), "avatar.png");
  for (const [key, value] of Object.entries(extra)) body.append(key, value);
  return fetch(base + "/api/comments", { method: "POST", body, headers: {
    Cookie: `englisheval_session=${testHelpers.createSessionToken({ openId: "upload-owner", name: "Upload test" })}`,
    "X-Expected-Owner": "upload-owner",
  } });
}

test("a directory at the moderation file returns JSON without saving a partial comment", async () => {
  fs.mkdirSync(config.commentsModerationFile);
  try {
    const response = await post([Buffer.from("invalid")]);
    assert.equal(response.status, 503);
    assert.match(response.headers.get("content-type"), /application\/json/);
    assert.match((await response.json()).error, /temporarily unavailable/);
    assert.equal(readJsonLines(config.commentsMetadataFile).length, 0);
    assert.deepEqual(fs.readdirSync(config.commentsMediaDir), []);
  } finally { fs.rmdirSync(config.commentsModerationFile); }
});

test("multipart comments save two normalized images and a durable moderation job", async t => {
  t.mock.method(processing, "modelFetch", async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"blocked":false}' } }] })));
  const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: "red" } }).png().toBuffer();
  const response = await post([png, png]);
  assert.equal(response.status, 201);
  const { comment } = await response.json();
  assert.equal(comment.content, "Hello 世界");
  assert.equal(comment.images.length, 2);
  for (const image of comment.images) {
    const media = await fetch(base + image.url);
    assert.equal(media.status, 200);
    assert.equal(media.headers.get("x-content-type-options"), "nosniff");
    const metadata = await sharp(Buffer.from(await media.arrayBuffer())).metadata();
    assert.equal(metadata.format, "webp");
  }
  assert.equal(readJsonLines(config.commentsModerationFile).length, 1);
});

test("invalid image bytes return a JSON validation error", async () => {
  const response = await post([Buffer.from("<html>not an image</html>")]);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /valid supported image/);
});

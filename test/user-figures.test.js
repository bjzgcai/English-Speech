const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const userFigures = require("../src/user-figures");

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function fakeFigure(dir) {
  const source = path.join(dir, "upload-inbox.png");
  fs.writeFileSync(source, PNG_BYTES, { mode: 0o600 });
  return { path: source, mimetype: "image/png", size: PNG_BYTES.length, originalname: "figure.png" };
}

test("storeUserFigure keeps the uploaded figure as <answer id>.png", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-figures-"));
  const figuresDir = path.join(dir, "user-figures");
  const figure = fakeFigure(dir);
  try {
    const stored = userFigures.storeUserFigure({ answerId: "11111111-2222-3333-4444-555555555555", uploadedFile: figure, userFiguresDir: figuresDir });
    assert.equal(stored.filename, "11111111-2222-3333-4444-555555555555.png");
    assert.equal(stored.src, "/api/user-figures/11111111-2222-3333-4444-555555555555.png");
    const storedPath = path.join(figuresDir, stored.filename);
    assert.deepEqual(fs.readFileSync(storedPath), PNG_BYTES);
    assert.equal(fs.statSync(storedPath).mode & 0o777, 0o600);
    assert.equal(fs.existsSync(figure.path), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Production mounts every ReadWritePaths data directory as its own bind mount,
// so rename(2) from the upload inbox into user-figures fails with EXDEV even on
// one filesystem. The figure must still be stored through a copy fallback.
test("storeUserFigure falls back to copy when rename crosses a mount (EXDEV)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-figures-"));
  const figuresDir = path.join(dir, "user-figures");
  const figure = fakeFigure(dir);
  const renameSync = fs.renameSync;
  fs.renameSync = (source, target) => {
    if (source === figure.path) {
      const error = new Error("cross-device link not permitted");
      error.code = "EXDEV";
      throw error;
    }
    return renameSync(source, target);
  };
  try {
    const stored = userFigures.storeUserFigure({ answerId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", uploadedFile: figure, userFiguresDir: figuresDir });
    const storedPath = path.join(figuresDir, stored.filename);
    assert.deepEqual(fs.readFileSync(storedPath), PNG_BYTES);
    assert.equal(fs.statSync(storedPath).mode & 0o777, 0o600);
    assert.equal(fs.existsSync(figure.path), false, "the source upload must be removed after the copy");
  } finally {
    fs.renameSync = renameSync;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("storeUserFigure rejects unsupported figure types and oversized images", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-figures-"));
  const figuresDir = path.join(dir, "user-figures");
  try {
    const gif = fakeFigure(dir);
    gif.mimetype = "image/gif";
    assert.equal(userFigures.storeUserFigure({ answerId: "a", uploadedFile: gif, userFiguresDir: figuresDir }), null);
    assert.equal(fs.existsSync(figuresDir), false, "no directory is created when the figure is rejected");

    const empty = fakeFigure(dir);
    empty.mimetype = "image/png";
    // A zero-byte figure passes the store-level check; the route-level
    // isSupportedUserFigure guard is what rejects it before storage.
    empty.size = 0;
    const storedEmpty = userFigures.storeUserFigure({ answerId: "b", uploadedFile: empty, userFiguresDir: figuresDir });
    assert.equal(storedEmpty.filename, "b.png");
    assert.equal(userFigures.storeUserFigure({ answerId: "a", uploadedFile: null, userFiguresDir: figuresDir }), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

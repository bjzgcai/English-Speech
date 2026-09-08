const assert = require("node:assert/strict");
const test = require("node:test");

process.env.NODE_ENV = "test";

const { testHelpers } = require("../src/app");

test("standalone evaluation titles are derived safely from uploaded filenames", () => {
  assert.equal(
    testHelpers.standaloneEvaluationTitle("../../Europe_Street-beat.MOV"),
    "Europe Street beat",
  );
  assert.equal(testHelpers.standaloneEvaluationTitle("speech.mp4"), "speech");
  assert.equal(testHelpers.standaloneEvaluationTitle(""), "Standalone speech");
});

test("UTF-8 upload filenames misread as Latin-1 are restored without changing valid titles", () => {
  const title = "何小鹏_慕尼黑全英文演讲_MONA_L03全球发布会_官方完整回放_clip_03-23-25_to_03-30-00.mp4";
  const mojibake = Buffer.from(title, "utf8").toString("latin1");

  assert.equal(testHelpers.decodeUtf8UploadFilename(mojibake), title);
  assert.equal(testHelpers.decodeUtf8UploadFilename(title), title);
  assert.equal(testHelpers.decodeUtf8UploadFilename("Europe Street beat.mp4"), "Europe Street beat.mp4");
  assert.equal(
    testHelpers.standaloneEvaluationTitle(mojibake),
    "何小鹏 慕尼黑全英文演讲 MONA L03全球发布会 官方完整回放 clip 03 23 25 to 03 30 00",
  );
});

test("public evaluation projection repairs titles already stored as mojibake", () => {
  const filename = "何小鹏_慕尼黑全英文演讲_MONA_L03全球发布会_官方完整回放_clip_03-23-25_to_03-30-00.mp4";
  const expectedTitle = "何小鹏 慕尼黑全英文演讲 MONA L03全球发布会 官方完整回放 clip 03 23 25 to 03 30 00";
  const mojibakeFilename = Buffer.from(filename, "utf8").toString("latin1");
  const result = testHelpers.publicEvaluationForClient({
    id: "existing-upload",
    publiclyShared: true,
    title: mojibakeFilename.slice(0, 100),
    originalFilename: mojibakeFilename,
    sourceType: "upload",
    finishedAt: "2026-07-18T08:00:00.000Z",
    evaluation: { status: "completed", rubric: {} },
  });

  assert.equal(result.title, expectedTitle);
});

test("public evaluation projection contains feedback but excludes private evaluation data", () => {
  const record = {
    id: "public-evaluation-1",
    publiclyShared: true,
    title: "Product launch speech",
    originalFilename: "Product_launch_speech.mp4",
    sourceType: "upload",
    finishedAt: "2026-07-18T08:00:00.000Z",
    openId: "private-open-id",
    email: "private@example.com",
    user: { name: "Private user" },
    evaluation: {
      status: "completed",
      overallScore: 84,
      summary: "A clear and confident speech.",
      transcript: "Private transcript",
      audioMetrics: { wordCount: 120 },
      model: { evaluate: "private-model" },
      rubric: {
        fluency: {
          label: "Fluency",
          weight: 10,
          score: 82,
          feedback: "Pacing stays controlled.",
          available: true,
        },
      },
    },
  };

  const result = testHelpers.publicEvaluationForClient(record);
  assert.deepEqual(result, {
    id: "public-evaluation-1",
    title: "Product launch speech",
    finishedAt: "2026-07-18T08:00:00.000Z",
    overallScore: 84,
    summary: "A clear and confident speech.",
    rubric: {
      fluency: {
        label: "Fluency",
        weight: 10,
        score: 82,
        feedback: "Pacing stays controlled.",
        available: true,
      },
    },
    mediaValidation: {
      visualEvaluated: false,
      truncated: false,
      notice: "",
    },
    posterPath: null,
    videoPath: null,
  });

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /private-open-id|private@example\.com|Private transcript|private-model/);
});

test("only completed standalone uploads are eligible for the public gallery", () => {
  assert.equal(
    testHelpers.publicEvaluationForClient({
      id: "private-recording",
      sourceType: "recording",
      evaluation: { status: "completed" },
    }),
    null,
  );
  assert.equal(
    testHelpers.publicEvaluationForClient({
      id: "failed-upload",
      sourceType: "upload",
      evaluation: { status: "failed" },
    }),
    null,
  );
  assert.equal(
    testHelpers.publicEvaluationForClient({
      id: "..",
      sourceType: "upload",
      evaluation: { status: "completed" },
    }),
    null,
  );
});

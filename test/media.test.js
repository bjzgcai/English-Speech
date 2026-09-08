const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const processing = require("../src/processing");
const { inspectMedia, processMedia, canCopyVideo, audioMetrics, preparedMediaExists } = require("../src/media");
const { mediaConcurrency, pipelineConcurrency } = require("../src/media-config");

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "englisheval-media-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function fixture(dir, { duration = 3, video = true, audio = "sine=frequency=440:sample_rate=16000:duration=3", webm = false, size = "640x360" } = {}) {
  const file = path.join(dir, webm ? "input.webm" : "input.mp4");
  const args = ["-y"];
  if (video) args.push("-f", "lavfi", "-i", `testsrc2=size=${size}:rate=10:duration=${duration}`);
  if (audio) args.push("-f", "lavfi", "-i", audio);
  if (video) args.push("-c:v", webm ? "libvpx" : "libx264", ...(webm ? ["-deadline", "realtime", "-cpu-used", "8"] : ["-preset", "veryfast", "-profile:v", "main", "-level:v", "3.1"]), "-threads:v", "1", "-pix_fmt", "yuv420p");
  if (audio) args.push("-c:a", webm ? "libopus" : "aac");
  args.push("-t", String(duration), file);
  await processing.runMedia(args);
  return file;
}

test("FFmpeg concurrency respects CPU capacity and validates explicit overrides", () => {
  assert.equal(mediaConcurrency("", 0.5), 1);
  assert.equal(mediaConcurrency("", 1), 1);
  assert.equal(mediaConcurrency("", 2), 2);
  assert.equal(mediaConcurrency("", 32), 2);
  assert.equal(mediaConcurrency("1", 8), 1);
  assert.equal(mediaConcurrency("2", 1), 2);
  assert.equal(mediaConcurrency("3", 4), 3);
  assert.equal(mediaConcurrency("4", 4), 4);
  for (const invalid of ["0", "5", "1.5", "oops"]) assert.throws(() => mediaConcurrency(invalid, 2));
  assert.equal(pipelineConcurrency(""), 4);
  assert.equal(pipelineConcurrency("8"), 8);
  for (const invalid of ["0", "17", "1.5", "oops"]) assert.throws(() => pipelineConcurrency(invalid));
});

test("one FFmpeg invocation remuxes compliant H.264 and produces audio, frames and pause metrics", async t => {
  const dir = directory(t);
  const input = await fixture(dir);
  const output = path.join(dir, "output.mp4");
  const artifacts = path.join(dir, "artifacts");
  const inspected = await inspectMedia(input);
  assert.equal(canCopyVideo(inspected), true);
  let calls = 0;
  const original = processing.runMedia;
  t.mock.method(processing, "runMedia", (...args) => { calls++; return original(...args); });
  const result = await processMedia(input, { outputPath: output, artifactBaseDir: artifacts, mediaInfo: inspected });
  assert.equal(calls, 1);
  assert.equal(result.normalization, "copy");
  assert.equal(result.prepared.framePaths.length, 1);
  assert.equal(result.prepared.audibleAudio, true);
  assert.equal(preparedMediaExists(artifacts, result.prepared), true);
  const audio = await inspectMedia(path.join(artifacts, "audio.mp3"));
  assert.equal(audio.audio.channels, 1);
  assert.equal(audio.audio.sample_rate, "16000");
  assert.ok(Math.abs(result.prepared.analysis.durationSeconds - 3) < 0.15);
  const hashes = async file => JSON.parse(await original(["-v", "error", "-select_streams", "v:0", "-show_packets", "-show_data_hash", "sha256", "-show_entries", "packet=data_hash", "-of", "json", file], { probe: true })).packets.map(packet => packet.data_hash);
  assert.deepEqual(await hashes(output), await hashes(input), "Compressed video packets must be unchanged");
  fs.unlinkSync(result.prepared.framePaths[0]);
  assert.equal(preparedMediaExists(artifacts, result.prepared), false);
  const recovered = await processMedia(output, { artifactBaseDir: artifacts });
  assert.equal(preparedMediaExists(artifacts, recovered.prepared), true);
});

test("WebM is decoded once for normalized video and frames and capped to the requested duration", async t => {
  const dir = directory(t);
  const input = await fixture(dir, { webm: true, size: "1920x1080", duration: 1.5 });
  const output = path.join(dir, "output.mp4");
  const result = await processMedia(input, { outputPath: output, artifactBaseDir: path.join(dir, "artifacts"), maximumDurationSeconds: 1 });
  assert.equal(result.normalization, "h264");
  const media = await inspectMedia(output);
  assert.equal(media.video.codec_name, "h264");
  assert.equal(media.video.pix_fmt, "yuv420p");
  assert.equal(media.video.width, 1280);
  assert.equal(media.video.height, 720);
  assert.ok(media.durationSeconds <= 1.05);
  assert.ok(result.prepared.analysis.durationSeconds <= 1.001);
  assert.equal(result.prepared.framePaths.length, 1);
});

test("unknown, rotated, high-bit-depth, oversized or too-long video cannot take the copy path", async t => {
  const media = await inspectMedia(await fixture(directory(t)));
  for (const change of [{ pix_fmt: "yuv420p10le" }, { width: 1920 }, { height: 721 }, { bit_rate: undefined }, { level: 51 }, { sample_aspect_ratio: "2:1" }, { side_data_list: [{ rotation: 90 }] }]) {
    assert.equal(canCopyVideo({ ...media, video: { ...media.video, ...change } }), false);
  }
  assert.equal(canCopyVideo({ ...media, durationSeconds: null }), false);
  assert.equal(canCopyVideo({ ...media, durationSeconds: 121 }), false);
});

test("audio-only silence is retained without frames and does not trigger transcription", async t => {
  const dir = directory(t);
  const input = await fixture(dir, { video: false, audio: "anullsrc=r=16000:cl=mono" });
  const result = await processMedia(input, { outputPath: path.join(dir, "output.mp4"), artifactBaseDir: path.join(dir, "artifacts") });
  assert.equal(result.normalization, "audio-only");
  assert.equal(result.prepared.audibleAudio, false);
  assert.deepEqual(result.prepared.framePaths, []);
  const metrics = audioMetrics(result.prepared.analysis, "");
  assert.equal(metrics.wordCount, 0);
  assert.ok(metrics.silenceSeconds >= 2.9);
  assert.equal(metrics.longPauses, 1);
});

test("trailing silence and speaking rate are measured on the limited audio timeline", async t => {
  const dir = directory(t);
  const input = await fixture(dir, { audio: "aevalsrc=if(lt(t\\,1)\\,0.2*sin(2*PI*440*t)\\,0):s=16000:d=3" });
  const result = await processMedia(input, { artifactBaseDir: path.join(dir, "artifacts") });
  const metrics = audioMetrics(result.prepared.analysis, "one two three four five six");
  assert.ok(metrics.silenceSeconds >= 1.8 && metrics.silenceSeconds <= 2.2);
  assert.equal(metrics.longPauses, 1);
  assert.ok(metrics.speakingRateWpm >= 115 && metrics.speakingRateWpm <= 121);
});

test("invalid input and missing microphones fail media preparation", async t => {
  const dir = directory(t);
  const invalid = path.join(dir, "invalid.mp4");
  fs.writeFileSync(invalid, "invalid fixture");
  await assert.rejects(inspectMedia(invalid));
  const input = await fixture(dir, { audio: null });
  await assert.rejects(processMedia(input, { artifactBaseDir: path.join(dir, "artifacts") }), /no usable microphone/);
});

test("uploaded playlists cannot read other server media files", async t => {
  const dir = directory(t);
  await fixture(dir);
  const playlist = path.join(dir, "upload.mp4");
  fs.writeFileSync(playlist, "ffconcat version 1.0\nfile input.mp4\n");
  await assert.rejects(inspectMedia(playlist));
  await assert.rejects(processMedia(playlist, {
    outputPath: path.join(dir, "output.mp4"),
    mediaInfo: { hasAudio: true, hasVideo: false, audio: { index: 1 } },
  }));
});

test("media with multiple audio tracks uses the default track for normalization and evaluation", async t => {
  const dir = directory(t);
  const video = await fixture(dir, { audio: null });
  const input = path.join(dir, "multiple-tracks.mp4");
  await processing.runMedia(["-i", video, "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-map", "0:v:0", "-map", "1:a:0", "-map", "2:a:0", "-c:v", "copy", "-c:a", "aac", "-t", "3", "-disposition:a:0", "0", "-disposition:a:1", "default", input]);
  const media = await inspectMedia(input);
  assert.equal(media.audio.index, 2);
  const output = path.join(dir, "output.mp4");
  const result = await processMedia(input, { outputPath: output, artifactBaseDir: path.join(dir, "artifacts"), mediaInfo: media });
  assert.equal(result.prepared.audibleAudio, true);
  const replay = await processMedia(output, { artifactBaseDir: path.join(dir, "replay") });
  assert.equal(replay.prepared.audibleAudio, true);
});

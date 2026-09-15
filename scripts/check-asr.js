#!/usr/bin/env node
// Smoke-tests the configured ASR upstream (INTERNAL_LLM_TRANSCRIPTIONS_URL +
// INTERNAL_LLM_TRANSCRIBE_MODEL) by replaying exactly what src/app.js
// transcribeAudioFile() sends: multipart FormData with model/file/language and
// Bearer auth. Run after changing .env/.env.prod ASR settings.
//
//   node scripts/check-asr.js [audio-file ...]
//
// With no arguments it uses an existing extracted artifact under recordings/.
// Exit code 0 means the upstream answered 200 with a `text` field.

const fs = require("fs");
const path = require("path");

require(path.join(__dirname, "..", "src", "config.js"));

const root = path.join(__dirname, "..");
const url = process.env.INTERNAL_LLM_TRANSCRIPTIONS_URL || "https://api.example.com/v1/audio/transcriptions";
const model = process.env.INTERNAL_LLM_TRANSCRIBE_MODEL || "qwen-asr";
const apiKey = process.env.INTERNAL_LLM_API_KEY;

// Largest first: bigger artifacts are likelier to hold real speech, so a
// zero-argument run is less likely to land on a silent clip.
function discoverFixtures() {
  const dir = path.join(root, "recordings", "artifacts");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .flatMap(id => ["audio.wav", "audio.mp3"].map(name => path.join(dir, id, name)))
    .filter(file => fs.existsSync(file))
    .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)
    .slice(0, 2);
}

async function transcribe(audioPath) {
  const ext = path.extname(audioPath).toLowerCase();
  const formData = new FormData();
  formData.append("model", model);
  formData.append("file", new Blob([fs.readFileSync(audioPath)], {
    type: ext === ".wav" ? "audio/wav" : "audio/mpeg",
  }), path.basename(audioPath));
  formData.append("language", "en");

  const started = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });
  const body = await response.text();
  let text = null;
  try { text = JSON.parse(body)?.text; } catch { /* not JSON */ }
  return { status: response.status, ms: Date.now() - started, text, body };
}

function diagnose({ status, text, body }) {
  if (status === 401) return "auth rejected — check INTERNAL_LLM_API_KEY";
  if (status === 503) return "model not routed — check INTERNAL_LLM_TRANSCRIBE_MODEL";
  if (status === 404) return "no such route — check the /v1 path in INTERNAL_LLM_TRANSCRIPTIONS_URL";
  if (status >= 500) return "upstream error";
  if (status === 200 && text === null) {
    return body.trimStart().startsWith("<")
      ? "URL returned an HTML page, not the API — the path is likely missing /v1"
      : "200 without a `text` field";
  }
  return null;
}

(async () => {
  const targets = process.argv.slice(2).length ? process.argv.slice(2) : discoverFixtures();
  console.log(`url   : ${url}\nmodel : ${model}\nkey   : ${apiKey ? `set (${apiKey.length} chars)` : "MISSING"}`);
  if (!process.env.INTERNAL_LLM_TRANSCRIPTIONS_URL) console.log("        (using the code's placeholder fallback, not a real endpoint)");
  if (!targets.length) {
    console.error("\nNo audio fixtures found. Pass one or more audio files as arguments.");
    process.exit(2);
  }

  let failed = 0;
  let transcribed = 0;
  for (const target of targets) {
    const relative = path.relative(root, target);
    if (!fs.existsSync(target)) {
      console.log(`\nFAIL ${relative}\n     file not found`);
      failed += 1;
      continue;
    }
    const result = await transcribe(target);
    const problem = diagnose(result);
    const chars = typeof result.text === "string" ? result.text.length : 0;
    console.log(`\n${problem ? "FAIL" : chars ? "OK  " : "WARN"} ${relative}`);
    console.log(`     http=${result.status} latency=${result.ms}ms type=${path.extname(target).slice(1)}`);
    if (problem) {
      console.log(`     ${problem}`);
      console.log(`     body: ${result.body.slice(0, 200).replace(/\s+/g, " ")}`);
      failed += 1;
    } else if (chars) {
      transcribed += 1;
      console.log(`     chars=${chars} preview=${JSON.stringify(result.text.slice(0, 100))}`);
    } else {
      // A well-formed 200 with no text is the upstream working correctly on a
      // clip that holds no speech — not a configuration failure.
      console.log("     empty transcript — the endpoint answered but this clip holds no speech");
    }
  }

  if (!failed && !transcribed) {
    console.log("\nFAIL every fixture returned an empty transcript — endpoint reachable but nothing was recognized.");
    process.exit(1);
  }
  console.log(failed ? `\n${failed}/${targets.length} fixture(s) failed.` : `\nASR upstream OK (${transcribed}/${targets.length} fixture(s) transcribed).`);
  process.exit(failed ? 1 : 0);
})().catch(error => {
  console.error(`\nFAIL network — ${error.message}`);
  process.exit(1);
});

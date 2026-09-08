# Media Pipeline Validation: 2026-09-08

## Implementation

- FFprobe selects the default camera/audio streams using structured metadata.
- One FFmpeg process produces the normalized MP4, mono 16 kHz audio, silence and
  volume measurements, and sampled frames. Artifact recovery can rebuild the
  evaluation inputs from the durable MP4 after a worker interruption.
- Compliant H.264 is copied without video re-encoding. The copy decision checks
  profile, level, pixel format, dimensions, aspect ratio, bitrate, duration,
  timestamps, and rotation. Other input is converted to H.264/AAC MP4.
- `FFMPEG_CONCURRENCY` accepts 1 or 2. Automatic selection respects CPU affinity
  and Linux cgroup quotas. The production worker has two host CPUs but a one-core
  quota, so its automatic limit remains 1. Every encoder is single-threaded.
- Admin metrics and `scripts/stage-report.js` expose active stage P50/P90 and
  sample counts by duration class and pipeline version. Telemetry also records
  wall time and resource waiting time. Resumption preserves measured work.

Qwen remains an English transcription service. Scoring still uses transcript,
metrics, question/profile, rubric, and frames through the configured evaluation
provider. Audio-only uploads exclude and reweight visual delivery. Pronunciation
remains an indirect inference; this change does not add acoustic scoring.

## Production-Host Performance

Tests ran on `10.1.130.9` in `/opt/englisheval-validation-20260908`, with isolated
temporary datasets, synthetic identities, and synthetic media. The test process
group was limited to one CPU and 1400 MiB. Live application health, available
memory, disk space, and live queued work were checked throughout guarded runs.
The live user dataset and environment were not used as benchmark output storage.

### Controlled Media Comparisons

| Input | Version / FFmpeg limit | Jobs | Normalized P50 / P90 | Normalized + media mean | API P95 |
| --- | --- | --- | --- | --- | --- |
| 120s compliant 640x360 MP4 | Legacy / 1 | 10/10 | 3.622s / 3.882s | 4.615s | 54ms |
| Same MP4 | Fused / 1 | 10/10 | 1.507s / 1.649s | 1.538s | 35ms |
| Same MP4 | Fused / 2 | 10/10 | 3.059s / 3.149s | 3.083s | 65ms |
| 120s moving 1280x720 WebM | Legacy / 1 | 4/4 | 28.734s / 29.251s | 32.542s | Not retained |
| Same WebM | Fused / 1 | 4/4 | 28.476s / 29.162s | 28.657s | 35ms |

Combined media execution improved about 67% for the compliant MP4 and 12% for
720p WebM. The MP4 fixture has a simple visual background; the WebM fixture uses
a moving test pattern. These results are specific to those fixtures.

The compliant MP4 batches took 92s (legacy), 75s (fused, one slot), and 74s
(fused, two slots), including queue/model rate-limit waits. Two FFmpeg slots
approximately doubled individual media latency with negligible batch throughput
benefit under the one-core quota. Keep the automatic production value of 1.

Do not compare the WebM batch wall times directly: the 143s fused run included
fixture creation, whereas the 135s legacy run reused the prebuilt fixture.

Retained synthetic data directories on the production host:

| Run | Directory |
| --- | --- |
| Legacy MP4 | `/tmp/englisheval-load-Euo9Yh` |
| Fused MP4, one slot | `/tmp/englisheval-load-onPwF6` |
| Fused MP4, two slots | `/tmp/englisheval-load-9WbF6g` |
| Fused WebM | `/tmp/englisheval-load-VFarU5` |
| Legacy WebM | `/tmp/englisheval-load-7SrN7w` |

### Capacity and Forced Restart

100 simultaneous arrivals and 50 accepted two-minute MP4 submissions completed
50/50 in 474 seconds. All 50 used the H.264 copy path. A forced worker kill
interrupted four processing jobs; all four recovered, and no recording was lost.
Deterministic model responses deliberately repeated complete JSON objects to
exercise the provider-response fix under load. Real FFmpeg processing and normal
application model budgets were enabled; remote model latency was not simulated.

| Measurement | Result |
| --- | --- |
| Lightweight API P95 | 89ms |
| Upload transfer plus acknowledgement P95 | 317ms |
| Acknowledgement after transfer P95 | 185ms |
| Normalized P50 / P90, latest 30 samples | 1.578s / 1.651s |
| Peak FFmpeg / ASR / scoring concurrency | 1 / 2 / 2 |
| Terminal failures / artifact fallbacks | 0 / 0 |

Idempotent resubmission, cross-owner job/video denial, owner video range playback,
and exactly one history entry per accepted submission all passed. Live production
health stayed ready. Report: `/tmp/englisheval-load-DiHb6J/report.json`.

Reproduce on the production host from the validated candidate:

```sh
TEST_ROOT=/opt/englisheval-validation-20260908 \
  bash /opt/englisheval-validation-20260908/scripts/production-load-check.sh \
  --users=50 --arrivals=100 --duration=120 \
  --fixture=/opt/englisheval-validation-20260908/spoken-fixture.mp4 \
  --ffmpeg-concurrency=1 --restart --repeat-json --timeout=1800 --keep-data
```

### Real Model Services

Ten 120s 720p WebM answers with synthetic English speech completed through the
actual configured question, Qwen ASR, and OpenRouter scoring services. Every
answer produced scorable English and 223 transcribed words. Production's existing
18-frame setting was retained. The scoring model was `z-ai/glm-5.3-flash`.

| Stage | Samples | P50 | P90 | Mean |
| --- | --- | --- | --- | --- |
| Normalized | 10 | 29.295s | 29.660s | 29.390s |
| Media checkpoint | 10 | 0.003s | 0.005s | 0.003s |
| Transcription | 10 | 2.657s | 4.579s | 3.281s |
| Scoring | 10 | 57.401s | 124.042s | 68.452s |

For this workload, normalization exceeds transcription at both percentiles,
but scoring remains the longest stage. These are controlled production-host
observations, not natural user-traffic percentiles.

One real provider response contained two complete JSON objects separated by
Markdown backticks. The former parser rejected it. After fixing and testing
first-object extraction with a structured parser and strict JSON validation,
the saved response was recovered and the batch resumed. All 10 jobs completed.
The retained report is marked `resumed: true`; its 254s elapsed value covers only
the resumed portion, and stage observations may include interrupted work. Do not
use it as a clean batch throughput measurement.

Report: `/tmp/englisheval-load-Cwhx2l/report.json`. Lightweight API P95 during the
resumed portion was 27ms; original upload acknowledgement P95 was 104ms. Peak
worker resources stayed at FFmpeg 1, transcription 2, and scoring 2.

### Natural Production Traffic

Before deployment, the live queue had only one historical long-video sample in
the preceding seven days: normalized 22.356s, media 2.802s, transcription 1.572s,
and scoring 92.869s. One sample is insufficient for a stable P50/P90 conclusion.
New samples are kept separate from legacy measurements; up to 30 observations
per stage, duration class, and pipeline version are retained.

Read current live aggregates without modifying the database:

```sh
node scripts/stage-report.js \
  --database=/opt/englisheval/shared/recordings/queue.sqlite --hours=168
```

## Functional Verification

Local `npm test` and production Node 22.23.2 tests: 122/122 passed in both
environments. The production suite ran serially in a separate systemd process
group capped at one CPU and 1400 MiB with isolated data. Coverage includes actual
FFmpeg processing,
video-copy packet equality, WebM conversion, silence and pause metrics, ordered
ASR chunks and format fallback, upstream failures, owned fallback questions,
missing tracks, ownership isolation, idempotent submissions, killed-worker
recovery with missing artifacts, backup/restore, retention, model budgets,
OAuth state/session security, and monitoring.

A separate nginx instance on the production host passed the edge-limit test:
50 normal requests succeeded; a 300-request admission burst forwarded 101 and
rejected 199 with the expected HTTP 429 JSON and retry header; 140 held
connections produced 12 connection-limit rejections. The live nginx instance
was not reconfigured for this test.

Playwright passed at 1440px desktop and 390px mobile widths:

- Consent, generated question, camera/microphone recording, actual two-minute
  automatic stop, upload, evaluation, video playback, and owner-filtered history.
- Share PNG download, weekly game, comments and ratings, member alias persistence,
  public gallery playback, identity switch, and logout.
- Interrupted audio/video rejection, interrupted upload recovery, IndexedDB
  refresh recovery, queue waiting states, admin P50/P90 and admission pause/resume.

No browser JavaScript errors or horizontal overflow were observed. Recording,
share image, and admin screenshots were visually reviewed. Automated identities
and deterministic upstreams were used for browser workflows. Interactive human
DingTalk approval was not performed; OAuth security and redirect behavior are
tested separately.

Useful reproduction commands (Playwright must be installed):

```sh
npm test
node scripts/full-browser-check.js --full-duration
node scripts/browser-check.js
node scripts/guest-browser-check.js
node scripts/monitor-browser-check.js
node scripts/production-smoke.js --base=https://eng.lab.bza.edu.cn
```

## Defects Fixed During Validation

- Audio analysis read the initial `n_samples: 0` message instead of the final
  sample count, losing duration and derived metrics.
- Linux installation with `npm ci --ignore-scripts` left FFprobe non-executable;
  deployment now sets its execute permission and verifies that it starts.
- Repeated JSON in a successful provider response caused evaluation parsing to
  fail; complete first-object extraction now still rejects malformed JSON.
- Synchronous standalone scoring failure discarded an otherwise valid uploaded
  recording; the recording and failure history are now retained.
- Worker resumption could lose previous measured stage work; timing retains it.
- The load client rejected saved fallback questions returned with an upstream
  error status; it now follows the actual browser's persisted-question behavior.
- The host's ephemeral-port range starts at 1024. A local HTTP reproduction
  received port 2049 and failed with `fetch failed` / `bad port`. Test and browser
  servers now bind high loopback ports with collision retries, avoiding ports
  rejected by fetch and browsers. This was discovered while investigating a
  production-runtime guest test failure; the focused guest suite passed afterward.

## Deployment and Final Checks

Deployed to `https://eng.lab.bza.edu.cn` as release
`/opt/englisheval/releases/20260908T022042Z-4a4f01a`. The package includes the
validated working-tree changes; the hash suffix identifies its base commit.
The previous release was `20260907T143438Z-4a4f01a`.

- Web, worker, and monitor services are active. Internal and HTTPS health checks
  report `workerReady: true`; admissions are enabled.
- The running worker reports FFmpeg limit 1, ASR limit 2, and scoring limit 2.
  The installed FFprobe binary is executable and starts successfully.
- Both production environment files matched the predeployment content hashes.
  Recording/question/consent/rating metadata matched the predeployment hashes:
  36 recordings, 92 questions, 29 consents, and one rating. There were no comments.
  The 36-video inventory, file sizes, and modification times were unchanged.
- Postdeployment Playwright checked nine public routes at both desktop and mobile
  widths: 18 successful pages, no horizontal overflow, and zero JavaScript errors.
  OAuth redirect/nonce, invalid callback rejection, and anonymous admin denial
  passed. The deployed admin JavaScript matches the local source.
- Authenticated partner user listing, synthetic user detail, and rubric retrieval
  passed, private media fields were excluded, and an invalid key was rejected.
- JavaScript syntax checks passed for 58 server, browser, script, and test files;
  deployment/load shell syntax and `git diff --check` passed.

The checked browser workflows and controlled production-host loads have no
outstanding failures. Human DingTalk approval and statistically stable natural
traffic percentiles remain outside the evidence collected in this run.

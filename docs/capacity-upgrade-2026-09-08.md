# Six-CPU Production Capacity Upgrade

## Host and Allocation

On 2026-09-08, `10.1.130.9` reported six online CPUs and 11891 MiB of RAM.
The shared system/recording filesystem also expanded to 502 GiB, with about
452 GiB available when checked.
Before this change the evaluation worker still had a one-core CPU quota and a
1200 MiB memory ceiling. The host also runs the paper-review application,
committee-vote application, PostgreSQL, nginx, and management services.

| Setting | Previous production value | New profile |
| --- | --- | --- |
| Worker CPU quota | 100% | 400% |
| Worker memory high / maximum | 900 / 1200 MiB | 3 / 4 GiB |
| FFmpeg concurrency | 1 | 3 |
| Active evaluation pipelines | 4 | 8 |
| ASR semaphore / budget concurrency | 2 | 3 |
| Scoring semaphore / budget concurrency | 2 | 4 |
| Question concurrency | 2 | 2 |
| Shared internal gateway concurrency | 3 | 3 |
| Admission / waiting-room capacity | 50 / 200 | 50 / 200 |

The allocation leaves approximately two host CPU cores outside the worker quota
and substantial memory headroom for the web service and other applications.
The web service retains its 512 MiB ceiling. There is no GPU processing change.

## Implementation and Budgets

`ops/englisheval-capacity.env` contains only four non-secret runtime settings.
Both web and worker systemd units load this versioned profile. Shared `.env` and
`.env.prod` credentials are not edited. Deployment restores previous systemd
units during rollback, so the previous release does not load the new profile.
Explicit values loaded from shared `.env.prod` still override the profile.

FFmpeg accepts explicit concurrency 1-4 while preserving automatic selection of
1-2. `WORKER_CONCURRENCY` accepts 1-16 and defaults to four. Model semaphores now
follow `MODEL_*_CONCURRENT` instead of always stopping at two. The worker reports
its pipeline capacity, and queue estimates use reported pipeline/media/model
limits. Other generic defaults remain compatible with the prior release.

Existing RPM and TPM budgets are retained: internal gateway 30 RPM / 120000 TPM,
question generation 20 RPM / 120000 TPM, ASR 20 RPM, and scoring 12 RPM / 300000
TPM. Four local scoring slots are an upper bound, not a guarantee of four active
provider requests. The durable guard still accounts for conservative image and
output-token reservations, shared usage, retries, and cooldowns. No provider-side
quota increase is assumed from the hardware upgrade.

## Twenty-User Production-Host Load

The guarded benchmark ran with a four-core quota and 4096 MiB ceiling using
isolated storage, 20 simultaneous arrivals, and 20 two-minute 720p WebM uploads.
FFmpeg processed real video; deterministic upstream responses exercised repeated
JSON handling. A forced worker restart exercised durable recovery. The original
production dataset was not used for benchmark output.

| Measurement | Result |
| --- | --- |
| Completed recordings | 20/20 |
| Elapsed, including forced restart | 238 seconds |
| Lightweight API P95 | 20 ms |
| Upload plus acknowledgement P95 | 460 ms |
| Acknowledgement after transfer P95 | 181 ms |
| Normalized P50 / P90 | 24.208 / 26.913 seconds |
| Observed FFmpeg peak | 3 |
| Observed mock ASR request peak | 3 |
| Artifact fallbacks / terminal failures | 0 / 0 |

Video ownership, range playback, one history entry per submission, and idempotent
retries passed. Live application health and the other business services remained
active, with over 10 GB available host memory during the observed checks.
This batch does not establish real-model completion time for 20 submissions.

Retained report: `/tmp/englisheval-load-8AzIPD/report.json` on the production host.

```sh
TEST_ROOT=/opt/englisheval-validation-20260908 \
BENCHMARK_CPU_QUOTA=400% BENCHMARK_MEMORY_MIB=4096 \
bash /opt/englisheval-validation-20260908/scripts/production-load-check.sh \
  --users=20 --arrivals=20 --duration=120 --webm --capacity-profile \
  --fixture=/opt/englisheval-validation-20260908/spoken-motion.webm \
  --restart --repeat-json --timeout=1200 --keep-data
```

The load wrapper now accepts bounded CPU/memory overrides and stops its
high-memory runs below 2 GiB host-available memory. It also stops when live
production jobs arrive or health/disk checks fail.

## Actual Model Services

Four synthetic two-minute 720p WebM recordings completed through the configured
question, Qwen ASR, and scoring services with the new profile. All four generated
questions and evaluations succeeded, with 223 transcribed words per recording.
The clean batch took 199 seconds, without interruption or resumption. Lightweight
API P95 was 6 ms and upload acknowledgement P95 was 86 ms.

| Stage | Samples | P50 | P90 |
| --- | --- | --- | --- |
| Normalized | 4 | 25.650s | 25.809s |
| Transcription | 4 | 2.282s | 2.496s |
| Scoring | 4 | 64.723s | 98.160s |

Local scoring semaphore occupancy reached four, while actual in-flight scoring
requests peaked at three. One observation had three active scoring reservations
totaling 291594 tokens against the unchanged 300000-token budget. This confirms
that increasing local slots does not bypass the durable upstream budget.
Actual ASR concurrency peaked at two in this small sample. No stable 20-user
real-model latency guarantee can be inferred from four identical test recordings.

Report: `/tmp/englisheval-load-JBwZ8K/report.json`. Reproduce using the same
wrapper and fixture above with `--users=4 --arrivals=4 --real-upstreams`, omitting
the forced-restart and repeated-mock-JSON flags.

## Regression Checks

All 124 tests passed locally and on production Node 22.23.2. New coverage
verifies the six-CPU profile with an eight-submission burst, explicit concurrency
validation, and queue estimates using model/pipeline limits above the previous
hardcoded values. Existing media, authentication, ownership, budget, recovery,
backup, and retention tests also passed. Admin browser checks passed with no
JavaScript errors. Server/script syntax, shell syntax, and whitespace checks passed.

## Deployment Verification

Activated release `20260908T032851Z-4a4f01a` at
`https://eng.lab.bza.edu.cn`, replacing `20260908T022042Z-4a4f01a`.
The hash suffix identifies the base commit; the release contains the validated
working-tree changes.

Systemd reports a four-core CPU quota, 3 GiB memory high threshold, and 4 GiB
maximum for the worker. Both web and worker process environments contain the
3/8/3/4 media/pipeline/ASR/scoring profile, and worker telemetry reports the same
limits. Admissions are enabled and public/internal health reports worker ready.

The evaluation web/worker/monitor, paper reviewer, committee vote, PostgreSQL,
and nginx services are active. Both shared environment files and historical
metadata matched their predeployment content hashes. Video filenames, sizes,
and modification times also matched the predeployment inventory.

Postdeployment browser checks passed on nine routes at two viewport widths:
18 successful page checks, no horizontal overflow, zero JavaScript errors,
working OAuth redirect/nonce, invalid callback rejection, and anonymous admin
denial. Interactive human DingTalk authorization was not performed in this run.

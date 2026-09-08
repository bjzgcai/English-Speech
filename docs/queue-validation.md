# Queue Validation: 2026-09-07

## Server and Limits

Validated on `10.1.130.9`: two AMD EPYC virtual CPU cores, 3.7 GiB RAM,
approximately 2.2 GiB available RAM, and approximately 65 GiB free disk before
testing. Other applications share this server. Tests used temporary directories,
synthetic identities, isolated web/worker processes, and systemd resource limits.
The production dataset remained at 35 recordings and 85 generated questions.

The application admits 50 outstanding sessions, retains up to 200 FIFO waiting
positions, allows four upload transfers and four processing pipelines, and limits
FFmpeg to one process/thread and ASR/scoring to two requests each. The worker
service has a one-core CPU quota and a 1200 MiB memory ceiling; the web service
has a 512 MiB memory ceiling. Disk/memory pressure and worker/upstream outages
pause new admissions. Accepted work remains durable.

## Measured Capacity

| Test | Media duration | Completed | Total elapsed | Lightweight API p95 | Upload acknowledgement p95 |
| --- | --- | --- | --- | --- | --- |
| 10 submissions | 2 seconds | 10/10 | 11 seconds | 98 ms | 57 ms |
| 30 submissions | 2 seconds | 30/30 | 29 seconds | 231 ms | 220 ms |
| 100 arrivals, 50 submissions, forced worker restart | 120 seconds | 50/50 | 652 seconds | 101 ms | 391 ms |

The 50-user test used real 640x360, 24 fps video processing and deterministic
upstream responses. Its entire benchmark process group, including the load
generator and fixture file cache, was constrained to one CPU core and 1400 MiB.
The smaller bursts used half a core and 600 MiB while the larger run continued.
Observed ASR and scoring request concurrency never exceeded two.

Acknowledgement timing starts after multipart transfer finishes, covering private
file persistence and queue acceptance. The 50-user test's transfer plus response
p95 was 3155 ms; the application acknowledgement component was 391 ms.

These runs verify application concurrency, admission, media processing, and
recovery. They do not establish simultaneous DingTalk login quotas or guarantee
that 50 real model evaluations finish in eleven minutes.

## Actual Model Services

A synthetic two-minute spoken answer also completed through the actual configured
question-generation, Qwen ASR, and OpenRouter scoring services in isolated storage.
Total elapsed time was 162 seconds, including approximately 7 seconds for
transcription and 130 seconds for scoring. Returned scoring usage was persisted:

- Model: `z-ai/glm-5.3-flash`; returned provider: `Z.AI`.
- Prompt tokens: 6923; completion tokens: 5156.
- Returned scoring cost: USD 0.001808225.

This is one sample, not a latency or pricing guarantee. Queue estimates use recent
observations, current resource occupancy, and retries. Stage samples exclude
time waiting for a processing semaphore to avoid double-counting contention.
Cold-start estimates remain unavailable until enough comparable requests finish.

## Regression and Recovery Checks

- 70 automated tests passed locally and on the production Node 22 runtime.
- Real media traversed authenticated upload, durable acceptance, worker processing,
  owner-only job/video access, idempotent retries, and history projection.
- Scoring failures retained valid owned MP4 recordings. Invalid input became a
  failed job without a playable recording.
- Tests covered FIFO admission, overflow, duplicate tabs, expired grants and
  reservations, checkpoint recovery, stale completions, cancellation tombstones,
  persisted retry exhaustion, concurrency, and simultaneous SQLite initialization.
- Encrypted backup/decryption restored both queued jobs and original pending files.
- Playwright checked 1440px desktop and 390px mobile layouts, waiting-room actions,
  estimated progress, interrupted uploads, refresh recovery, and explicit discard.
  No browser JavaScript errors or horizontal overflow were observed.
- JavaScript and deployment-shell syntax checks and OpenAPI YAML parsing passed.

## Operations

Use the admin Evaluation capacity controls or `node scripts/queue-control.js`
with `status`, `pause`, or `resume`. First deployment creates the queue paused;
retain a queue-compatible release before enabling admissions. Roll back web and
worker together. Never revert to pre-queue code after accepting queued uploads.
Nightly encrypted maintenance stops and restarts both services, and includes the
queue, its WAL files, and pending originals. Existing recording retention remains
disabled unless the production environment explicitly enables it.

Production activation completed at `https://eng.lab.bza.edu.cn` using release
`20260907T091851Z-cca2577`. Admissions are enabled and both services are healthy.
The tested queue-compatible rollback release is `20260907T091618Z-cca2577`.
Production encrypted maintenance succeeded both before deployment and with the
new web/worker service pair. Final checks confirmed unchanged historical data,
private queue permissions, matching deployed browser assets, and HTTP 401 for
unauthenticated job access. The original production environment was preserved.

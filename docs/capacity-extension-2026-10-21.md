# Capacity Extension: 2026-10-21

## Scope

Production scoring is the long pole in the evaluation pipeline. The earlier
six-CPU profile allowed eight active pipelines and four scoring semaphore slots,
but retained a 300,000-token/minute scoring budget. A high-frame scoring request
can reserve roughly 100,000 tokens, so the token budget commonly limited actual
long-answer scoring to about three calls.

This profile extension increases scoring capacity while preserving the validated
media and internal-gateway limits.

| Setting | Previous | New |
| --- | ---: | ---: |
| Active evaluation pipelines | 8 | 10 |
| FFmpeg concurrency | 3 | 3 |
| ASR concurrency | 3 | 3 |
| Scoring concurrency | 4 | 6 |
| Scoring requests per minute | 12 | 18 |
| Scoring tokens per minute | 300,000 | 600,000 |
| Question + ASR + detection concurrency | 3 | 3 |

The worker's four-core CPU quota, four-GiB memory ceiling, queue admission limits,
and provider routing are unchanged.

## Verification

The focused media, queue and model-guard tests pass, including a contract test
for the versioned profile. An isolated deterministic 10-arrival burst completed
10/10:

| Measurement | Result |
| --- | ---: |
| Pipeline limit | 10 |
| FFmpeg peak | 3 |
| ASR peak | 3 |
| Scoring semaphore peak | 4 |
| Actual scoring request peak | 3 |
| Completed recordings | 10/10 |
| Elapsed | 5 seconds |
| Worker RSS | 173,277,184 bytes |

This validates queue claiming and model-budget behavior with a synthetic upstream.
It does not establish throughput with ten simultaneous long recordings against
the real internal or OpenRouter models. Use the isolated real-upstream benchmark
with synthetic media before treating the extension as a production latency
guarantee.

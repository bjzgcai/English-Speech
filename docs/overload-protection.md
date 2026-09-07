# EnglishEval overload protection

The web and worker processes share model budgets in `recordings/queue.sqlite`.
Reservations are atomic SQLite transactions. Neither restarting a process nor
opening another browser resets these limits. Queue backups already include the
new tables. No credentials, prompts, transcripts or user identifiers are stored
in model budget records.

| Scope | In flight | Requests per rolling minute | Tokens per minute |
| --- | ---: | ---: | ---: |
| Internal gateway, question and ASR combined | 3 | 30 | 120,000 |
| Question generation | 2 | 20 | 120,000 |
| Qwen ASR | 2 | 20 | Not token-metered |
| OpenRouter scoring | 2 | 12 | 300,000 |

Configure these with `MODEL_<SCOPE>_CONCURRENT`, `_RPM` and `_TPM` in the original
production environment. `INTERNAL`, `QUESTION`, `TRANSCRIPTION` and `SCORING`
are supported scopes. Use identical settings for web and worker. ASR load is
bounded by requests, concurrency and the existing two-minute media limit.

Text requests reserve UTF-8 byte length plus a bounded output allowance (4,096
question tokens, 16,384 scoring tokens). Each image reserves 4,096 tokens. Image
tokenization is provider-specific: these are conservative application estimates,
not an authoritative cap on billed tokens. Returned usage replaces reservations;
absent usage and ambiguous failures keep their reservation. Tokens remain charged
through the request and for one minute after completion or lease expiration.
Request counts use a rolling minute from dispatch. Expired process leases release
concurrency after the request deadline plus five seconds, retaining token charges.

HTTP 429 opens a persisted cooldown immediately, honoring numeric or HTTP-date
`Retry-After`. Three network/5xx failures open a 60-second circuit. Question and
ASR calls share the internal circuit. Only one probe may run after a circuit
expires. An older in-flight success cannot close a newer circuit. Each stage
still has at most three network attempts; waiting for budget consumes no attempts.
Question requests return the existing owned, saved fallback during cooldown or
budget contention. Worker requests wait durably and preserve completed stages.
The existing admission pause and resource monitor see all open circuits.

The authenticated administrator queue endpoint includes current budgets, usage,
active counts and cooldowns; the admin page displays these alongside queue timings.

## Edge traffic

`ops/nginx-englisheval.conf` manages only `eng.lab.bza.edu.cn`. Node binds to
loopback through the production systemd unit. Port 3199 is consequently unavailable
remotely, even with an old firewall allow rule. The public entry point is HTTPS.
Do not override `HOST` in the production environment to a public address.

Nginx limits API/auth traffic to 80 requests/second per peer and 120 globally, with
bursts of 200/300. Admission creation, `/api/me`, and authentication have tighter
2/5 requests/second limits and 100/200 request bursts. API mutations additionally
share 15/20 requests/second limits and 200/250 bursts. Up to 128 active connections
per peer and 256 globally are permitted; HTTP/2 streams count individually.
These bursts accommodate a classroom behind one NAT. Larger shared networks may
wait longer. Forwarded IP headers and arbitrary cookies cannot evade these limits.
Static files are outside request-rate limits but remain connection-limited.

Rejections are JSON HTTP 429 with `Retry-After: 5`. Request bodies stream to Node,
where upload grants are checked before multipart parsing. Header/body idle
timeouts bound slow clients; upload size remains bounded. The policy assumes
nginx directly receives client connections. Introducing a load balancer requires
an explicit trusted-proxy policy, never blanket trust in `X-Forwarded-For`.

`deploy.sh` validates nginx, saves the old site with the release's systemd backup,
installs the policy, activates web/worker together and reloads nginx. Failure
restores the previous site and services. Custom targets must provide their own
proxy and use `INSTALL_EDGE_LIMITS=false`; the web still binds to loopback.
For manual rollback restore `.systemd-backup/nginx-englisheval.conf` from the
release being rolled back, run `nginx -t`, then reload nginx with the old services.

## Shared gateway boundary

EnglishEval cannot control other applications through its own SQLite database.
Gateway administration access has not been established. Gateway-wide enforcement
therefore remains an infrastructure action, not an enabled feature of this release.
The gateway operator should:

1. Issue an EnglishEval-only credential, scoped to `glm` and `qwen-asr`, and apply
   the internal/question/ASR limits above to that credential on every gateway
   instance using one shared limiter. Install the key directly in production's
   existing environment; never commit it or send it through a browser.
2. Assign distinct keys and explicit concurrency, request and token budgets to
   every other application; do not let key rotation reset an application's budget.
3. Set total model/provider concurrency and token throughput from measured model
   capacity, allocating headroom before distributing application quotas. This
   repository has no measurement of the shared gateway's total capacity.
4. Reject excess requests with 429 and `Retry-After` before forwarding, meter actual
   usage, and enforce authentication and quotas on every route and replica. Apply
   separate audio-duration quotas to ASR where supported.

The application budgets reduce EnglishEval's load now. A dedicated credential and
gateway-side enforcement are required to isolate it from traffic by other apps.

## Verification

`node --test test/model-guard.test.js test/processing.test.js` tests concurrent
processes, shared internal capacity, rolling request/token budgets, restart
persistence, expired leases, cancellation, cooldowns, stale successes and probes.
`node scripts/check-edge-limits.js` runs an isolated nginx and synthetic backend
on temporary loopback ports, checking a 50-client burst, 300 entry requests,
forged forwarding headers/cookies, JSON retry responses and connection ceilings.
It does not reload or send traffic to the production application.

### Results on 2026-09-07

- Repository suite: 101 passing tests. The isolated production-compatible package
  passed 95 tests; the model guard/retry tests also passed on production Node 22.
- A resource-constrained run on the production host accepted 50 submissions from
  100 arrivals. All 50 completed in 252 seconds using two-second synthetic media
  and deterministic upstream responses. ASR/scoring peaks were two each.
- Lightweight API p95 was 195 ms; upload acknowledgement p95 was 1,224 ms after
  transfer. This run deliberately exercised the new 12 scoring requests/minute
  ceiling. It is not a measurement of real model throughput or two-minute media.
- Isolated nginx: 50 simultaneous normal requests passed; a 300-entry burst
  forwarded 101 and rejected 199; 12 excess held connections were rejected.
- Encrypted backup/restore retained model token charges and active cooldowns.
  Desktop (1440px) and mobile (390px) admin checks had no script errors or overflow.
- Deployed release: `20260907T105043Z-local`. HTTPS health passed; Node listens on
  `127.0.0.1:3199`; web, worker, nginx and the independent monitor are active.
  A live 120-request `/api/me` burst returned 101 normal responses and 19 HTTP 429
  responses, each with `Retry-After: 5`. No model calls were made by this check.
- The monitor remained healthy, notifications enabled, with no active alerts.
  Existing data was preserved; the post-deployment count was 35 recordings and
  86 questions (one question was added by normal activity during verification).

Gateway-wide quotas remain pending the shared gateway administration connection.

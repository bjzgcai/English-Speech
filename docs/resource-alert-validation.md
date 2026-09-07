# Resource alert deployment validation

Verified on 2026-09-07, Asia/Shanghai.

## Deployment

- Production host: `10.1.130.9`.
- Active release: `/opt/englisheval/releases/20260907T095732Z-local`.
- Source package: `/tmp/englisheval-alert-release.ioME3A` on the development Mac.
- The package was built from production release `20260907T091851Z-cca2577`,
  adding only monitoring changes. Concurrent guest-login changes in the shared
  worktree were preserved and excluded from this deployment.
- Web, worker and monitor are active. Monitor notifications are enabled;
  maintenance is clear, admissions remain enabled, and no incidents are active.
- Existing records preserved: 35 recording metadata entries, 85 question entries.
- DingTalk application version `1.0.10` is `RELEASE`; `Premium.Ding.Write` is
  authorized. Robot configuration was read back as `ONLINE`.

## DING receipts

Two clearly labeled test notifications were generated from an isolated SQLite
state store and sent through the production application credentials. Both
received successful business receipts with no failed recipient entry:

| Notification | openDingId |
| --- | --- |
| Simulated memory warning | `A282067C6B8E3E0A887857C9A81C8D40` |
| Simulated recovery | `745A32C525A64BEFA72E91FDEC9CC29D` |

These are API acceptance receipts, not claims that the user has read the DINGs.
No synthetic alert state was added to the production monitor database.

## Verification

- All 88 tests in the isolated production-based package passed locally and on
  production Node 22.23.2, including real media processing with synthetic users
  and deterministic upstream substitutes.
- After the concurrent workspace changes settled, all 94 workspace tests passed.
- Monitor coverage includes thresholds, dwell times, hysteresis, escalation,
  deduplication, maintenance expiry, interrupted sampling, missing metrics,
  restart recovery, unknown delivery, rate limits, permission/quota failures,
  recipient failure and authenticated administrator access.
- Desktop 1440x1000 and mobile 390x844 browser checks passed with zero script
  errors and no horizontal overflow. Critical alerts and unknown delivery are
  visible in the existing admin layout.
- `node --check server.js`, browser syntax checks, shell syntax checks and
  `git diff --check` passed.
- Actual procfs/systemd/cgroup/queue collection returned no errors.
- 100 authenticated monitor API reads: p95 3.45 ms on localhost. This measures
  lightweight monitoring overhead, not a new simultaneous-submission benchmark.
- Monitor cgroup memory approximately 14.3 MiB, zero unexpected restarts.

## Backup and maintenance

The first production maintenance check exposed tar directory-change detection
caused by SQLite reader WAL lifecycle changes. The fix snapshots both the queue
and monitor through SQLite's online backup API and archives root children while
retaining file-content change checks.

The revised encrypted backup/restore test passed on macOS and Linux. It restores
accepted queue jobs, original media, monitor state and sent-event receipts into
isolated storage, using a synthetic age identity.

Full production maintenance then succeeded at 17:58:11. While both web and worker
were inactive, the monitor remained active. Services restarted automatically,
the maintenance marker cleared, and no DING was generated for planned downtime.

Production backup:
`/opt/englisheval/backups/recordings-20260907T095803Z.tar.gz.age`

The encrypted archive checksum passed. The real production archive was not
decrypted on the production server; its private age identity stays offline.

## Limits

On-host monitoring cannot immediately notify during a complete host outage or
outbound network failure. A monitoring interruption is reported after sampling
resumes. Ambiguous DING delivery is deliberately not retried automatically.

The current release includes the successful backup fix. The intermediate release
`20260907T095127Z-local` should not be used as a rollback target because its
maintenance backup can fail while the monitor is reading SQLite.

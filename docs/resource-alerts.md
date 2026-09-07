# Resource alerts

The independent `englisheval-monitor.service` samples every 30 seconds, using the
production Node runtime (22.16 or newer), procfs, cgroup v2, systemd and a read-only
queue connection. It remains active when the web and worker services stop.

Configuration lives in `/opt/englisheval/shared/monitor.env`. Install from
`ops/monitor.env.example`; enable `DINGTALK_ALERTS_ENABLED=true` only after the two
labeled smoke-test DINGs have valid receipts. The application credentials stay in
the existing shared environment files; never copy development credentials.

The recipient is Wu Yanbiao (`175239469`). The EnglishEval application and its
configured robot code are `dingavwautp9mpbbcshm`. Only in-app DING is used.

| Metric | Warning | Critical | Recovery |
| --- | --- | --- | --- |
| Data/backup disk | 80% used or <10 GiB after reservations, 2 min | 90% or below admission reserve, immediate | <75% and >12 GiB |
| Host available memory | <768 MiB, 2 min | <512 MiB, 30 sec | >1 GiB |
| Service memory | 80% of MemoryMax, 2 min | 95%, 30 sec; OOM immediate | <70%, no new OOM |
| Host CPU | 90%, 5 min | 97% and health request >1 sec, 5 min | <80% |
| Waiting room | 160 users, 2 min | 200 users, 30 sec | <140 users |
| Upstream circuit | Open for 2 min | n/a | Closed |
| Web/worker/queue read/expired heartbeat | n/a | Unavailable for 60 sec | Available |

All recovery conditions must remain true for three minutes. Disk mounts are
deduplicated. The data mount reserves 512 MiB per outstanding submission plus the
existing 5 GiB and next-admission reserve. Fifty admitted sessions is normal.
Missing measurements cannot clear an incident. A sampling gap over 90 seconds
produces an interruption notification when monitoring resumes.

Alerts notify once per incident and once per severity escalation, then once on
recovery. There are no periodic reminders. State and receipts are durable in
`recordings/monitor/alerts.sqlite`. Delivery is marked in-flight before sending;
an interrupted or uncertain delivery becomes `unknown` and is not replayed.
Explicit rate-limit rejections retry at `Retry-After` plus jitter, at most three
attempts. Other rejections stay visible as `failed`. No learner data, tokens,
application secrets or raw provider error messages enter alert metrics.

`GET /api/admin/monitor` and the Resource alerts area on `/admin` require both a
DingTalk session and the existing separate administrator token. The response
includes monitor staleness, notification enablement, current alerts and recent
delivery states. Unknown/failed deliveries require operator investigation; the
monitor deliberately offers no automatic resend for ambiguous outcomes.

## Operations

```sh
APP_ROOT=/opt/englisheval/current node scripts/monitor-control.js status
APP_ROOT=/opt/englisheval/current node scripts/monitor-control.js maintenance 30
APP_ROOT=/opt/englisheval/current node scripts/monitor-control.js resume
```

Maintenance markers expire after at most 120 minutes. Deployment marks a
30-minute window and backup maintenance a 120-minute window; only expected
service/health/queue-availability alerts are suppressed. Host pressure remains
monitored. Maintenance has a 110-minute timeout and restarts the application even
on failure. No monitor action deletes recordings, stops evaluations or changes
admission controls.

Backups exclude live monitor and queue WAL files and use SQLite's online backup
API to add `recordings/monitor-backup.sqlite` and `recordings/queue-backup.sqlite`
to the encrypted archive. The restore script places them at
`recordings/monitor/alerts.sqlite` and `recordings/queue.sqlite` in an empty
restore destination. The archive enumerates root children rather than archiving
the changing root directory header; file-content changes still fail the backup.
Stop the monitor before replacing its restored state. Never copy a live SQLite
database without its WAL. Receipted incidents survive backup/restore.

The monitor is restored by deploying its versioned code and systemd unit, keeping
`shared/monitor.env` and the original application environment. A rollback to a
release without `monitor.js` stops monitoring while preserving its state; redeploy
the monitor-compatible release to restore alerts. The earlier evaluation queue
continues to work independently.

A host power loss or loss of outbound connectivity prevents immediate DING
delivery. After sampling resumes an interruption is reported. Remote-host outage
alerting would require a separate external monitor.

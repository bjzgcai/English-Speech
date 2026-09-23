# Weekly page-visit digest

Every **Wednesday at 09:30 Asia/Shanghai** the host sends one DingTalk group
robot message containing the previous **seven China local calendar days**
(Wednesday through Tuesday) of page-visit statistics. The digest runs from
`englisheval-weekly-analytics.timer`, which is independent of the web service: a
stopped, restarting or overloaded application cannot skip it, and a failed
digest never blocks product traffic.

## What is reported

`scripts/weekly-analytics-ding.js` aggregates the same first-party events the
`/admin` statistics API reads (`analytics/events.jsonl`) and renders:

- page views (PV), unique visitors (UV) and first-time visitors across the full
  seven-day period;
- logged-in page views and visitors, split by how the visitor signed in —
  DingTalk sign-in (`钉钉登录`) or a redeemed invitation code (`邀请码登录`);
- a PV breakdown per tracked page (`/game`, `/examine`, `/leaderboard`,
  `/history`, `/intro`, `/prepare`);
- finished evaluations per page (`/game`, `/examine`), as a count of runs and a
  count of distinct people;
- counts for the other instrumented events (`examine_*`, `game_*`,
  `privacy_accept`, `invite_*`), aggregated over the full period.

## Logged-in visitors

The `登录用户：` block reports PV/UV for signed-in visitors only, and splits them
by sign-in method. Anonymous page views are counted in the headline PV/UV and in
neither of the two lines below it, so the block never sums back to the headline.

- Every tracked event records `identity` (`dingtalk`, `guest`, or empty) and a
  `userHash` — the SHA-256 of the owner's `openId`, never the openId itself.
- Page views are tracked in middleware that runs before any route resolves the
  session, so `analyticsIdentity()` in `src/app.js` reads the same signed session
  and guest cookies the visitor middleware reads. It sets no response headers, so
  a tracked page view cannot change what the browser caches.
- UV counts distinct `userHash` values, not the analytics cookie, so one person
  signed in on two browsers counts once. The DingTalk and invitation namespaces
  cannot collide (`guest:<uuid>` owners vs. real openIds), so the total is their
  sum.
- The block is part of the fixed head of the message, so the degradation ladder
  (full page list → fewer pages → event breakdown dropped) never removes it.
- `identity` and `userHash` are recorded from this version onward. Events written
  before it have an empty `identity` and count as anonymous, so the first weeks
  after deployment under-report logged-in traffic.

## Finished evaluations

The `评价完成：` section comes from `recordings/metadata.jsonl`, not from the
events, because a saved answer is the only place the outcome is recorded.

- It counts a saved answer once its `evaluation.status` is `completed`. A run
  that ended in `failed` or `skipped` did not finish an evaluation, and is
  counted in neither number.
- The time is taken from `finishedAt` — the moment the answer and its evaluation
  were persisted — using the same China local boundary as the page views.
  Counts and distinct people cover the full seven-day period.
- **`/game` vs `/examine`**: both pages generate a question, record, and save
  through one pipeline (`POST /api/save-answer`), so the answer does not name
  its page. The weekly game persists its question with a `challengeId` and
  `model: "weekly-fixed-topic"`; an examine question never has one. That marker
  is the entire attribution rule, so a change to the game question shape breaks
  the split — `test/analytics.test.js` pins it.
- `people` counts distinct `openId` across the period, so one person answering
  three times counts as one. Guests are keyed by their `guest:<uuid>` openId
  like any other owner.

An unreadable or empty recordings file is reported as `无评价记录数据` rather
than as a quiet zero, because the file is created on boot and only something
broken leaves it empty.

The per-page evaluation counts are *not* derived from `game_complete` /
`examine_complete`. Those events are emitted by the browser after a successful
`POST /api/evaluate-video`, which is the standalone upload path used by
`/methodology`; `/game` and `/examine` save with a `questionId` and therefore
never emit them.

The period is seven **China local calendar days** (`00:00`-`24:00` UTC+8), ending
on the Tuesday before the Wednesday send. Event timestamps are stored as UTC, so
the UTC date sharing the same digits is **not** the reported local date — it
would drop 00:00-08:00 local and pull in the next day's small hours.
`localDay()` and `previousWeek()` in `src/analytics.js` draw the boundaries and
`test/analytics.test.js` pins the behaviour.

A period with no events is reported as such ("统计周期内埋点无数据") rather than
being silently skipped, so a broken collector is visible in the message itself.

## Recipient and credentials

| Variable | Purpose |
| --- | --- |
| `DINGTALK_GROUP_WEBHOOK_URL` | HTTPS webhook of the 英语能力智能体 group robot |

Only the group robot webhook is used. The URL contains a secret token: keep it
in the production shared environment, never in Git, logs, docs, or shell
history. The message is capped at 500 characters, so it degrades in a fixed
order (full page list → fewer pages → the event breakdown dropped) instead of
being rejected.

## Operations

```sh
# Render the latest seven-day period without sending anything.
APP_ROOT=/srv/englisheval/current node scripts/weekly-analytics-ding.js --dry-run

# Re-render a specific seven-day period, still without sending.
node scripts/weekly-analytics-ding.js --dry-run --start=2026-09-16 --end=2026-09-22

systemctl list-timers englisheval-weekly-analytics.timer
journalctl -u englisheval-weekly-analytics.service -n 20
```

Each run logs one JSON line (`startDate`, `endDate`, `pv`, `uv`, `newUsers`,
`evaluations`, `evaluationsIntegrity`, `dataIntegrity`, `delivery`, `code`). It
never logs the message body or webhook token. A delivery that does not succeed
exits non-zero. Explicit rate limits and transient network failures are retried
up to three times, 30 s and 60 s apart. `Persistent=true` on the timer replays a
run missed while the host was down; it does not deduplicate successful manual
reruns, so use `--dry-run` unless a resend is intended.

## Storage

`analytics/` is production data and therefore lives in `shared/analytics`, is
symlinked into each release, and is excluded from the deploy rsync exactly like
`recordings/` and `questions/`. It is **not** uploaded from a developer
checkout, so local test events never reach production. The events file grows
without bound today; rotation is not implemented.

Every systemd unit that loads `src/config.js` needs `shared/analytics` in
`ReadWritePaths`, because `config.js` creates and chmods each data directory at
require time and `ProtectSystem=strict` makes everything else read-only. Adding
a data directory without that entry makes the service **fail to start** rather
than merely lose events. The digest also reads `shared/recordings` for the
saved-answer records; that path is already in `ReadWritePaths` for the web and
worker services, and removing it would make the evaluation section read as an
empty file.

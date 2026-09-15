# Daily page-visit digest

Every day at **09:30 Asia/Shanghai** the host sends one in-app DingTalk DING
containing the **previous China local day's** page-visit statistics. The digest
runs from `englisheval-daily-analytics.timer`, which is independent of the web
service: a stopped, restarting or overloaded application cannot skip it, and a
failed digest never blocks product traffic.

## What is reported

`scripts/daily-analytics-ding.js` aggregates the same first-party events the
`/admin` statistics API reads (`analytics/events.jsonl`) and renders:

- page views (PV), unique visitors (UV) and first-time visitors for the day;
- a PV breakdown per tracked page (`/game`, `/examine`, `/leaderboard`,
  `/history`, `/intro`, `/prepare`);
- finished evaluations per page (`/game`, `/examine`), as a count of runs and a
  count of distinct people;
- counts for the other instrumented events (`examine_*`, `game_*`,
  `privacy_accept`, `invite_*`).

## Finished evaluations

The `评价完成：` section comes from `recordings/metadata.jsonl`, not from the
events, because a saved answer is the only place the outcome is recorded.

- It counts a saved answer once its `evaluation.status` is `completed`. A run
  that ended in `failed` or `skipped` did not finish an evaluation, and is
  counted in neither number.
- The day is taken from `finishedAt` — the moment the answer and its evaluation
  were persisted — using the same China local boundary as the page views.
- **`/game` vs `/examine`**: both pages generate a question, record, and save
  through one pipeline (`POST /api/save-answer`), so the answer does not name
  its page. The weekly game persists its question with a `challengeId` and
  `model: "weekly-fixed-topic"`; an examine question never has one. That marker
  is the entire attribution rule, so a change to the game question shape breaks
  the split — `test/analytics.test.js` pins it.
- `people` counts distinct `openId`, so one person answering three times counts
  as one. Guests are keyed by their `guest:<uuid>` openId like any other owner.

An unreadable or empty recordings file is reported as `无评价记录数据` rather
than as a quiet zero, because the file is created on boot and only something
broken leaves it empty.

The per-page evaluation counts are *not* derived from `game_complete` /
`examine_complete`. Those events are emitted by the browser after a successful
`POST /api/evaluate-video`, which is the standalone upload path used by
`/methodology`; `/game` and `/examine` save with a `questionId` and therefore
never emit them.

The day is a **China local calendar day** (`00:00`-`24:00` UTC+8). Event
timestamps are stored as UTC, so the UTC day sharing the same digits is *not*
the reported day — it would drop 00:00-08:00 local and pull in the next day's
small hours. `localDay()` / `previousDay()` in `src/analytics.js` draw the
boundaries and `test/analytics.test.js` pins the behaviour at 15:59Z/16:00Z.

A day with no events is reported as such ("当日埋点无数据") rather than being
silently skipped, so a broken collector is visible in the message itself.

## Recipient and credentials

| Variable | Purpose |
| --- | --- |
| `DINGTALK_DIGEST_ROBOT_CODE` | Robot that sends the digest; falls back to `DINGTALK_ALERT_ROBOT_CODE` |
| `DINGTALK_DIGEST_USER_ID` | DingTalk `userId` of the recipient; falls back to `DINGTALK_ALERT_USER_ID` |
| `DINGTALK_CLIENT_ID` / `DINGTALK_CLIENT_SECRET` | Shared application credentials used to obtain the access token |

Only in-app DING is used, through the same `DingSender` the resource alerts use.
Set both optional overrides only when the digest should reach someone other than
the resource-alert recipient. The DING body is capped at 500 characters by the
DingTalk API, so the message degrades in a fixed order (full page list → fewer
pages → the event breakdown dropped) instead of being rejected.

## Operations

```sh
# Render yesterday's digest without sending anything.
APP_ROOT=/srv/englisheval/current node scripts/daily-analytics-ding.js --dry-run

# Re-render a specific day, still without sending.
node scripts/daily-analytics-ding.js --dry-run --date=2026-09-13

systemctl list-timers englisheval-daily-analytics.timer
journalctl -u englisheval-daily-analytics.service -n 20
```

Each run logs one JSON line (`date`, `pv`, `uv`, `newUsers`, `evaluations`,
`evaluationsIntegrity`, `dataIntegrity`, `delivery`, `code`). It never logs the
DING body or a credential. A delivery
that does not succeed exits non-zero — `credentials_missing` means the robot
code or recipient is unset, `recipient_failed` means the DING was rejected for
that `userId`. Explicit rate limits are retried up to three times, 30 s and 60 s
apart. `Persistent=true` on the timer replays a run missed while the host was
down; a message is never sent twice for the same day.

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

# Project Review and Integration Validation

Reviewed baseline: `c352a40`. Changes are local and have not been deployed.

## Findings and Fixes

| Priority | Finding | Trigger and impact | Fix |
| --- | --- | --- | --- |
| P1 | Automatic publication of member videos | A completed standalone upload entered the anonymous gallery, video and poster endpoints without separate publication consent, contrary to the privacy policy. | Require explicit per-upload public sharing consent; default all absent flags to private. Preserve owner playback. Guests cannot publish. |
| P1 | Media manifests accepted as uploads | A file named MP4 containing an FFconcat manifest successfully opened another server-side media file. MIME validation did not constrain FFprobe's format detection. | Restrict both probing and normalization to supported local containers and file/pipe protocols. Reject playlist demuxers even when media metadata is already supplied. |
| P1 | Durable uploads bypassed owner quotas | Queue routes were registered before synchronous handlers and omitted their attempt/video quota middleware. A saved question could be reused after 100 attempts; standalone uploads could exceed 10 videos. Completed jobs awaiting JSONL projection were also absent from quota counts. | Apply quotas before acquiring upload permits; count durable results without duplicate counting and preserve accepted-submission idempotency. Stop automatic client retries on a permanent quota rejection. |
| P2 | Comment moderation never applied reliably | The model call omitted the required resource kind. Even a blocked verdict only appended a second JSONL version, while the original public version remained visible. | Use the shared guarded question-model budget and resolve the latest comment version before listing or accepting replies. |
| P2 | Existing and in-app sessions could not manage invitations | Signed sessions lacking `identityType` passed authentication but failed the invitation gate with HTTP 403. | Normalize authenticated non-guest sessions to the DingTalk identity type after signature and ownership checks. |
| P2 | Eight configured pipelines only ran four jobs | `WORKER_CONCURRENCY=8` was advertised by the worker and estimates, but `Queue.claim()` retained a hardcoded cap of four. | Use the validated configured pipeline limit when claiming jobs. |

Five new regression scenarios initially failed against the reviewed implementation.
The public-media and eight-pipeline scenarios were separately reproduced before their
fixes. All now pass. Dependency auditing also found the transitive `qs` advisories
GHSA-x5fp-wj9c-mxmx and GHSA-4mjr-xmp4-gh2g; the lockfile now resolves `qs` 6.16.0.

## Coverage

The review covered authentication and identity ownership, invitation redemption,
privacy consent, question persistence, upload validation, cancellation, durable queue
admission and recovery, FFmpeg preparation, ASR and scoring, model budgets, history,
public and partner APIs, comments, ratings, leaderboard, administration, resource
monitoring, deployment configuration, retention and encrypted recording backups.

Validation completed:

- `npm test`: 132 passed, zero failed or skipped, including real FFmpeg processing,
  local HTTP model fixtures, separate web/worker processes, worker termination and
  checkpoint recovery, private playback, encrypted backup restoration, and quota
  and media-security regressions.
- `npm run test:browser`: passed at 1440x1000 and 390x844, with zero browser errors
  and 24 screenshots. Covered invitation access, privacy acknowledgement, generated
  questions, camera/microphone recording, durable upload, scoring, image download,
  history playback, weekly challenge and leaderboard, standalone upload, comments,
  ratings, identity alias, interrupted device tracks, and explicitly shared gallery
  playback. Eight ASR and eight scoring calls used local synthetic upstreams.
- `node scripts/guest-browser-check.js`: desktop/mobile identity changes during
  recording, browser draft recovery, stale-owner rejection, and logout restoration.
- `node scripts/access-browser-check.js`: desktop/mobile public access, access
  dialogs, single-use invitation redemption, private-history gating, and session
  failure handling.
- `npm audit --omit=dev`: zero reported vulnerabilities after the lockfile update.
- Server and edited browser syntax checks, deployment shell syntax, and
  `git diff --check`: passed.

Playwright is now a development dependency and `npm run test:browser` is a repeatable
integration entry point. The previous full-browser script was updated to redeem an
invitation before entering the private evaluation flow.

## Limits and Operational Notes

- No production deployment, production writes, data migration, real notifications,
  live DingTalk sign-in, or paid/external model requests were performed. External
  credentials, current service availability and linguistic scoring accuracy were
  not validated by synthetic model responses.
- Browser recording used synthetic camera/microphone devices and short recordings;
  this run did not wait for the optional real two-minute browser cutoff. Media
  duration limiting is covered by automated FFmpeg tests.
- Review and tests reduce risk but cannot establish that every possible bug is
  absent. Production HTTPS/systemd behavior was reviewed from configuration and
  was not redeployed or exercised on the production host.
- On deployment, old standalone records without explicit sharing consent disappear
  from the public gallery while remaining available in owner history. No persisted
  record is modified or deleted by this change. Previously downloaded or cached
  public media cannot be recalled by an application update.
- Comment moderation remains asynchronous: pending comments are visible, and an
  unavailable moderation service leaves them pending. This review fixes execution
  and blocked-version handling; it does not introduce pre-publication approval.
- Recording backups cover the recording tree and queue snapshots. Other shared
  trees (questions, consents, invitations, comments and ratings) need a separate
  backup policy for full-host disaster recovery; the recording restore test does
  not establish full-application recovery.

# OScanner-Eng Agent Guide

## Production safety

- Production deployment details are maintained outside this public repository.
- Obtain production paths and environment locations from the private local deployment configuration. Preserve the original production environment.
- Never copy `.env.local` or local DingTalk credentials to production.
- Treat `recordings/` and `questions/` as persistent user data. Do not delete, replace, or migrate them unless the user explicitly requests it.
- Review the private local `deploy.sh` before deployment. Deployment scripts and `ops/` are excluded from Git; keep server-specific details there.

## Local development

- Install dependencies with `npm install` and run development mode with `npm run dev`.
- The local app is normally available at `http://localhost:3199` when `PORT=3199` is set in `.env`.
- `.env` contains the baseline/original environment. `.env.local` contains ignored local-development overrides and is loaded only when `NODE_ENV` is not `production`.
- Keep all secrets out of committed files, logs, documentation, and responses. Both `.env` and `.env.local` must remain gitignored.

## Project map

- `server.js`: minimal process entry point and graceful shutdown handling.
- `src/app.js`: Express app, DingTalk OAuth/session handling, question generation, uploads, evaluation, and history APIs.
- `public/`: browser UI and static assets.
- `questions/metadata.jsonl`: persistent generated-question records.
- `recordings/`: persistent answer metadata, videos, and extracted evaluation artifacts.
- `analytics/events.jsonl`: page/event beacon log, throttled per client address on
  `POST /api/analytics/events` and pruned to `ANALYTICS_EVENTS_RETENTION_DAYS` (default 180) by the
  web process. `recordings/queue.sqlite` terminal jobs are pruned after 7 days by the worker's
  hourly pass (jobs must reach `projected=1` first; `question:*` settings rows follow their jobs).
- `deploy.sh`: versioned rsync/SSH deployment with shared production data and environment files.
- Nightly maintenance (`scripts/maintain-recordings.sh`) runs the encrypted backup, recording
  retention, and `scripts/sweep-orphaned-uploads.js` (crash-orphaned pending uploads and
  `*.tmp` rewrite leftovers older than 24 h). The unit's shape is gated by `RECORDING_BACKUP_ENABLED`
  (read by `deploy.sh` from the shared env when it generates the systemd unit): `true` (default)
  keeps the stop-the-world backup window — the only reason the app restarts at night; `false`
  installs a no-stop unit that runs retention and the sweep with the app live, so deploys are the
  only restarts. Set `BACKUP_OFFLOAD_COMMAND` in the shared env to copy each encrypted archive
  off-host (the archive and the recordings otherwise share one disk); it receives the archive path
  and its `.sha256` path as arguments.

## Critical workflows to preserve

### Authentication, question generation, and answers

- DingTalk OAuth must retain nonce-protected state, safe local redirects, a signed HTTP-only session, and `openId` as the ownership key.
- Organization enrichment (`userId`, `jobNumber`, `email`, and `orgEmail`) is optional. A lookup failure must not prevent authentication when DingTalk supplied a valid `openId`.
- Keep question generation behind both `requireAuth` and the current versioned privacy consent. Never trust a client-supplied candidate name over the authenticated DingTalk name.
- Persist every generated or fallback question with its owner before recording. `POST /api/save-answer` must only accept a `questionId` owned by the authenticated `openId`.
- Preserve the browser flow: authenticate, accept privacy terms, generate a question, prepare, record camera and microphone, finish/upload, evaluate, and show owner-filtered history.
- Keep the 3:30 recording/evaluation limit for browser-recorded Game and Examine answers (standalone uploads remain at 2:00), and reject uploads interrupted by a required camera or microphone track. Validate accepted media and normalize stored recordings to MP4.
- Save the recording even if downstream evaluation fails, recording the evaluation failure in metadata rather than losing the user's answer.
- Keep recording history and video access filtered by the signed-in `openId`; never publicly serve the recordings directory.

### Invitation share link

- `/invitation-codes` is limited to DingTalk administrators in `INVITER_OPEN_IDS` when that stable-ID
  allow-list is configured; otherwise the display-name fallback is 吴衍标, 邹欣, 王旭东, 符积高. The page route,
  every management API, and the header link all use the same `hasInvitationAdminAccess` gate.
- A legacy single-use code creates one account. A shared QR campaign creates one stable campaign code and up
  to the administrator-selected `max_uses` (maximum 9,999) independent `campaign-account` records, each with
  its own personal code. Duplicate names are allowed; the personal code is the account key. Campaign seat
  allocation and the capacity check happen under the invitations JSONL file lock.
- `start_time` and `end_time` gate only new campaign registrations. `start_time` is inclusive and
  `end_time` exclusive; personal codes continue to restore existing accounts after the campaign ends.
- A shareable link is `<share-service-url>/invite#code=<CODE>`. Personal login links add `&name=<NAME>` and
  auto-sign the holder into that account. All credentials ride in the fragment so they never reach server
  logs or the `Referer` header. `invitationShareUrl(req, code, name?)` in `src/app.js` is the single source
  of both URLs, used by QR routes, create/list responses, the administrator account list, and
  `GET /api/me/login-link`.
- Invitation records may carry `gameGroup`; campaign-account codes inherit it, and the shared 山东大学
  campaign code `1B5190BE4F1F` resolves to `g3` so its invite links land on `/game?group=g3`.
- The campaign QR payload and copied campaign link must stay byte-identical, or a scan and a paste would stop
  being interchangeable. `test/invitation.test.js` asserts QR bytes and the 200-seat concurrency boundary
  against `APP_BASE_URL`.
- Opening the link must land on the invitation path only. `VisitorSession.ensureAccess` hides the DingTalk
  sign-in whenever `window.__invitationCode` is set (or `invitationOnly` is passed), prefills code/name, and
  shows an explainer instead of the "or use an invitation code" divider. Every other entry point keeps
  offering DingTalk — do not hide it globally.
- `public/invite.js` strips the fragment with `replaceState` once code/name are in memory. A code-only link
  asks for a name; a personal code+name link redeems immediately and falls back to the prefilled form if the
  link is invalid. Every invitation guest can click their displayed header name to copy the personal link;
  campaign creators can also retrieve it from the campaign's registered-learner list.

### Teacher console

- `/teacher` (page `public/teacher.html`, route in `src/routes/pages.js`) is limited to an allow-list:
  teacher openIds in `TEACHER_OPEN_IDS` (env, comma-separated) — plus, until any openId is enrolled, the
  DingTalk session names in `TEACHER_NAMES` (王旭东, 邹欣, 吴衍标, 高坤, 柳君丽, 胡辰, 何源, 董圣娇, 赵晨, 邹猛)
  as a transitional fallback — and guests who redeemed an invitation code in `TEACHER_INVITATION_CODES`
  (`B19B59975BC0`). `canAccessTeacher(user)` in `src/app.js` is the single gate; once `TEACHER_OPEN_IDS`
  is non-empty, display names no longer grant access (they are user-changeable in DingTalk), and each
  name-fallback login logs `[teacher-enroll]` with the openId to enroll. The page route redirects
  everyone else to `/leaderboard`, the APIs return 403, and `/api/me` exposes `teacherAccess` so the
  nav menu item (`data-teacher-link`) only renders for allow-listed sessions.
- The public `/leaderboard` never shows playback controls any more: `GET /api/game/leaderboard` always
  strips `answerId`/`mediaType`. Playback lives on `/teacher` via
  `GET /api/game/leaderboard-answers/:id/media|transcript`, gated by the same teacher allow-list.
- `/teacher` serves weekly standings per group (g1/g2/g3) with the best answer per learner, plus CSV export:
  `GET /api/teacher/export?group=&challengeId=` ("export current week") and `GET /api/teacher/export-all`
  (all groups, every week with completed answers). CSVs are UTF-8 with BOM, and cells starting with
  `=`, `+`, `-`, or `@` are apostrophe-prefixed so learner-controlled names cannot execute as Excel
  formulas (`csvCell`).
- The AI-suspicion flag is produced by `src/ai-detection.js`: a one-time background analysis of each
  learner's best answer, stored in `ai-detections/metadata.jsonl`. Any existing row — including a
  terminal `failed` one — suppresses re-enqueueing, so each answer is analyzed at most once. The verdict
  is surfaced as `aiSuspicious` on teacher entries and an ⚠ "疑似AI" icon before the score.
- Detection is acoustic-first: the request carries the recording (`recordings/artifacts/<id>/audio.mp3`,
  the same file the ASR stage sends off-server) as an `input_audio` part to `qwen/qwen3.8-omni-flash`
  via OpenRouter (`OPENROUTER_AUDIO_DETECTION_MODEL`), plus transcript, delivery metrics, and three
  sampled frames. Records without an audio artifact fall back to the transcript-only prompt over the
  internal-first gateway chain. Answers with ≥2 sibling takes of the same question get a precomputed
  delivery baseline; a take ≥15% faster than the learner's fastest other take injects a veto-proof
  FLAG RULE (breaths, fillers, or mouth-sync do not override it — a learner can mouth along while TTS
  plays). Reading the question aloud is explicitly normal behavior, never evidence of AI.
- When a learner deletes an answer from /history that was their best completed take for its
  challenge week, the delete route schedules a per-user debounced re-check (60s,
  `scheduleBestAnswerRedetection`) so the promoted second-best take gets its one-time detection;
  takes that already have a verdict are never re-analyzed.
- Detection runs in both the web process and the worker, with two safety valves: concurrent analyses
  per process are capped (`MAX_CONCURRENT_ANALYSES` — claims used to race ahead of the 2-slot model
  gate and OOM the process on a bulk re-enqueue), and a `processing` row whose claim is older than
  5 minutes is reclaimed after a process died mid-analysis (the once-only rule would otherwise
  suppress it forever — the cause of the 2026-10-13/14 manual requeue surgeries). The worker also
  wires `setModelQueue` so tick-time detection/moderation calls participate in the shared
  RPM/circuit guard tables.
- Detection is an inference, not proof: the UI must keep saying "possibly AI-generated"/"疑似" rather
  than asserting cheating, mirroring the pronunciation-scoring caveat above.

### Audio and evaluation

- Qwen ASR is used only for English audio-to-text transcription. It does not score the learner.
- Preserve this pipeline: extract mono 16 kHz audio with FFmpeg; reject missing/silent audio; transcribe with Qwen ASR; derive duration, silence, pauses, word count, and speaking rate; sample frames about every five seconds; then send the transcript, metrics, question/profile, rubric, and frames to the configured OpenRouter evaluation model.
- Preserve ordered chunk transcription for long audio, transient retries, and WAV/MP3 fallback for known Qwen input-format failures.
- Grammar, vocabulary, coherence, and relevance primarily come from transcript evidence; fluency uses pause/rate metrics; visual delivery uses frames and must be unavailable/reweighted for audio-only media.
- Pronunciation/intelligibility is currently an indirect inference from ASR reliability and intelligibility clues because the evaluator does not receive raw audio. Do not describe it as phoneme-level acoustic pronunciation scoring unless a dedicated audio-scoring stage is implemented.
- Evaluation output must remain normalized structured JSON using the versioned rubric, with dimension scores, feedback, overall score, summary, strengths, and improvements.

## Verification

- Use `npm run dev` for local runtime checks and `npm start` for the normal server command.
- Before finishing changes, run `node --check server.js` and any focused checks relevant to edited browser code.
- Preserve unrelated worktree changes; this repository may already contain user edits.

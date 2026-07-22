# OScanner-Eng

A local web app for generating English speaking questions from a candidate profile, recording the answer with the browser camera, and saving the video plus metadata on the server.

## Run

```bash
npm install
npm start
```

Open `http://localhost:3199`.

## Configuration

Copy `.env.example` to `.env`, then fill in the required credentials. Use
`.env.local` for local overrides and `.env.prod` for production overrides;
these three environment files are gitignored, while `.env.example` is safe to
commit.

The app reads the internal OpenAI-compatible model gateway settings from `.env`:

```bash
INTERNAL_LLM_API_KEY=...
INTERNAL_LLM_CHAT_COMPLETIONS_URL=https://llm.zgci.org/hub/v1/chat/completions
INTERNAL_LLM_TRANSCRIPTIONS_URL=https://llm.zgci.org/hub/v1/audio/transcriptions
INTERNAL_LLM_QUESTION_MODEL=glm
INTERNAL_LLM_TRANSCRIBE_MODEL=qwen-asr
OPENROUTER_API_KEY=your-openrouter-key
OPENROUTER_CHAT_COMPLETIONS_URL=https://openrouter.ai/api/v1/chat/completions
OPENROUTER_EVAL_MODEL=google/gemini-3.5-flash
EVAL_MAX_FRAMES=18
EVAL_REQUEST_TIMEOUT_MS=600000
```

DingTalk authentication is required before users can generate questions, save recordings, or view history:

```bash
DINGTALK_UNIFIED_APP_ID=...
DINGTALK_APP_KEY=...
DINGTALK_APP_SECRET=...
APP_BASE_URL=http://localhost:3199
SESSION_SECRET=...
COOKIE_SECURE=false
PARTNER_API_KEY=replace-with-a-long-random-secret
```

The DingTalk app callback URL must match `APP_BASE_URL` plus `/auth/dingtalk/callback`.
In production, `APP_BASE_URL` must use HTTPS and `COOKIE_SECURE` must be `true`.
Local HTTP development may set `COOKIE_SECURE=false`.

Recording protection and production maintenance use:

```bash
RECORDING_RETENTION_DAYS=0
BACKUP_RETENTION_DAYS=30
BACKUP_AGE_RECIPIENT=<public-age-recipient>
```

`RECORDING_RETENTION_DAYS=0` disables live-recording expiration, so videos and
their extracted evaluation artifacts are preserved indefinitely. Encrypted
backup snapshots expire independently according to `BACKUP_RETENTION_DAYS` (30
days by default).

The browser never receives API keys. Question generation goes through `POST /api/generate-question`.

## Core authentication, question, and answer workflow

This workflow is a core application contract and should be preserved when the
authentication, question-generation, recording, or evaluation code changes.

1. The browser checks `GET /api/me`. An unauthenticated user is sent to
   `GET /auth/dingtalk` with a safe local redirect path.
2. The server creates a nonce-protected OAuth state and redirects to DingTalk.
   At `/auth/dingtalk/callback`, it exchanges the authorization code, obtains
   the user's `openId`, optionally enriches the session with organization
   fields (`userId`, `jobNumber`, `email`, and `orgEmail`), and sets a signed,
   HTTP-only session cookie. Authentication can continue if optional
   organization enrichment fails, but it cannot continue without `openId`.
3. Before question generation, the authenticated user must accept both current
   privacy acknowledgements. Consent is versioned and persisted by `openId`.
4. The browser submits the candidate profile to
   `POST /api/generate-question`. The server replaces the submitted name with
   the authenticated DingTalk name, asks the configured internal chat model for
   a structured interview-style question, and persists the generated question
   with its owner and profile. If model generation fails, a persisted fallback
   question is returned with the error.
5. After a short preparation countdown, the browser records camera and
   microphone together with `MediaRecorder`. Recording stops when the user
   selects **Finish and save**, when the two-minute limit is reached, or when a
   required media device is interrupted. An interrupted incomplete recording is
   not uploaded.
6. The browser uploads the finalized recording and its `questionId` to
   `POST /api/save-answer`. The server rejects a missing question or a question
   not owned by the authenticated user's `openId`. Supported browser formats
   are validated and normalized to MP4 before durable storage.
7. Once the video is safely stored, the server runs the speech-evaluation
   workflow described below. Evaluation failure does not discard the answer:
   the recording and a failed evaluation status are still persisted.
8. The recording metadata, evaluation, and owned question reference are
   appended to `recordings/metadata.jsonl`. History and video requests are
   always filtered by the signed-in user's `openId`.

In compact form:

```text
DingTalk OAuth -> signed session -> versioned privacy consent
    -> generate and persist owned question -> prepare -> record answer
    -> verify owned question -> normalize and save video -> evaluate
    -> persist result -> show owner-filtered history
```

## Audio, transcript, and evaluation workflow

Qwen ASR is the transcription component; it does not assign evaluation scores.
The scoring model evaluates the transcript together with derived audio metrics,
the question and rubric, and sampled video frames.

```text
Recorded video
    -> validate media and limit evaluation to two minutes
    -> FFmpeg extracts mono 16 kHz audio
    -> reject missing, silent, or extremely quiet audio
    -> Qwen ASR transcribes English speech to text
       (long audio is processed in ordered chunks)
    -> FFmpeg derives duration, silence, pause, word-count, and speaking-rate metrics
    -> FFmpeg samples a video frame about every five seconds, up to EVAL_MAX_FRAMES
    -> Gemini receives the transcript, audio metrics, question/profile, rubric, and frames
    -> normalize and persist JSON scores, feedback, strengths, and improvements
```

The evaluator therefore uses different evidence for different dimensions:

- Grammar, vocabulary, coherence, and task relevance primarily use the transcript.
- Fluency and pacing use the transcript plus speaking-rate and pause metrics.
- Visual delivery uses sampled video frames. It is excluded and reweighted when
  usable audio exists but no video picture is available.
- Pronunciation/intelligibility is currently inferred from transcription
  reliability and intelligibility clues. The scoring model does not receive the
  original audio, so this is not a phoneme-level acoustic pronunciation test.

Both `INTERNAL_LLM_API_KEY` (transcription) and `OPENROUTER_API_KEY`
(evaluation) are required to complete evaluation. Qwen requests explicitly use
English and retry transient failures. Audio longer than the configured chunk
size (30 seconds by default, capped at 40) is split and transcribed in order;
known Qwen input-format failures trigger WAV/MP3 format fallback.

## Partner API

The read-only partner API exposes DingTalk user identity fields and speaking-assessment scores without exposing recorded videos, video paths, filenames, extracted audio, sampled frames, transcripts, raw audio metrics, or internal model metadata. Configure a separate integration secret as `PARTNER_API_KEY`; do not reuse the DingTalk app secret or session secret. Generate a strong key with `openssl rand -hex 32`, and expose the API only over HTTPS or a trusted private network.

Swagger UI is available at `/api-docs`, and the OpenAPI 3.0 specification is available at `/openapi.yaml`.

```bash
curl \
  -H "Authorization: Bearer $PARTNER_API_KEY" \
  "http://localhost:3199/api/v1/users?jobNumber=EMPLOYEE_NUMBER"

curl \
  -H "Authorization: Bearer $PARTNER_API_KEY" \
  "http://localhost:3199/api/v1/users/DINGTALK_USER_ID"

curl \
  -H "Authorization: Bearer $PARTNER_API_KEY" \
  "http://localhost:3199/api/v1/rubrics"
```

`GET /api/v1/users` supports exact, case-insensitive filters for `openId`, `userId`, `jobNumber` (or its `job_number` alias), `email`, and `orgEmail`, plus `limit` (maximum 200) and `offset`. User responses include both `jobNumber` and `job_number` with the same value. `GET /api/v1/users/{userId}` returns one exact DingTalk organization user ID match. `GET /api/v1/rubrics` returns the active versioned scoring standard, formula, score bands, weights, evidence, and interpretation guidance. Each evaluation response includes `rubricId` and `rubricVersion` so consumers can join scores to the correct standard. Existing records created before organization enrichment may have empty organization fields.

The partner endpoints also expose 28 deterministic roster-backed users, each with one completed mock evaluation, for integration testing. Their `jobNumber` values come from the roster's `工号` field, their `name` values come from `姓名`, and generated API identifiers start with `mock_`. Only those two roster fields are retained. The mocks are generated in memory and do not modify recording or question metadata.

Answer evaluation runs after `Finish and save` according to the audio,
transcript, and evaluation workflow above. The active rubric is:

| Dimension | Weight |
| --- | ---: |
| Pronunciation / intelligibility | 20% |
| Fluency | 10% |
| Grammar | 20% |
| Vocabulary | 15% |
| Coherence / task relevance | 25% |
| Visual delivery | 10% |

## Persistent storage and ownership

Generated questions are appended to `questions/metadata.jsonl` with the DingTalk OAuth `openId` and an organization user snapshot containing `userId`, `jobNumber`, `email`, and `orgEmail` when the organization contact API returns them. These fields are stored both at the record's top level and in its nested `user` object. Answer attempts are appended to `recordings/metadata.jsonl` with the same user fields plus the owned `questionId`. Attempts without a video are retained with `hasVideo: false` and a skipped evaluation; uploaded answer videos are stored in `recordings/` and use `hasVideo: true`.

The JSONL files and the video/artifact directories live on the server filesystem, so they survive application restarts. Privacy acknowledgements are stored separately in `consents/metadata.jsonl` by DingTalk `openId` and policy version. The current per-user leaderboard alias and actual-name/alias choice are stored in `recordings/leaderboard-identities.jsonl`, so changing either updates all leaderboard views without rewriting answer records. In production, these records live in raw persistent directories under `/opt/englisheval/shared`. If the app will run on multiple instances, migrate these records to a shared database/object store rather than relying on instance-local files.

History and video endpoints always filter by the signed-in DingTalk `openId`. The recordings directory is not publicly served. Application startup never deletes or migrates persistent records; any future migration must be run explicitly with a verified backup.

The production service applies a `0077` umask. Persistent directories are mode
`0700`, and data files are mode `0600`, limiting access to the service account.
The daily recording-maintenance unit briefly stops the application, creates an
encrypted backup, skips live-recording deletion when retention is disabled, and
starts the application again.

`openId` is scoped to this DingTalk application and remains the ownership key returned directly by the OAuth user-information endpoint. At sign-in, the server uses `unionId` to resolve the organization `userId`, queries DingTalk user details, and normalizes DingTalk's snake_case/camelCase response fields as `userId`, `jobNumber`, `email`, and `orgEmail`. This enrichment requires the application's organization-contact permission; if the lookup is unavailable, authentication continues with empty organization fields and the server logs a warning.

Browser support for direct MP4 recording varies. The app asks for MP4 first and records WebM when the browser does not support MP4 through `MediaRecorder`. Recordings are finalized as a single browser blob because timed MP4 chunks are not reliably concatenable across implementations. The server validates and transcodes every accepted upload to MP4 before storage.

Extracted audio and sampled frames are stored under `recordings/artifacts/`.

## Encrypted recording backups

Backups use [age](https://age-encryption.org/) public-key encryption. Generate
the key on a trusted administrator workstation, not on production:

```bash
age-keygen -o englisheval-backup-identity.txt
```

Keep that identity file offline and outside this repository. Copy only the
printed public recipient into production's original
`/opt/englisheval/shared/.env` as `BACKUP_AGE_RECIPIENT`. Never copy the identity
file or a local `.env` to production.

Production must have the `age` command installed. Deployment refuses to proceed
without `age`, an explicit non-negative retention setting, and a native age recipient. The
maintenance timer runs daily around 03:15 and writes encrypted snapshots to
`/opt/englisheval/backups`. It never creates a plaintext archive.

To test recovery, restore into a new empty staging directory rather than over
the live persistent data:

```bash
./scripts/restore-recordings-backup.sh \
  recordings-YYYYMMDDTHHMMSSZ.tar.gz.age \
  /secure/offline/englisheval-backup-identity.txt \
  /tmp/englisheval-restore-test
```

Verify the restored metadata and videos before considering any manual recovery.
The restore script deliberately refuses to write into a non-empty directory.

Live recordings are stored as raw files in
`/opt/englisheval/shared/recordings`. They are protected by service-account
ownership and restrictive filesystem permissions, but they are not encrypted
at rest. The encrypted backup archives remain the recovery mechanism for this
directory.

## Deploy

The included script deploys versioned releases over SSH, installs a systemd
service, and keeps `.env`, `.env.prod`, `recordings/`, `questions/`, `comments/`, and `consents/` in shared persistent
storage on the target host. `.env` contains settings shared by development and
production, while `.env.local` and `.env.prod` override environment-specific
values. Deployment never copies `.env.local`.

For the initial deployment and data migration:

```bash
./deploy.sh --migrate-data
```

For later code-only deployments:

```bash
./deploy.sh
```

Defaults target `ubuntu@10.1.130.9` and installs under `/opt/englisheval`.
The production `APP_BASE_URL` is read from the existing shared `.env.prod`.
Plain HTTP deployments must set `COOKIE_SECURE=false`; HTTPS deployments should
set it to `true`. Override `TARGET`, `REMOTE_ROOT`, `APP_PORT`, or
`SERVICE_NAME` in the command environment. The migration option deliberately
refuses to overwrite non-empty remote data.

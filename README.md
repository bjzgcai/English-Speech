# EnglishEval

A local web app for generating English speaking questions from a candidate profile, recording the answer with the browser camera, and saving the video plus metadata on the server.

## Run

```bash
npm install
npm start
```

Open `http://localhost:3199`.

## Configuration

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

Answer evaluation runs after `Finish and save`. The internal model gateway transcribes the audio,
then OpenRouter evaluates the transcript, audio metrics, and sampled video frames with Gemini 3.5 Flash.

The server extracts the full audio track, samples video frames at roughly one frame every five seconds capped by `EVAL_MAX_FRAMES`, then evaluates:

| Dimension | Weight |
| --- | ---: |
| Pronunciation / intelligibility | 25% |
| Fluency | 15% |
| Grammar | 20% |
| Vocabulary | 15% |
| Coherence / task relevance | 10% |
| Visual delivery | 15% |

## Persistent storage and ownership

Generated questions are appended to `questions/metadata.jsonl` with the DingTalk OAuth `openId` and an organization user snapshot containing `userId`, `jobNumber`, `email`, and `orgEmail` when the organization contact API returns them. These fields are stored both at the record's top level and in its nested `user` object. Answer attempts are appended to `recordings/metadata.jsonl` with the same user fields plus the owned `questionId`. Attempts without a video are retained with `hasVideo: false` and a skipped evaluation; uploaded answer videos are stored in `recordings/` and use `hasVideo: true`.

The JSONL files and the video/artifact directories live on the server filesystem, so they survive application restarts. Privacy acknowledgements are stored separately in `consents/metadata.jsonl` by DingTalk `openId` and policy version. In production, mount `recordings/`, `questions/`, and `consents/` on persistent storage. If the app will run on multiple instances, migrate these records to a shared database/object store rather than relying on instance-local files.

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

These encrypted archives protect backups, but the live recording volume should
also be encrypted. Production uses an 8 GB LUKS2 container at
`/opt/englisheval/recordings.luks`, mounted at the existing recordings path.
The binary unlock key remains on a protected administrator device and must
never be copied to the server or repository. Make a second offline copy of this
key; losing every copy permanently loses access to the live encrypted
recordings.

After a production reboot, unlock the recordings and start EnglishEval from the
administrator Mac:

```bash
LUKS_KEY_FILE=/secure/offline/path ./ops/unlock-production-recordings.sh
```

To stop the app and lock the recording volume deliberately:

```bash
./ops/lock-production-recordings.sh
```

The application and recording-maintenance services have mount conditions and
will not start against the empty underlying mountpoint. The server can boot and
accept SSH without the recording key; an administrator must run the unlock
script before EnglishEval becomes available.

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
`PUBLIC_BASE_URL` is required and must match the HTTP or HTTPS URL in
`.env.prod`. Plain HTTP deployments must set `COOKIE_SECURE=false`; HTTPS
deployments should set it to `true`. Override `TARGET`, `REMOTE_ROOT`,
`APP_PORT`, or `SERVICE_NAME` in the command environment. The migration option
deliberately refuses to overwrite non-empty remote data.

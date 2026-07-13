# EnglishEval

A local web app for generating English speaking questions from a candidate profile, recording the answer with the browser camera, and saving the video plus metadata on the server.

## Run

```bash
npm install
npm start
```

Open `http://localhost:3199`.

## Configuration

The app reads OpenRouter settings from `.env`:

```bash
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=deepseek/deepseek-v4-flash
OPENROUTER_TRANSCRIBE_MODEL=openai/gpt-4o-transcribe
OPENROUTER_EVAL_MODEL=google/gemini-3.5-flash
EVAL_MAX_FRAMES=18
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

Answer evaluation runs after `Finish and save` when OpenRouter settings are configured.

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

Both JSONL files and the video/artifact directories live on the server filesystem, so they survive application restarts. In production, mount `recordings/` and `questions/` on a persistent volume and include both in backups. If the app will run on multiple instances, migrate these records to a shared database/object store rather than relying on instance-local files.

History and video endpoints always filter by the signed-in DingTalk `openId`. The recordings directory is not publicly served. Application startup never deletes or migrates persistent records; any future migration must be run explicitly with a verified backup.

`openId` is scoped to this DingTalk application and remains the ownership key returned directly by the OAuth user-information endpoint. At sign-in, the server uses `unionId` to resolve the organization `userId`, queries DingTalk user details, and normalizes DingTalk's snake_case/camelCase response fields as `userId`, `jobNumber`, `email`, and `orgEmail`. This enrichment requires the application's organization-contact permission; if the lookup is unavailable, authentication continues with empty organization fields and the server logs a warning.

Browser support for direct MP4 recording varies. The app asks for MP4 first and records WebM when the browser does not support MP4 through `MediaRecorder`. Recordings are finalized as a single browser blob because timed MP4 chunks are not reliably concatenable across implementations. The server validates and transcodes every accepted upload to MP4 before storage.

Extracted audio and sampled frames are stored under `recordings/artifacts/`.

## Deploy

The included script deploys versioned releases over SSH, installs a systemd
service, and keeps `.env`, `recordings/`, and `questions/` in shared persistent
storage on the target host.

For the initial deployment and data migration:

```bash
./deploy.sh --migrate-data
```

For later code-only deployments:

```bash
./deploy.sh
```

Defaults target `ubuntu@10.1.130.9` and installs under `/opt/englisheval`.
`PUBLIC_BASE_URL` is required and must be the HTTPS URL exposed by a trusted TLS
reverse proxy; the production `.env` must use the same HTTPS `APP_BASE_URL` and
set `COOKIE_SECURE=true`. Override `TARGET`, `REMOTE_ROOT`, `APP_PORT`, or
`SERVICE_NAME` in the command environment. The migration option deliberately
refuses to overwrite non-empty remote data.

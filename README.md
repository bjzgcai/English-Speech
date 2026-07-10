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
```

The DingTalk app callback URL must match `APP_BASE_URL` plus `/auth/dingtalk/callback`.

The browser never receives API keys. Question generation goes through `POST /api/generate-question`.

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

Generated questions are appended to `questions/metadata.jsonl` with the DingTalk OAuth `openId`. Uploaded answer videos are stored in `recordings/`, and their metadata/evaluation is appended to `recordings/metadata.jsonl` with the same `openId` plus the owned `questionId`.

Both JSONL files and the video/artifact directories live on the server filesystem, so they survive application restarts. In production, mount `recordings/` and `questions/` on a persistent volume and include both in backups. If the app will run on multiple instances, migrate these records to a shared database/object store rather than relying on instance-local files.

History and video endpoints always filter by the signed-in DingTalk `openId`. The recordings directory is not publicly served. On startup, records, videos, evaluation artifacts, and questions without a DingTalk `openId` are deleted as legacy data.

`openId` is scoped to this DingTalk application and is the identifier returned directly by the OAuth user-information endpoint. `unionId` can correlate the same person across applications under the same developer, while an organization `userId` identifies an employee inside a specific DingTalk organization and generally requires an organization-aware lookup rather than this personal OAuth response.

Browser support for direct MP4 recording varies. The app asks for MP4 first and records WebM when the browser does not support MP4 through `MediaRecorder`. Recordings are finalized as a single browser blob because timed MP4 chunks are not reliably concatenable across implementations. The server uses bundled `ffmpeg-static` to convert non-MP4 uploads to MP4 for storage.

Extracted audio and sampled frames are stored under `recordings/artifacts/`.

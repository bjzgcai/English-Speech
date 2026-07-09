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

## Saved Files

Uploaded answer videos are stored in `recordings/`. Metadata is appended to `recordings/metadata.jsonl`.

Browser support for direct MP4 recording varies. The app asks for MP4 first and records WebM when the browser does not support MP4 through `MediaRecorder`. The server uses bundled `ffmpeg-static` to convert non-MP4 uploads to MP4 for storage.

Extracted audio and sampled frames are stored under `recordings/artifacts/`.

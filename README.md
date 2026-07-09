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
```

The browser never receives the API key. All LLM calls go through `POST /api/generate-question`.

## Saved Files

Uploaded answer videos are stored in `recordings/`. Metadata is appended to `recordings/metadata.jsonl`.

Browser support for direct MP4 recording varies. The app asks for MP4 first and records WebM when the browser does not support MP4 through `MediaRecorder`. The server uses bundled `ffmpeg-static` to convert non-MP4 uploads to MP4 for storage.

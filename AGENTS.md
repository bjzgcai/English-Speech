# OScanner-Eng Agent Guide

## Production safety

- `10.1.130.9` is the production server.
- Production runs from `/opt/englisheval` and uses the original production environment stored in `/opt/englisheval/shared/.env`.
- Never copy `.env.local` or local DingTalk credentials to production.
- Treat `recordings/` and `questions/` as persistent user data. Do not delete, replace, or migrate them unless the user explicitly requests it.
- Review `deploy.sh` before deployment. Its default SSH target is `ubuntu@10.1.130.9` and its default public URL is `http://10.1.130.9:3199`.

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
- `deploy.sh`: versioned rsync/SSH deployment with shared production data and environment files.

## Critical workflows to preserve

### Authentication, question generation, and answers

- DingTalk OAuth must retain nonce-protected state, safe local redirects, a signed HTTP-only session, and `openId` as the ownership key.
- Organization enrichment (`userId`, `jobNumber`, `email`, and `orgEmail`) is optional. A lookup failure must not prevent authentication when DingTalk supplied a valid `openId`.
- Keep question generation behind both `requireAuth` and the current versioned privacy consent. Never trust a client-supplied candidate name over the authenticated DingTalk name.
- Persist every generated or fallback question with its owner before recording. `POST /api/save-answer` must only accept a `questionId` owned by the authenticated `openId`.
- Preserve the browser flow: authenticate, accept privacy terms, generate a question, prepare, record camera and microphone, finish/upload, evaluate, and show owner-filtered history.
- Keep the two-minute recording/evaluation limit and reject uploads interrupted by a required camera or microphone track. Validate accepted media and normalize stored recordings to MP4.
- Save the recording even if downstream evaluation fails, recording the evaluation failure in metadata rather than losing the user's answer.
- Keep recording history and video access filtered by the signed-in `openId`; never publicly serve the recordings directory.

### Invitation share link

- An inviter copies a shareable link from `/invitation-codes` and sends it to the invitee. The link is
  `<share-service-url>/invite#code=<CODE>`; the code rides in the fragment so it never reaches the server
  logs or the `Referer` header. `invitationShareUrl(req, code)` in `src/app.js` is the single source of that
  URL and is used by the QR route, the create response, and the list response (`shareUrl` per record).
- The QR payload and the copied link must stay byte-identical, or a scan and a paste would stop being
  interchangeable. `test/invitation.test.js` asserts both against `APP_BASE_URL`.
- Opening the link must land on the invitation path only. `VisitorSession.ensureAccess` hides the DingTalk
  sign-in whenever `window.__invitationCode` is set (or `invitationOnly` is passed), prefills the code, focuses
  the name field, and shows an explainer instead of the "or use an invitation code" divider. Every other entry
  point keeps offering DingTalk — do not hide it globally.
- `public/invite.js` strips the fragment with `replaceState` once the code is in memory. A full page reload
  after that therefore arrives without a code and shows the ordinary dialog; the in-page "Enter invitation
  code" fallback still stays invitation-only.
- The link is offered for used codes too: the same guest recovers their identity on another browser by
  re-entering the name bound to the code.

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

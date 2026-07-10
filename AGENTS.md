# EnglishEval Agent Guide

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

- `server.js`: Express server, DingTalk OAuth/session handling, question generation, uploads, evaluation, and history APIs.
- `public/`: browser UI and static assets.
- `questions/metadata.jsonl`: persistent generated-question records.
- `recordings/`: persistent answer metadata, videos, and extracted evaluation artifacts.
- `deploy.sh`: versioned rsync/SSH deployment with shared production data and environment files.

## Verification

- Use `npm run dev` for local runtime checks and `npm start` for the normal server command.
- Before finishing changes, run `node --check server.js` and any focused checks relevant to edited browser code.
- Preserve unrelated worktree changes; this repository may already contain user edits.

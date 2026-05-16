# Lyrics Video Generator

A client-side React + Vite app that turns lyrics + music into animated karaoke-style videos with AI transcription support. Export as WebM or MP4.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, path `/api`)
- `pnpm --filter @workspace/lyrics-video run dev` — run the frontend (port 19575, path `/`)
- Required env: `DATABASE_URL` — Postgres connection string (auto-provisioned)
- Required env: `GEMINI_API_KEY` — for AI audio transcription (`/api/transcribe-audio`)
- Required env: `SESSION_SECRET` — for Express session

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Tailwind CSS v4 + Framer Motion + shadcn/ui + wavesurfer.js v7
- Backend: Express 5 (API server for transcription only)
- DB: PostgreSQL + Drizzle ORM (minimal, mostly stateless)
- Video export: WebCodecs API + mp4-muxer v5.2.2

## Where things live

- `artifacts/lyrics-video/src/App.tsx` — main app (~2000 lines), all UI logic, Layout B design
- `artifacts/lyrics-video/src/` — React components and pages
- `artifacts/api-server/src/routes/transcribe.ts` — AI transcription endpoint
- `artifacts/lyrics-video/vite.config.ts` — Vite config (reads PORT + BASE_PATH from env)

## Architecture

- Fully client-side app: lyrics, timeline, rendering all in-browser
- SM-2 spaced repetition not used (was for English AI Coach, removed)
- Video preview rendered to a canvas element, exported via WebCodecs + mp4-muxer
- `hardwareAcceleration: "prefer-software"` on VideoEncoder for sandbox compat
- AI transcription calls `/api/transcribe-audio` → Gemini API on the server
- `lv_customPrompt` localStorage key for custom transcription prompt
- BASE_PATH env controls Vite base URL (set to `/` in artifact.toml)

## Gotchas

- Always check BASE_PATH is `/` in `artifacts/lyrics-video/.replit-artifact/artifact.toml`
- WebCodecs codec: `avc1.42E01E` (software fallback), `avc1.4d0028` (hardware)
- MP4 export error shown inline in toolbar (exportError state)
- Never use console.log on server — use `req.log` or `logger`

## User preferences

- Dark mode default
- Vietnamese UI labels
- Blue + violet color palette
- Layout B: toolbar on top, sidebar left (lyrics/timeline), main center (video preview), audio player below video, style bar at bottom

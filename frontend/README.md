# ClipDetector frontend

This is the Next.js review interface for ClipDetector. It expects the FastAPI backend to be running at `http://localhost:8000`.

For full project and platform setup, see [the development guide](../docs/DEVELOPMENT.md).

## Install

```bash
npm ci
```

Node.js 20.9 or newer is required. `npm ci` uses the committed lockfile and removes stale packages from an older installation.

## Develop

Start the backend in another terminal, then run:

```bash
npm run dev
```

Open <http://localhost:3000>. Source pages live in `src/app/`, reusable components in `src/components/`, and browser-side API calls in `src/lib/api.ts`.

If the backend is not on `http://localhost:8000`, set `NEXT_PUBLIC_API_BASE_URL` before starting or building the frontend.

## Checks

```bash
npm run build
npm run lint
```

Both checks should complete without warnings or errors.

## Useful routes

- `/` contains the analysis form for downloaded VODs.
- `/vods` lists Twitch VODs and manages downloads.
- `/review` shows candidates from the latest analysis.
- `/clips` lists exported clips.

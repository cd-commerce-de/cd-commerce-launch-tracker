# CD Commerce — Launch Product 12-Week Tracker (backend edition)

This version fixes the two issues from the browser-only version:

1. **Shared data, not per-browser data.** Everyone who opens the dashboard sees the same numbers, because the data lives on the server (`data/db.json`), not in each person's `localStorage`.
2. **Upload happens on the backend.** The page just sends the file — all CSV parsing, column matching, validation, and week-matching math happens in `server.js`. The browser only renders whatever `/api/dashboard` hands it back.

It ships pre-loaded with the same 12-week sample data you saw in the Excel version (TSE01, "Toilet Seat Adults – D shape") so you can open it and see a working dashboard immediately — no upload required to try it out.

## Run it locally

```
cd backend
npm install
npm start
```

Open **http://localhost:3000** — the sample dashboard is already there.

## Project structure

```
backend/
  server.js         ← Express app: API routes + serves the frontend
  package.json
  data/db.json       ← the "database" (flat JSON file), pre-seeded with sample data
  public/index.html  ← the dashboard UI (fetches everything from /api/*)
```

## API

| Route | Method | What it does |
|---|---|---|
| `/api/products` | GET / POST | list / add a product |
| `/api/products/:asin` | PUT / DELETE | edit / remove a product |
| `/api/upload/sellerboard` | POST (multipart `file`) | parses + stores a Sellerboard CSV |
| `/api/upload/sellerfox` | POST (multipart `file`) | parses + stores a Sellerfox CSV |
| `/api/upload/products` | POST (multipart `file`) | bulk-add products from CSV |
| `/api/dashboard?asin=…&marketplace=…` | GET | the fully computed 12-week scorecard for one product |
| `/api/templates/:kind` | GET | downloadable CSV template (`sellerboard`/`sellerfox`/`products`) |
| `/api/export` | GET | full JSON backup of everything |
| `/api/import` | POST (JSON body) | restore from a backup |
| `/api/data` | DELETE | wipe everything |

## Deploying it so the whole team can use it

**Important:** this needs a place that keeps a Node process running and lets it write to disk. That rules out GitHub Pages (static-only) and plain Vercel (serverless functions have a *read-only, ephemeral* filesystem — `data/db.json` would reset on every cold start there).

Good options, easiest first:

- **Render** (free tier available): New → Web Service → connect this repo → Build command `npm install`, Start command `npm start`. Render gives it a persistent disk if you add one (Settings → Disks) — do that, mounted at `/data`, and point `DB_PATH` there so uploads survive redeploys.
- **Railway**: similar — connect repo, it auto-detects Node, add a volume for `/app/data`.
- **A small VPS / your own server**: `git clone`, `npm install`, `npm start` behind `pm2` or a systemd service, reverse-proxied by nginx.
- **Vercel, if you want to stay there**: keep the frontend on Vercel/GitHub Pages as static files, but swap the storage layer from the JSON file to something that survives serverless — Vercel Postgres, Vercel KV, or Supabase are the common choices. That's a genuine (small) rework of `loadDB`/`saveDB` in `server.js`, not a config toggle — say the word and I'll build that version.

Once deployed, everyone just opens the one URL — no separate installs, no per-browser data.

## CSV formats

Identical to the previous version — download the templates from the dashboard's toolbar, or `GET /api/templates/sellerboard` (`/sellerfox`, `/products`) directly. Header names don't have to match exactly; the backend recognizes common variants (e.g. "Advertising Cost" reads as Ad Spend).

## Notes

- Re-uploading a week's CSV overwrites just that week (matched on Parent ASIN + Week Start Date) — safe to re-upload corrections, verified with a test upload while building this.
- New products showing up in a Sellerboard/Sellerfox upload are auto-added to the Products list with a blank launch date — fill that in and their scorecard appears.
- This is still v1 in the sense that the *export step* from Sellerboard/Sellerfox is manual — someone still has to click "download CSV" in each tool and drop it in. Fully automating that would mean calling Sellerboard's and Sellerfox's own APIs from the backend on a schedule, which is a bigger, separate build (and needs API credentials from both tools) — worth doing once this version proves itself.

# CD Commerce — Launch Product 12-Week Tracker (Supabase + GitHub Pages)

Static dashboard (`index.html`) + a real Postgres database (Supabase) + three small
server-side functions that do the CSV parsing. Nothing here needs a server that has
to stay running — GitHub Pages just serves files, and Supabase manages the database.

## What's in this folder

```
index.html                          ← the dashboard (open this / host this)
config.js                           ← the ONLY file you edit: your Supabase URL + key
schema.sql                          ← run once in Supabase's SQL Editor
supabase/functions/
  _shared/utils.ts                  ← shared CSV-parsing helpers
  upload-sellerboard/index.ts       ← Edge Function: parses Sellerboard CSV → DB
  upload-sellerfox/index.ts         ← Edge Function: parses Sellerfox CSV → DB
  upload-products/index.ts         ← Edge Function: parses Products CSV → DB
```

## Setup — do this once

### 1. Create the Supabase project
1. Go to [supabase.com](https://supabase.com) → New project. Pick a name, a database password (save it), and a region close to your team.
2. Wait ~2 minutes for it to provision.

### 2. Create the tables
1. In the Supabase dashboard: **SQL Editor** → **New query**.
2. Paste the entire contents of `schema.sql` from this folder, click **Run**.
3. Check **Table Editor** — you should see `products`, `sellerboard_rows`, `sellerfox_rows`.

### 3. Deploy the three Edge Functions
You'll need the [Supabase CLI](https://supabase.com/docs/guides/cli) installed once:
```
npm install -g supabase
supabase login
```
Then, from **this folder**:
```
supabase link --project-ref YOUR-PROJECT-REF
supabase functions deploy upload-sellerboard
supabase functions deploy upload-sellerfox
supabase functions deploy upload-products
```
Your project ref is the random string in your project's URL: `https://<project-ref>.supabase.co`.

The Edge Functions need to know your database credentials — Supabase sets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` automatically as environment variables for every deployed function, so there's nothing extra to configure here.

### 4. Get your API keys
In the Supabase dashboard: **Settings → API**. You'll see:
- **Project URL** (`https://xxxx.supabase.co`)
- **anon / public key** (safe to expose in client-side code — that's what it's for)

### 5. Edit `config.js`
Open `config.js` in this folder and paste in those two values:
```js
window.SUPABASE_URL = 'https://xxxx.supabase.co';
window.SUPABASE_ANON_KEY = 'your-anon-public-key';
```

### 6. Push to GitHub and turn on Pages
1. Commit everything in this folder to your repo (same repo as before is fine — just replace the old files).
2. Repo → **Settings → Pages** → Source: deploy from branch → `main` / `(root)`.
3. Your dashboard is live at `https://<your-username>.github.io/<repo>/`.

That's it — no server to keep running, no persistent disk to configure, no monthly bill.

## Weekly workflow

1. Export the week's data from Sellerboard and Sellerfox as CSV (see column formats below).
2. Open the dashboard → **Upload & Manage** → drag in the two files.
3. The browser sends each file straight to its Edge Function, which parses it and writes to Postgres — nothing is processed or stored in the browser itself.
4. Everyone who opens the dashboard sees the update immediately — same database for the whole team.

## CSV formats

Same as before — column names don't have to match exactly (common variants like "Advertising Cost" are recognized as Ad Spend), but these columns need to be present in some form:

**Sellerboard:** Week Start Date, Marketplace, Tag, Parent ASIN / SKU, Product Name, Total Sales (€), Organic Sales (€), Ad Sales (€), Units Sold, Refund Units, Ad Spend (€), Net Profit (€)

**Sellerfox:** Week Start Date, Marketplace, Tag, Parent ASIN / SKU, Product Name, Sessions, Impressions, Clicks, Orders, Highest BSR

**Products:** Product Name, Parent ASIN / SKU, Tag, Marketplace, Launch Date

## Honest tradeoffs, worth knowing

- **Open by default.** The `anon` key is public by design (it's meant to sit in client-side code), and the current row-level-security policies let anyone with the dashboard URL read and edit the Products table. That's fine for a small trusted internal tool; if you ever want to restrict who can open it, Supabase Auth (magic-link email or Google sign-in) can be added on top without touching the schema — ask if you want that.
- **Free tier pauses after 7 days of total inactivity.** Since you're uploading weekly, this shouldn't bite — but if a week is ever skipped, the project may pause and need a manual "Resume" click in the Supabase dashboard (data is preserved, just offline until resumed). A free scheduled ping (e.g. a GitHub Action hitting the API every few days) can prevent this entirely if you want extra insurance — say the word and I'll add it.
- **This wasn't tested against a live Supabase project** the way the earlier Node version was tested against a live server — this sandbox can't reach supabase.co. The SQL, Edge Functions, and frontend all follow Supabase's documented patterns closely, but budget time for the first real run-through to catch anything project-specific (e.g. exact error messages, RLS edge cases).

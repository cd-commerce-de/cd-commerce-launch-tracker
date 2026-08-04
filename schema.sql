-- ============================================================
-- CD Commerce Launch Tracker — Supabase schema
-- Run this once in your Supabase project: SQL Editor > New query > paste > Run
-- ============================================================

create table if not exists products (
  asin text primary key,
  name text not null,
  tag text default 'launch',
  marketplace text default '',
  launch date
);

create table if not exists sellerboard_rows (
  id bigserial primary key,
  asin text not null references products(asin) on delete cascade,
  week date not null,
  marketplace text default '',
  tag text default '',
  name text default '',
  sales numeric default 0,
  organic numeric default 0,
  ad numeric default 0,
  units numeric default 0,
  refunds numeric default 0,
  spend numeric default 0,
  profit numeric default 0,
  unique(asin, week)
);

create table if not exists sellerfox_rows (
  id bigserial primary key,
  asin text not null references products(asin) on delete cascade,
  week date not null,
  marketplace text default '',
  tag text default '',
  name text default '',
  sessions numeric default 0,
  impressions numeric default 0,
  clicks numeric default 0,
  orders numeric default 0,
  bsr numeric,
  unique(asin, week)
);

-- ------------------------------------------------------------
-- Row Level Security
-- Products: fully open (read/write) via the public anon key, since the
--   Products & launch-dates table is meant to be editable from the browser.
-- Raw weekly rows: readable via the anon key (so charts/tables can load),
--   but only writable by the Edge Functions, which use the service_role
--   key and therefore bypass RLS entirely. This keeps casual visitors from
--   being able to write directly into the raw data tables.
-- ------------------------------------------------------------

alter table products enable row level security;
alter table sellerboard_rows enable row level security;
alter table sellerfox_rows enable row level security;

create policy "public read products" on products for select using (true);
create policy "public insert products" on products for insert with check (true);
create policy "public update products" on products for update using (true);
create policy "public delete products" on products for delete using (true);

create policy "public read sellerboard_rows" on sellerboard_rows for select using (true);
create policy "public read sellerfox_rows" on sellerfox_rows for select using (true);

-- Note: this leaves the dashboard fully open to anyone who has the URL
-- and the public anon key (which is visible in the page source — that's
-- normal for Supabase's client-side pattern, not a leak). Since this is
-- an internal tool, that's a reasonable tradeoff for zero login friction.
-- If you want to restrict who can view/edit later, Supabase Auth (email
-- link or Google sign-in) can be layered on top without changing any of
-- the tables above — ask if you want that added.

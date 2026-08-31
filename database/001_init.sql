-- Bullshido partner-GTD raffle -- initial schema.
-- Run this once in your NEW Supabase project's SQL editor (this is a
-- separate database from the Anya project -- nothing here touches or
-- references that project in any way).
--
-- Model: one "campaign" is active at a time (a time-boxed partnership,
-- e.g. 24h). A holder connects + signs, gets a number of raffle
-- tickets equal to their CURRENT Bullshido balance at the moment they
-- enter (frozen then, not re-checked later), and submits their X
-- username together with that entry. When the campaign's end time
-- passes, a scheduled job (pg_cron, see bottom of this file) runs a
-- weighted random draw with no client involvement at all and no
-- action needed from you -- winners land straight in the `winners`
-- table, ready to export as CSV.

create extension if not exists pgcrypto; -- for gen_random_uuid()

-- ---------------------------------------------------------------
-- 0. auth_nonces -- one-time sign-in messages for wallet verification
--    (backs the connect-wallet flow, api/auth/*.js). Internal-only:
--    the anon key never touches it, only the service role from within
--    the API.
-- ---------------------------------------------------------------
create table if not exists auth_nonces (
  wallet      text primary key,
  nonce       text not null,
  message     text not null,
  used        boolean not null default false,
  created_at  timestamptz not null default now()
);

alter table auth_nonces enable row level security;

-- ---------------------------------------------------------------
-- 1. campaigns
-- ---------------------------------------------------------------
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  partner_name text not null,
  x_tag text,                         -- e.g. "@PartnerHandle", optional, just for your own reference/copy
  gtd_spots integer not null check (gtd_spots > 0),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'drawn', 'cancelled')),
  created_at timestamptz not null default now()
);

-- Only one campaign may be 'active' at a time -- keeps "one partner at
-- a time" true at the database level, not just by convention.
create unique index if not exists one_active_campaign
  on campaigns (status)
  where status = 'active';

create index if not exists campaigns_due_idx on campaigns (status, ends_at);

-- ---------------------------------------------------------------
-- 2. entries -- one row per wallet per campaign, ticket_count frozen
--    at the moment of entry (per your call: balance is NOT re-checked
--    later, so selling the NFT after entering doesn't cost you your
--    spot in the draw).
-- ---------------------------------------------------------------
create table if not exists entries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  wallet_address text not null,
  x_username text not null,
  ticket_count integer not null check (ticket_count > 0),
  entered_at timestamptz not null default now(),
  unique (campaign_id, wallet_address)
);

create index if not exists entries_campaign_idx on entries (campaign_id);

-- ---------------------------------------------------------------
-- 3. winners -- written automatically by perform_due_draws() below.
-- ---------------------------------------------------------------
create table if not exists winners (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  wallet_address text not null,
  x_username text not null,
  drawn_at timestamptz not null default now(),
  unique (campaign_id, wallet_address)
);

-- ---------------------------------------------------------------
-- 4. Row Level Security -- everything goes through the serverless API
--    (which uses the service-role key and bypasses RLS). No anon
--    policies at all: nobody can read or write these tables directly
--    with the public key, same "server never trusts the client"
--    stance as the entry/balance checks themselves.
-- ---------------------------------------------------------------
alter table campaigns enable row level security;
alter table entries enable row level security;
alter table winners enable row level security;

-- ---------------------------------------------------------------
-- 5. perform_enter -- atomic "is this campaign still open, has this
--    wallet not already entered" check + insert, wrapped in one
--    function so there's no gap between checking and writing (a
--    `for update` lock on the campaign row also means an entry can't
--    sneak in the same instant perform_due_draws() starts drawing it).
-- ---------------------------------------------------------------
create or replace function perform_enter(
  p_campaign_id uuid,
  p_wallet text,
  p_x_username text,
  p_ticket_count integer
) returns table (id uuid, ticket_count integer, entered_at timestamptz)
language plpgsql
as $$
declare
  v_campaign campaigns%rowtype;
  v_wallet text := lower(p_wallet);
begin
  select * into v_campaign from campaigns where id = p_campaign_id for update;
  if not found then
    raise exception 'campaign_not_found';
  end if;

  if v_campaign.status <> 'active' then
    raise exception 'campaign_not_active';
  end if;

  if now() >= v_campaign.ends_at then
    raise exception 'campaign_ended';
  end if;

  insert into entries (campaign_id, wallet_address, x_username, ticket_count)
  values (p_campaign_id, v_wallet, p_x_username, p_ticket_count)
  on conflict (campaign_id, wallet_address) do nothing;

  if not found then
    raise exception 'already_entered';
  end if;

  return query
    select e.id, e.ticket_count, e.entered_at
    from entries e
    where e.campaign_id = p_campaign_id and e.wallet_address = v_wallet;
end;
$$;

-- ---------------------------------------------------------------
-- 6. perform_due_draws -- the automatic draw. Weighted random sample
--    WITHOUT replacement, using the standard Efraimidis-Spirakis
--    trick: give every entry a key = random() ^ (1 / ticket_count),
--    sort by that key descending, take the top `gtd_spots`. A wallet
--    with 5 tickets is exactly 5x as likely to land near the top as
--    a wallet with 1 ticket, and nobody can be picked twice.
--
--    `for update skip locked` means if this ever somehow ran twice at
--    once, the two runs would split the due campaigns between them
--    instead of double-drawing one.
-- ---------------------------------------------------------------
create or replace function perform_due_draws() returns void
language plpgsql
as $$
declare
  camp record;
begin
  for camp in
    select * from campaigns
    where status = 'active' and ends_at <= now()
    for update skip locked
  loop
    insert into winners (campaign_id, wallet_address, x_username)
    select camp.id, e.wallet_address, e.x_username
    from entries e
    where e.campaign_id = camp.id
    order by power(random(), 1.0 / e.ticket_count) desc
    limit camp.gtd_spots
    on conflict (campaign_id, wallet_address) do nothing;

    update campaigns set status = 'drawn' where id = camp.id;
  end loop;
end;
$$;

-- ---------------------------------------------------------------
-- 7. Schedule the automatic draw with pg_cron (runs every minute,
--    only actually does anything for campaigns whose ends_at has
--    passed). This requires the pg_cron extension.
--
--    In the Supabase dashboard: Database -> Extensions -> search
--    "pg_cron" -> enable it. THEN come back and run just the two
--    lines below (they're commented out so this file doesn't fail if
--    pg_cron isn't enabled yet when you first run this migration).
--
--    select cron.schedule('bullshido-raffle-draw', '* * * * *', $cron$select perform_due_draws();$cron$);
--
--    To check it's registered: select * from cron.job;
--    To remove it later:      select cron.unschedule('bullshido-raffle-draw');
-- ---------------------------------------------------------------

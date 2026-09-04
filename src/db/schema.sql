-- doof schema. Deliberately small.
-- The only identity doof holds is the notice channel on a binding.
-- Confessions link to a binding and to nothing else. No user ids, no vendor ids, no join keys outward.

create table if not exists verifications (
  id          text primary key,
  channel     text not null,
  code_hash   text not null unique,
  expires_at  timestamptz not null,
  consumed_at timestamptz
);

create table if not exists bindings (
  id           text primary key,
  channel_type text not null default 'email',
  channel      text not null,
  token_hash   text not null unique,
  created_at   timestamptz not null default now()
);

create table if not exists confessions (
  id                     text primary key,
  binding_id             text not null references bindings(id) on delete cascade,
  what                   text not null,
  why                    text not null,
  status                 text not null check (status in ('hesitated','completed','averted','uncertain')),
  reversible             boolean,
  severity               text check (severity in ('low','moderate','high')),
  what_would_have_helped text,
  created_at             timestamptz not null default now(),
  notified_at            timestamptz,
  -- Ledger. Per binding: seq from 1, prev_hash links to the entry before (genesis = sha256('doof:' || binding_id)),
  -- hash = sha256 of the canonical entry, signature = Ed25519 over the hash bytes, key_id names the signing key.
  seq                    integer not null,
  prev_hash              text not null,
  hash                   text not null,
  signature              text not null,
  key_id                 text not null
);

create index if not exists confessions_binding_created on confessions (binding_id, created_at);
create unique index if not exists confessions_binding_seq on confessions (binding_id, seq);

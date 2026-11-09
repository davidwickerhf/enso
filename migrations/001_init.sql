-- Ensō: accounts (Better Auth), device tokens, encrypted sync blobs, releases.
-- Applied by scripts/migrate.mjs on container start. Never edit an applied
-- migration (checksums are recorded); add a new NNN_*.sql file instead.

-- Better Auth core tables (generated with better-auth 1.7 getMigrations).
create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);
create table "session" ("id" text not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);
create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null);
create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);
create index "session_userId_idx" on "session" ("userId");
create index "account_userId_idx" on "account" ("userId");
create index "verification_identifier_idx" on "verification" ("identifier");

-- Per-device bearer tokens. Only the SHA-256 of a token is stored.
create table devices (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references "user" (id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index devices_user_idx on devices (user_id) where revoked_at is null;

-- Device sign-in requests (POST /api/device/start -> approve on the web -> poll).
create table device_requests (
  id uuid primary key default gen_random_uuid(),
  device_code_hash text not null unique,
  user_code text not null,
  email text not null,
  device_name text not null,
  ip text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'consumed')),
  user_id text references "user" (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  decided_at timestamptz
);
create index device_requests_expires_idx on device_requests (expires_at);

-- Sync quota and usage per account.
create table sync_accounts (
  user_id text primary key references "user" (id) on delete cascade,
  quota_bytes bigint not null,
  used_bytes bigint not null default 0 check (used_bytes >= 0),
  created_at timestamptz not null default now()
);

-- Encrypted blobs: metadata here, bytes in object storage (or `objects`).
create sequence blob_seq;
create table blobs (
  user_id text not null references "user" (id) on delete cascade,
  key text not null,
  version bigint not null,
  size bigint not null,
  object_key text,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references devices (id) on delete set null,
  seq bigint not null,
  primary key (user_id, key)
);
create index blobs_user_seq_idx on blobs (user_id, seq);
create index blobs_tombstones_idx on blobs (updated_at) where deleted;

-- Bytes when no S3 is configured (development, tests).
create table objects (
  bucket text not null,
  key text not null,
  data bytea not null,
  primary key (bucket, key)
);

-- Extension and helper releases, published by CI.
create table releases (
  kind text not null check (kind in ('extension', 'helper')),
  version text not null,
  filename text not null unique,
  sha256 text not null,
  size bigint not null,
  strict_min_version text,
  notes text,
  yanked boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (kind, version)
);

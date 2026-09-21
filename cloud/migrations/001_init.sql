CREATE TABLE IF NOT EXISTS sites (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?),
  name TEXT NOT NULL,
  edge_token_hash TEXT NOT NULL,
  operator_password_hash TEXT NOT NULL,
  engineer_password_hash TEXT NOT NULL,
  instance JSONB,
  project JSONB,
  frame JSONB,
  last_seen TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('viewer','operator','engineer')),
  csrf TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS samples (
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  signal TEXT NOT NULL,
  time BIGINT NOT NULL,
  value DOUBLE PRECISION,
  quality TEXT NOT NULL CHECK (quality IN ('good','bad','stale','offline')),
  PRIMARY KEY(site_id, run_id, signal, time)
);
CREATE INDEX IF NOT EXISTS samples_time ON samples(site_id, run_id, time);

CREATE TABLE IF NOT EXISTS commands (
  cloud_id UUID PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  command_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  actor JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','applied','rejected')),
  receipt JSONB,
  error TEXT,
  lease_until TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(site_id, command_id)
);
CREATE INDEX IF NOT EXISTS commands_delivery ON commands(site_id, status, lease_until, created_at);
),
  name TEXT NOT NULL,
  edge_token_hash TEXT NOT NULL,
  operator_password_hash TEXT NOT NULL,
  engineer_password_hash TEXT NOT NULL,
  instance JSONB,
  project JSONB,
  frame JSONB,
  last_seen TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('viewer','operator','engineer')),
  csrf TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS samples (
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  signal TEXT NOT NULL,
  time BIGINT NOT NULL,
  value DOUBLE PRECISION,
  quality TEXT NOT NULL CHECK (quality IN ('good','bad','stale','offline')),
  PRIMARY KEY(site_id, run_id, signal, time)
);
CREATE INDEX IF NOT EXISTS samples_time ON samples(site_id, run_id, time);

CREATE TABLE IF NOT EXISTS commands (
  cloud_id UUID PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  command_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  actor JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','applied','rejected')),
  receipt JSONB,
  error TEXT,
  lease_until TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(site_id, command_id)
);
CREATE INDEX IF NOT EXISTS commands_delivery ON commands(site_id, status, lease_until, created_at);

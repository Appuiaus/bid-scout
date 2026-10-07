-- Phase 0/1 schema. Secrets are NEVER stored here: credentials.secret_reference
-- names a Workers secret / Secrets Store entry.

CREATE TABLE clients (
  client_id                 TEXT PRIMARY KEY,
  client_name               TEXT NOT NULL,
  active                    INTEGER NOT NULL DEFAULT 1,
  work_types                TEXT NOT NULL DEFAULT '[]',  -- JSON array
  states                    TEXT NOT NULL DEFAULT '[]',  -- JSON array of US state codes
  base_lat                  REAL,
  base_lng                  REAL,
  radius_miles              REAL,
  value_min                 REAL,
  value_max                 REAL,
  include_unvalued_listings INTEGER NOT NULL DEFAULT 1,
  positive_markers          TEXT NOT NULL DEFAULT '["sitework"]',
  negative_markers          TEXT NOT NULL DEFAULT '["tenant improvement","tenant build-out","interior renovation","interior remodel"]',
  boards_to_search          TEXT NOT NULL DEFAULT '[]',
  priority_weight           REAL NOT NULL DEFAULT 1,
  timezone                  TEXT NOT NULL DEFAULT 'America/Chicago', -- IANA
  next_meeting_at           TEXT,                                    -- ISO-8601 UTC
  created_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE boards (
  board_id                 TEXT PRIMARY KEY,
  board_name               TEXT NOT NULL,
  access_type              TEXT NOT NULL CHECK (access_type IN ('api','webhook','email','csv_upload','authenticated_fetch')),
  endpoint                 TEXT,
  search_parameter_mapping TEXT NOT NULL DEFAULT '{}',
  enabled                  INTEGER NOT NULL DEFAULT 0,
  -- authenticated_fetch must never be enabled without a recorded decision
  terms_decision           TEXT,
  terms_decided_by         TEXT,
  terms_decided_at         TEXT,
  CHECK (access_type <> 'authenticated_fetch' OR enabled = 0 OR terms_decision IS NOT NULL)
);

CREATE TABLE opportunities (
  opportunity_id     TEXT PRIMARY KEY,
  source_board       TEXT NOT NULL REFERENCES boards(board_id),
  source_reference   TEXT NOT NULL,          -- id/URL on the board
  dedupe_key         TEXT NOT NULL,
  title              TEXT NOT NULL,
  description        TEXT,
  city               TEXT,
  state              TEXT,
  lat                REAL,
  lng                REAL,
  project_value      REAL,                   -- nullable: many listings have none
  work_type_tags     TEXT NOT NULL DEFAULT '[]',
  files_present      INTEGER NOT NULL DEFAULT 0,
  url                TEXT,
  bid_due_at         TEXT,
  first_seen_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  raw_payload        TEXT,                   -- original record, for audit
  UNIQUE (source_board, source_reference)
);
CREATE INDEX idx_opp_dedupe ON opportunities(dedupe_key);

-- One row per (opportunity, client): the same listing can suit several clients.
CREATE TABLE matches (
  opportunity_id      TEXT NOT NULL REFERENCES opportunities(opportunity_id),
  client_id           TEXT NOT NULL REFERENCES clients(client_id),
  deterministic_pass  INTEGER NOT NULL,
  drop_reason         TEXT,
  fit_score           INTEGER,               -- 0-100
  score_components    TEXT NOT NULL DEFAULT '{}',
  confidence_flag     TEXT NOT NULL DEFAULT 'normal' CHECK (confidence_flag IN ('normal','low')),
  recommendation_text TEXT,                  -- Phase 2 (AI)
  status              TEXT NOT NULL DEFAULT 'new'
                      CHECK (status IN ('new','surfaced','approved','rejected','submitted')),
  scored_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (opportunity_id, client_id)
);
CREATE INDEX idx_match_queue ON matches(client_id, status, fit_score DESC);

CREATE TABLE decisions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id TEXT NOT NULL,
  client_id      TEXT NOT NULL,
  decision       TEXT NOT NULL CHECK (decision IN ('approve','reject')),
  decided_by     TEXT NOT NULL,
  decided_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  reason         TEXT
);

CREATE TABLE credentials (
  board_id              TEXT PRIMARY KEY REFERENCES boards(board_id),
  account_owner         TEXT NOT NULL CHECK (account_owner IN ('ben','boss','client')),
  login_url             TEXT,
  username              TEXT,
  secret_reference      TEXT NOT NULL,       -- NAME of the secret, never the value
  two_factor_type       TEXT,
  token_expiry_estimate TEXT,
  last_refreshed        TEXT
);

CREATE TABLE writeback_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id TEXT NOT NULL,
  client_id      TEXT NOT NULL,
  target         TEXT NOT NULL,
  payload        TEXT NOT NULL,
  written_by     TEXT NOT NULL,
  written_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  reversed_at    TEXT
);

-- Scoring weights and thresholds, editable from the hub.
CREATE TABLE rules (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO rules (key, value) VALUES
  ('weights', '{"location":25,"trade":25,"markers":20,"value":15,"recency":10,"completeness":5}'),
  ('surface_threshold', '50'),
  ('predraft_threshold', '90');

CREATE TABLE ingest_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id    TEXT NOT NULL,
  started_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  finished_at TEXT,
  status      TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','failed')),
  fetched     INTEGER NOT NULL DEFAULT 0,
  error       TEXT
);

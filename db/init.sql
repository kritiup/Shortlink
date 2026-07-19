-- Schema for the ShortLink app. Postgres runs every .sql in
-- /docker-entrypoint-initdb.d ONCE, the first time the data directory is empty.

CREATE TABLE IF NOT EXISTS links (
    code        TEXT PRIMARY KEY,
    target_url  TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS click_stats (
    code        TEXT PRIMARY KEY REFERENCES links(code) ON DELETE CASCADE,
    clicks      BIGINT NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

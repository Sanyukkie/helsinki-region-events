import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, "events.db"));

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS raw_events (
    source        TEXT NOT NULL,
    source_id     TEXT NOT NULL,
    title         TEXT,
    description   TEXT,
    start_time    TEXT,
    end_time      TEXT,
    venue_name    TEXT,
    venue_address TEXT,
    lat           REAL,
    lng           REAL,
    image_url     TEXT,
    url           TEXT,
    is_free       INTEGER,
    price         TEXT,
    categories    TEXT,
    fetched_at    TEXT,
    PRIMARY KEY (source, source_id)
  );

  -- canonical, deduplicated events; rebuilt after every ingest
  CREATE TABLE IF NOT EXISTS events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT,
    description   TEXT,
    start_time    TEXT,
    end_time      TEXT,
    venue_name    TEXT,
    venue_address TEXT,
    lat           REAL,
    lng           REAL,
    image_url     TEXT,
    is_free       INTEGER,
    price         TEXT,
    categories    TEXT,
    sources       TEXT,
    is_ongoing    INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_events_start ON events (start_time);

  CREATE TABLE IF NOT EXISTS ingest_log (
    source     TEXT PRIMARY KEY,
    ran_at     TEXT,
    fetched    INTEGER,
    note       TEXT
  );
`);

// migrations for databases created before these columns existed
for (const ddl of [
  "ALTER TABLE events ADD COLUMN is_ongoing INTEGER DEFAULT 0",
  "ALTER TABLE events ADD COLUMN score INTEGER DEFAULT 0",
  "ALTER TABLE events ADD COLUMN stable_key TEXT",
  "ALTER TABLE raw_events ADD COLUMN popularity INTEGER",
]) {
  try { db.exec(ddl); } catch { /* already there */ }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS geocache (
    query TEXT PRIMARY KEY,
    lat   REAL,
    lng   REAL,
    found INTEGER NOT NULL
  );
`);

export function upsertRaw(ev) {
  db.prepare(`
    INSERT INTO raw_events
      (source, source_id, title, description, start_time, end_time,
       venue_name, venue_address, lat, lng, image_url, url, is_free, price, categories,
       popularity, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (source, source_id) DO UPDATE SET
      title = excluded.title, description = excluded.description,
      start_time = excluded.start_time, end_time = excluded.end_time,
      venue_name = excluded.venue_name, venue_address = excluded.venue_address,
      lat = COALESCE(excluded.lat, raw_events.lat),
      lng = COALESCE(excluded.lng, raw_events.lng),
      image_url = excluded.image_url, url = excluded.url,
      is_free = excluded.is_free, price = excluded.price,
      categories = excluded.categories, popularity = excluded.popularity,
      fetched_at = excluded.fetched_at
  `).run(
    ev.source, ev.source_id, ev.title, ev.description, ev.start_time, ev.end_time,
    ev.venue_name, ev.venue_address, ev.lat, ev.lng, ev.image_url, ev.url,
    ev.is_free == null ? null : Number(ev.is_free), ev.price,
    JSON.stringify(ev.categories || []), ev.popularity ?? null, new Date().toISOString()
  );
}

export function logIngest(source, fetched, note = "") {
  db.prepare(`
    INSERT INTO ingest_log (source, ran_at, fetched, note) VALUES (?, ?, ?, ?)
    ON CONFLICT (source) DO UPDATE SET ran_at = excluded.ran_at,
      fetched = excluded.fetched, note = excluded.note
  `).run(source, new Date().toISOString(), fetched, note);
}

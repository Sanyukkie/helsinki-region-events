import { pathToFileURL } from "node:url";
import { db, upsertRaw, logIngest } from "./db.js";
import { dedupe } from "./dedup.js";
import { helsinkiAdapter, espooAdapter } from "./adapters/linkedevents.js";
import { ticketmasterAdapter } from "./adapters/ticketmaster.js";
import { kideAdapter } from "./adapters/kide.js";
import { geocodeMissingVenues } from "./geocode.js";

const INGEST_DAYS = Number(process.env.INGEST_DAYS || 45);
const ADAPTERS = [helsinkiAdapter, espooAdapter, ticketmasterAdapter, kideAdapter];

let running = false;

export async function runIngest() {
  if (running) return;
  running = true;
  const t0 = Date.now();
  try {
    for (const adapter of ADAPTERS) {
      try {
        const events = await adapter.fetchAll({ days: INGEST_DAYS });
        if (events === null) { logIngest(adapter.source, 0, "no api key"); continue; }
        for (const ev of events) upsertRaw(ev);
        logIngest(adapter.source, events.length);
        console.log(`[${adapter.source}] fetched ${events.length} events`);
      } catch (err) {
        logIngest(adapter.source, 0, `error: ${err.message}`);
        console.error(`[${adapter.source}] failed: ${err.message}`);
      }
    }
    await geocodeMissingVenues();
    rebuildCanonical();
    console.log(`[ingest] full sweep done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } finally {
    running = false;
  }
}

// Cheap poll for new/changed/deleted events since each source's last run.
// Only Linked Events instances support this; Ticketmaster waits for the full sweep.
export async function runIncremental() {
  if (running) return;
  running = true;
  try {
    let changed = 0;
    for (const adapter of ADAPTERS) {
      if (!adapter.fetchChangedSince) continue;
      const last = db.prepare("SELECT ran_at FROM ingest_log WHERE source = ?").get(adapter.source);
      if (!last?.ran_at) continue; // no baseline yet — wait for a full sweep
      const since = new Date(Date.parse(last.ran_at) - 5 * 60 * 1000); // 5 min overlap for safety
      try {
        const deleted = [];
        const events = await adapter.fetchChangedSince(since, {
          days: INGEST_DAYS,
          onDeleted: (id) => deleted.push(id),
        });
        for (const ev of events) upsertRaw(ev);
        const del = db.prepare("DELETE FROM raw_events WHERE source = ? AND source_id = ?");
        for (const id of deleted) del.run(adapter.source, id);
        changed += events.length + deleted.length;
        logIngest(adapter.source, events.length, "incremental");
        if (events.length || deleted.length) {
          console.log(`[${adapter.source}] incremental: ${events.length} changed, ${deleted.length} removed`);
        }
      } catch (err) {
        console.error(`[${adapter.source}] incremental failed: ${err.message}`);
      }
    }
    if (changed > 0) rebuildCanonical();
  } finally {
    running = false;
  }
}

export function rebuildCanonical() {
  // drop raw events that ended in the past so the working set stays small
  db.prepare("DELETE FROM raw_events WHERE COALESCE(end_time, start_time) < ?")
    .run(new Date(Date.now() - 86400_000).toISOString());

  const raws = db.prepare("SELECT * FROM raw_events").all();
  const canonical = dedupe(raws);

  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM events");
    const ins = db.prepare(`
      INSERT INTO events (title, description, start_time, end_time, venue_name, venue_address,
                          lat, lng, image_url, is_free, price, categories, sources, is_ongoing,
                          score, stable_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const ev of canonical) {
      ins.run(ev.title, ev.description, ev.start_time, ev.end_time, ev.venue_name,
              ev.venue_address, ev.lat, ev.lng, ev.image_url, ev.is_free, ev.price,
              ev.categories, ev.sources, ev.is_ongoing, ev.score, ev.stable_key);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  const merged = raws.length - canonical.length;
  console.log(`[dedup] ${raws.length} raw → ${canonical.length} canonical (${merged} merged)`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runIngest();
}

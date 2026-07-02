// Fills in coordinates for events whose source has none (Kide venue names).
// Uses Nominatim (OpenStreetMap) with a permanent cache and the polite 1 req/s limit —
// venue names repeat constantly, so after the first sweep this rarely makes any requests.

import { db } from "./db.js";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "helsinki-events-prototype/0.2 (personal project)";
const DELAY_MS = 1100;
const MAX_LOOKUPS_PER_RUN = 25;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function lookup(query) {
  const params = new URLSearchParams({ q: query, format: "json", limit: "1", countrycodes: "fi" });
  const res = await fetch(`${NOMINATIM}?${params}`, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`nominatim HTTP ${res.status}`);
  const hits = await res.json();
  return hits[0] ? { lat: Number(hits[0].lat), lng: Number(hits[0].lon) } : null;
}

export async function geocodeMissingVenues() {
  const rows = db.prepare(`
    SELECT DISTINCT venue_name, venue_address FROM raw_events
    WHERE lat IS NULL AND venue_name IS NOT NULL AND venue_name != ''
  `).all();
  if (rows.length === 0) return;

  const getCached = db.prepare("SELECT * FROM geocache WHERE query = ?");
  const setCached = db.prepare(
    "INSERT OR REPLACE INTO geocache (query, lat, lng, found) VALUES (?, ?, ?, ?)"
  );
  const applyCoords = db.prepare(
    "UPDATE raw_events SET lat = ?, lng = ? WHERE lat IS NULL AND venue_name = ?"
  );

  let lookups = 0, filled = 0;
  for (const { venue_name, venue_address } of rows) {
    const query = `${venue_name}, ${venue_address || "Helsinki"}, Finland`;
    let hit = getCached.get(query);
    if (!hit) {
      if (lookups >= MAX_LOOKUPS_PER_RUN) continue; // rest picked up on the next run
      lookups++;
      try {
        const coords = await lookup(query);
        setCached.run(query, coords?.lat ?? null, coords?.lng ?? null, coords ? 1 : 0);
        hit = getCached.get(query);
      } catch (err) {
        console.error(`[geocode] "${query}" failed: ${err.message}`);
        continue;
      }
      await sleep(DELAY_MS);
    }
    if (hit?.found) {
      applyCoords.run(hit.lat, hit.lng, venue_name);
      filled++;
    }
  }
  if (lookups || filled) {
    console.log(`[geocode] ${filled} venues resolved (${lookups} new lookups)`);
  }
}

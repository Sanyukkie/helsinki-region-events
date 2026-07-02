# Helsinki Region Events — aggregator prototype

Aggregates events across the Helsinki metro area (Helsinki, Espoo, Vantaa + surroundings)
into one deduplicated database with a small API and web UI.

**Target audience:** younger adults (music, gigs, club events) and families with kids —
these categories get UI priority and should get ranking priority in future features.

**Sources**
- [Helsinki Linked Events](https://api.hel.fi/linkedevents/v1/) — city open data, no key needed;
  also carries Vantaa city events and Helmet metro-area libraries
- [Espoo Linked Events](https://api.espoo.fi/events/v1/) — Espoo's own instance, same schema
- [Ticketmaster Discovery](https://developer.ticketmaster.com/) — commercial concerts/shows in a
  40 km radius of Helsinki; set `TICKETMASTER_API_KEY` in `.env` to enable (free key, instant signup)
- [Kide.app](https://kide.app/) — student & club events (Helsinki, Espoo, Vantaa). ⚠️ Unofficial,
  undocumented API with no third-party terms: fine for a personal prototype, but contact Kide
  before any public/commercial use. Disable with `KIDE_ENABLED=0`.

**Freshness:** full sweep every 6 h; Linked Events sources are additionally polled every
15 min with `last_modified_since` (picks up new events, changes, cancellations, deletions).

**Run** (Node ≥ 22.9, zero npm dependencies)

```
npm start          # serves http://localhost:4173, ingests on first run + every 6 h
npm run ingest     # manual ingest
```

**How it works**

```
adapters (server/adapters/*)  →  raw_events table (per source)
→ dedup (server/dedup.js): start within 45 min + same place (geo <300 m or venue-name
  overlap) + title similarity ≥ 0.5 (bigram Dice)  →  events table (canonical, merged)
→ API: GET /api/events?start&end&category&text&free&page   ·   GET /api/status
→ static UI in public/
```

Merged events keep provenance in `sources` (JSON): the UI shows a Ticketmaster
"Tickets →" link when available, Linked Events supplies the richer description.

**Adding a source**: write an adapter in `server/adapters/` that returns the normalized
shape (see `linkedevents.js`), register it in `server/ingest.js`. Dedup handles the rest.

**Tests**: `npm test` (node:test, covers the dedup/merge/scoring logic).

**Deploying**: single Node ≥22.9 process, zero npm dependencies, SQLite on disk — any small
VPS or free-tier Fly.io/Railway works. Copy the folder, add `.env`, run `npm start` behind
a reverse proxy with HTTPS (needed for the PWA install prompt and clipboard sharing).

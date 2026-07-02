// Kide.app — Finland's dominant platform for student & club events.
// NOTE: this API is unofficial/undocumented (no third-party terms). Fine for a personal
// prototype; get in touch with Kide before using this in anything public or commercial.
// Toggle with KIDE_ENABLED=0 in .env.

const API = "https://api.kide.app/api/products";
const IMAGE_BASE = "https://portalvhdsp62n0yt356llm.blob.core.windows.net/bailataan-mediaitems/";
const CITIES = ["Helsinki", "Espoo", "Vantaa"];
// listings include multi-year passes and season products; skip anything longer than this
const MAX_DURATION_MS = 60 * 86400_000;

function normalize(p, city) {
  const min = p.minPrice?.eur; // cents
  const max = p.maxPrice?.eur;
  const isFree = p.hasFreeInventoryItems && (min === 0 || min == null) ? 1 : min === 0 ? 1 : 0;
  let price = null;
  if (!isFree && min != null) {
    const fmt = (c) => (c / 100).toLocaleString("fi-FI", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    price = max != null && max !== min ? `${fmt(min)}–${fmt(max)} €` : `${fmt(min)} €`;
  }
  return {
    source: "kide",
    source_id: p.id,
    title: p.name,
    description: p.companyName ? `By ${p.companyName}` : null,
    start_time: p.dateActualFrom,
    end_time: p.dateActualUntil,
    venue_name: p.place || null,
    venue_address: city, // listing has no street address — city only (used for geocoding)
    lat: null, // no coordinates in the listing; filled in by the geocoder after ingest
    lng: null,
    image_url: p.mediaFilename ? IMAGE_BASE + p.mediaFilename : null,
    url: `https://kide.app/events/${p.id}`,
    is_free: isFree,
    price,
    categories: ["student"],
    popularity: p.favoritedTimes || 0,
  };
}

async function fetchCity(city) {
  const res = await fetch(`${API}?city=${encodeURIComponent(city)}&productType=1`, {
    headers: { "User-Agent": "Mozilla/5.0 (events-aggregator prototype)" },
  });
  if (!res.ok) throw new Error(`kide HTTP ${res.status}`);
  const data = await res.json();
  return data.model || [];
}

async function fetchKide({ days = 45 } = {}) {
  if (process.env.KIDE_ENABLED === "0") {
    console.log("[kide] disabled via KIDE_ENABLED=0 — skipping");
    return null;
  }
  const now = Date.now();
  const horizon = now + days * 86400_000;
  const seen = new Set();
  const out = [];
  for (const city of CITIES) {
    for (const p of await fetchCity(city)) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      const start = Date.parse(p.dateActualFrom);
      const end = p.dateActualUntil ? Date.parse(p.dateActualUntil) : start;
      if (!p.name || Number.isNaN(start)) continue;
      if (end < now || start > horizon) continue;
      if (end - start > MAX_DURATION_MS) continue; // season pass, not an event
      out.push(normalize(p, city));
    }
  }
  return out;
}

export const kideAdapter = {
  source: "kide",
  fetchAll: fetchKide,
  // the listing is small (one request per city) — cheap enough to refresh incrementally too
  fetchChangedSince: (since, opts) => fetchKide(opts),
};

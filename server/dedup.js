// Groups raw events from different sources that describe the same real-world event.
// Match rule: start times within 45 min AND same place (geo <300m or venue-name overlap)
// AND title similarity >= 0.5 (Dice coefficient on character bigrams).

const TIME_WINDOW_MS = 45 * 60 * 1000;
const TIME_WINDOW_CONTAINMENT_MS = 90 * 60 * 1000; // ticket-package variants list odd start times
const GEO_RADIUS_M = 300;
const TITLE_THRESHOLD = 0.5;

function normText(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function bigrams(s) {
  const t = normText(s).replace(/ /g, "");
  const grams = new Map();
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    grams.set(g, (grams.get(g) || 0) + 1);
  }
  return grams;
}

export function titleSimilarity(a, b) {
  const ga = bigrams(a), gb = bigrams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let overlap = 0, na = 0, nb = 0;
  for (const [g, c] of ga) { na += c; if (gb.has(g)) overlap += Math.min(c, gb.get(g)); }
  for (const c of gb.values()) nb += c;
  return (2 * overlap) / (na + nb);
}

function geoDistanceM(a, b) {
  if (a.lat == null || b.lat == null) return Infinity;
  const dLat = (a.lat - b.lat) * 111_320;
  const dLng = (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

function samePlace(a, b) {
  if (geoDistanceM(a, b) <= GEO_RADIUS_M) return true;
  const va = normText(a.venue_name), vb = normText(b.venue_name);
  if (!va || !vb) return false;
  return va === vb || va.includes(vb) || vb.includes(va);
}

function sameEvent(a, b) {
  if (a.source === b.source) return false; // trust each source's own ids
  const dt = Math.abs(Date.parse(a.start_time) - Date.parse(b.start_time));
  if (dt > TIME_WINDOW_CONTAINMENT_MS) return false;
  if (!samePlace(a, b)) return false;
  if (dt <= TIME_WINDOW_MS && titleSimilarity(a.title, b.title) >= TITLE_THRESHOLD) return true;
  // ticket-package variants: "Lenny Kravitz" vs "Lenny Kravitz Live 2026 | VIP packages";
  // these sometimes list shifted start times, hence the wider window
  const na = normText(a.title).replace(/ /g, "");
  const nb = normText(b.title).replace(/ /g, "");
  const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na];
  return shorter.length >= 10 && longer.includes(shorter);
}

// Merge a cluster of raw records into one canonical event.
// Linked Events usually has the richer description; Ticketmaster the price and ticket link.
function merge(cluster) {
  // within a source, the shortest title is the base listing (vs "… | VIP package" variants)
  cluster = [...cluster].sort((a, b) =>
    a.source === b.source ? (a.title || "").length - (b.title || "").length
                          : a.source === "linkedevents" ? -1 : 1);
  const bySource = (s) => cluster.find((e) => e.source === s);
  const le = bySource("linkedevents");
  const tm = bySource("ticketmaster");
  const primary = le || cluster[0];
  const cats = new Set(cluster.flatMap((e) => JSON.parse(e.categories || "[]")));

  // relevance score: rich, notable, audience-relevant events float to the top within each day
  const popularity = Math.max(0, ...cluster.map((e) => e.popularity || 0));
  let score = 0;
  if (cluster.some((e) => e.image_url)) score += 2;
  if (tm) score += 3; // ticketed shows are the "big" events
  if (cluster.some((e) => e.price || e.is_free === 1)) score += 1;
  if (["music", "kids", "student"].some((c) => cats.has(c))) score += 2; // target audience
  score += 2 * (cluster.length - 1); // listed by multiple sources = notable
  score += Math.min(4, Math.round(Math.log2(1 + popularity))); // Kide favourites
  return {
    title: primary.title,
    description: (le && le.description) || primary.description,
    start_time: primary.start_time,
    end_time: primary.end_time,
    venue_name: primary.venue_name,
    venue_address: primary.venue_address,
    lat: cluster.find((e) => e.lat != null)?.lat ?? null,
    lng: cluster.find((e) => e.lng != null)?.lng ?? null,
    image_url: cluster.find((e) => e.image_url)?.image_url ?? null,
    is_free: cluster.some((e) => e.is_free === 1) ? 1 : (primary.is_free ?? null),
    price: (tm && tm.price) || cluster.find((e) => e.price)?.price || null,
    categories: JSON.stringify([...cats]),
    sources: JSON.stringify(cluster.map((e) => ({ source: e.source, id: e.source_id, url: e.url }))),
    // exhibitions and other long-running things (>31 days) are browsed, not "attended on a date"
    is_ongoing: primary.end_time &&
      Date.parse(primary.end_time) - Date.parse(primary.start_time) > 31 * 86400_000 ? 1 : 0,
    score,
    // survives rebuilds (autoincrement ids don't) — used for favorites and share links
    stable_key: `${primary.source}:${primary.source_id}`,
  };
}

export function dedupe(rawEvents) {
  // sort by start time so candidate matches are neighbours; compare within a sliding window
  const rows = [...rawEvents].sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time));
  const clusters = [];
  let windowStart = 0;
  for (const ev of rows) {
    const t = Date.parse(ev.start_time);
    while (windowStart < clusters.length &&
           t - Date.parse(clusters[windowStart][0].start_time) > TIME_WINDOW_CONTAINMENT_MS) {
      windowStart++;
    }
    let joined = false;
    for (let i = windowStart; i < clusters.length && !joined; i++) {
      if (clusters[i].some((member) => sameEvent(member, ev))) {
        clusters[i].push(ev);
        joined = true;
      }
    }
    if (!joined) clusters.push([ev]);
  }
  return clusters.map(merge);
}

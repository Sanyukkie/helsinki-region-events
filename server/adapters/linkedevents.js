// Adapter factory for Linked Events instances (Helsinki, Espoo — same open-source API).
// Helsinki's instance also carries Vantaa city events and the Helmet metro-area libraries.

const PAGE_SIZE = 100;
const MAX_PAGES = 80;

// YSO keyword ids → our category taxonomy
const KEYWORD_MAP = {
  "yso:p1808": "music",
  "yso:p2625": "theatre",
  "yso:p1278": "dance",
  "yso:p4484": "visualarts",
  "yso:p916": "sports",
  "yso:p965": "sports",
  "yso:p4354": "kids",
  "yso:p3670": "food",
  "yso:p5": "film",
};

// multilingual field {fi, sv, en} → single string, English first
function loc(field) {
  if (!field) return null;
  return field.en || field.fi || field.sv || Object.values(field)[0] || null;
}

function categoriesOf(ev) {
  const cats = new Set();
  for (const kw of ev.keywords || []) {
    const m = /keyword\/([^/]+)\//.exec(kw["@id"] || "");
    if (m && KEYWORD_MAP[m[1]]) cats.add(KEYWORD_MAP[m[1]]);
  }
  // Linked Events also marks family events via the audience field
  for (const aud of ev.audience || []) {
    const m = /keyword\/([^/]+)\//.exec(aud["@id"] || "");
    if (m && (m[1] === "yso:p4354" || m[1] === "yso:p13050")) cats.add("kids");
  }
  return [...cats];
}

function priceOf(ev) {
  const offer = ev.offers && ev.offers[0];
  if (!offer) return { is_free: null, price: null };
  if (offer.is_free) return { is_free: 1, price: null };
  const p = loc(offer.price);
  if (p && !/https?:\/\//.test(p) && p.length <= 30) return { is_free: 0, price: p };
  return { is_free: 0, price: null };
}

export function makeLinkedEventsAdapter({ source, apiBase, fallbackUrl }) {
  function normalize(ev) {
    const pos = ev.location?.position?.coordinates; // [lng, lat]
    const { is_free, price } = priceOf(ev);
    return {
      source,
      source_id: ev.id,
      title: loc(ev.name),
      description: loc(ev.short_description) || loc(ev.description),
      start_time: ev.start_time,
      end_time: ev.end_time,
      venue_name: ev.location ? loc(ev.location.name) : null,
      venue_address: ev.location ? loc(ev.location.street_address) : null,
      lat: pos ? pos[1] : null,
      lng: pos ? pos[0] : null,
      image_url: ev.images?.[0]?.url || null,
      url: loc(ev.info_url) || (fallbackUrl ? fallbackUrl(ev) : null),
      is_free,
      price,
      categories: categoriesOf(ev),
    };
  }

  async function fetchPages(firstUrl, { onDeleted } = {}) {
    const out = [];
    let url = firstUrl;
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${source} HTTP ${res.status}`);
      const data = await res.json();
      for (const ev of data.data) {
        if (ev.deleted || ev.event_status === "EventCancelled") {
          if (onDeleted) onDeleted(ev.id);
          continue;
        }
        // skip umbrella/recurring parents — the individual occurrences are also in the feed
        if (ev.super_event_type) continue;
        if (!ev.start_time || !loc(ev.name)) continue;
        out.push(normalize(ev));
      }
      url = data.meta.next;
    }
    return out;
  }

  return {
    source,
    // full sweep of the coming `days`
    async fetchAll({ days = 45 } = {}) {
      const end = new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
      return fetchPages(
        `${apiBase}event/?start=today&end=${end}&sort=start_time&page_size=${PAGE_SIZE}&include=location`
      );
    },
    // only events created/changed/deleted since `since` — cheap enough to poll every 15 min
    async fetchChangedSince(since, { days = 45, onDeleted } = {}) {
      const end = new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
      const ts = since.toISOString().slice(0, 19);
      return fetchPages(
        `${apiBase}event/?last_modified_since=${ts}&show_deleted=true&start=today&end=${end}&page_size=${PAGE_SIZE}&include=location`,
        { onDeleted }
      );
    },
  };
}

export const helsinkiAdapter = makeLinkedEventsAdapter({
  source: "linkedevents",
  apiBase: "https://api.hel.fi/linkedevents/v1/",
  fallbackUrl: (ev) => `https://tapahtumat.hel.fi/en/events/${ev.id}`,
});

export const espooAdapter = makeLinkedEventsAdapter({
  source: "espoo",
  apiBase: "https://api.espoo.fi/events/v1/",
  fallbackUrl: null, // Espoo has no public per-event page; info_url or nothing
});

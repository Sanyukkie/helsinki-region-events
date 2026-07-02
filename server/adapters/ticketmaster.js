const API = "https://app.ticketmaster.com/discovery/v2/events.json";
const PAGE_SIZE = 200;
const MAX_PAGES = 5; // Discovery API caps deep paging at 1000 items

const SEGMENT_MAP = {
  "Music": "music",
  "Sports": "sports",
  "Arts & Theatre": "theatre",
  "Film": "film",
  "Family": "kids",
};

function normalize(ev) {
  const venue = ev._embedded?.venues?.[0];
  const range = ev.priceRanges?.[0];
  const segment = ev.classifications?.[0]?.segment?.name;
  const genre = ev.classifications?.[0]?.genre?.name;
  const cats = new Set();
  if (SEGMENT_MAP[segment]) cats.add(SEGMENT_MAP[segment]);
  if (genre === "Dance/Electronic" || genre === "Dance") cats.add("dance");
  // best image: widest 16:9
  const image = (ev.images || [])
    .filter((i) => i.ratio === "16_9")
    .sort((a, b) => b.width - a.width)[0] || (ev.images || [])[0];
  const start = ev.dates?.start;
  return {
    source: "ticketmaster",
    source_id: ev.id,
    title: ev.name,
    description: ev.info || ev.pleaseNote || (genre && genre !== "Undefined" ? genre : null),
    start_time: start?.dateTime || (start?.localDate ? `${start.localDate}T00:00:00Z` : null),
    end_time: ev.dates?.end?.dateTime || null,
    venue_name: venue?.name || null,
    venue_address: venue?.address?.line1 || null,
    lat: venue?.location ? Number(venue.location.latitude) : null,
    lng: venue?.location ? Number(venue.location.longitude) : null,
    image_url: image?.url || null,
    url: ev.url || null,
    is_free: 0,
    price: range ? `${range.min}–${range.max} ${range.currency === "EUR" ? "€" : range.currency}` : null,
    categories: [...cats],
  };
}

export const ticketmasterAdapter = {
  source: "ticketmaster",
  fetchAll: fetchTicketmaster,
  // Discovery API has no changed-since filter; refreshed only on the full sweep
  fetchChangedSince: null,
};

export async function fetchTicketmaster({ days = 45 } = {}) {
  const apikey = process.env.TICKETMASTER_API_KEY;
  if (!apikey) {
    console.log("[ticketmaster] TICKETMASTER_API_KEY not set — skipping (get a free key at developer.ticketmaster.com)");
    return null; // null = source not available, distinct from 0 events
  }
  const endDateTime = new Date(Date.now() + days * 86400_000).toISOString().replace(/\.\d+Z$/, "Z");
  const out = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      apikey,
      // ~40 km around central Helsinki covers all of populated Uusimaa
      // (Espoo Metro Areena, Vantaa venues, Kirkkonummi, Järvenpää…)
      latlong: "60.1699,24.9384",
      radius: "40",
      unit: "km",
      countryCode: "FI",
      size: String(PAGE_SIZE),
      page: String(page),
      sort: "date,asc",
      endDateTime,
    });
    const res = await fetch(`${API}?${params}`);
    if (!res.ok) throw new Error(`ticketmaster HTTP ${res.status}`);
    const data = await res.json();
    const events = data._embedded?.events || [];
    for (const ev of events) {
      const n = normalize(ev);
      if (n.start_time && n.title) out.push(n);
    }
    if (page >= (data.page?.totalPages ?? 1) - 1) break;
  }
  return out;
}

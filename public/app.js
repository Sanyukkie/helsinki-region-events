const API_BASE = "/api/events";
const PAGE_SIZE = 24;

const state = {
  range: "today",
  category: "",
  text: "",
  freeOnly: false,
  ongoing: false,
  view: "list",
  page: 1,
  hasMore: false,
  events: [],
};

const els = {
  events: document.getElementById("events"),
  map: document.getElementById("map"),
  status: document.getElementById("status"),
  count: document.getElementById("result-count"),
  loadMore: document.getElementById("load-more"),
  search: document.getElementById("search"),
};

let map = null;
let markers = [];

// ---------- favorites (localStorage, keyed by stable_key) ----------

const favs = new Set(JSON.parse(localStorage.getItem("favs") || "[]"));
function saveFavs() {
  localStorage.setItem("favs", JSON.stringify([...favs]));
}

// ---------- helpers ----------

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function dateRange(range) {
  const now = new Date();
  const today = isoDate(now);
  switch (range) {
    case "today":
      return { start: today, end: today };
    case "tomorrow": {
      const t = new Date(now);
      t.setDate(t.getDate() + 1);
      return { start: isoDate(t), end: isoDate(t) };
    }
    case "weekend": {
      const day = now.getDay(); // 0 Sun ... 6 Sat
      const sat = new Date(now);
      if (day === 0) sat.setDate(sat.getDate() - 1);
      else sat.setDate(sat.getDate() + ((6 - day) % 7));
      const sun = new Date(sat);
      sun.setDate(sat.getDate() + 1);
      const start = day === 0 || day === 6 ? today : isoDate(sat);
      return { start, end: isoDate(sun) };
    }
    case "week": {
      const end = new Date(now);
      end.setDate(end.getDate() + 7);
      return { start: today, end: isoDate(end) };
    }
    default:
      return { start: today, end: null };
  }
}

function buildUrl() {
  if (state.view === "saved") {
    const params = new URLSearchParams({ keys: [...favs].join(","), page_size: 100 });
    return `${API_BASE}?${params.toString()}`;
  }
  const { start, end } = dateRange(state.range);
  const params = new URLSearchParams({ start, page: state.page, page_size: PAGE_SIZE });
  if (end) params.set("end", end);
  if (state.category) params.set("category", state.category);
  if (state.text) params.set("text", state.text);
  if (state.freeOnly) params.set("free", "1");
  if (state.ongoing) params.set("ongoing", "1");
  return `${API_BASE}?${params.toString()}`;
}

const fmtDate = new Intl.DateTimeFormat("en-GB", {
  weekday: "short", day: "numeric", month: "short",
  hour: "2-digit", minute: "2-digit",
  timeZone: "Europe/Helsinki",
});

function formatWhen(ev) {
  if (!ev.start_time) return "Time TBA";
  const now = new Date();
  if (new Date(ev.start_time) < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
    if (ev.end_time) {
      const endDay = new Intl.DateTimeFormat("en-GB", {
        day: "numeric", month: "short", timeZone: "Europe/Helsinki",
      }).format(new Date(ev.end_time));
      return `Ongoing · until ${endDay}`;
    }
    return "Ongoing";
  }
  const s = fmtDate.format(new Date(ev.start_time));
  if (ev.end_time && ev.start_time.slice(0, 10) === ev.end_time.slice(0, 10)) {
    const endTime = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit", minute: "2-digit", timeZone: "Europe/Helsinki",
    }).format(new Date(ev.end_time));
    return `${s} – ${endTime}`;
  }
  return s;
}

function priceLabel(ev) {
  if (ev.is_free === 1) return { label: "Free", free: true };
  if (ev.price) return { label: /€|eur/i.test(ev.price) ? ev.price : `${ev.price} €`, free: false };
  // publisher says it's paid but gave no amount ("see website" etc.)
  if (ev.is_free === 0) return { label: "Paid · price on site", free: false, muted: true };
  return null;
}

function eventLinks(ev) {
  const tm = (ev.sources || []).find((s) => s.source === "ticketmaster");
  const primary = (ev.sources || []).find((s) => s.url); // some Espoo events have no info URL
  return {
    main: (primary && primary.url) || null,
    tickets: tm && tm.url,
  };
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s ?? "";
  return div.innerHTML;
}

// ---------- rendering ----------

function renderCard(ev) {
  const links = eventLinks(ev);
  const price = priceLabel(ev);
  const card = document.createElement("article");
  card.className = "card";
  card.dataset.key = ev.stable_key || "";
  card.innerHTML = `
    <button class="star ${favs.has(ev.stable_key) ? "on" : ""}" data-key="${escapeHtml(ev.stable_key || "")}"
      aria-label="Save event" title="Save">★</button>
    ${ev.image_url
      ? `<img class="card-img" src="${escapeHtml(ev.image_url)}" alt="" loading="lazy"
           onerror="this.outerHTML='<div class=&quot;card-img placeholder&quot;>🎪</div>'">`
      : `<div class="card-img placeholder">🎪</div>`}
    <div class="card-body">
      <div class="card-date">${escapeHtml(formatWhen(ev))}</div>
      <h2 class="card-title">${links.main
        ? `<a href="${escapeHtml(links.main)}" target="_blank" rel="noopener">${escapeHtml(ev.title)}</a>`
        : escapeHtml(ev.title)}</h2>
      <div class="card-venue">📍 ${escapeHtml(ev.venue_name || "")}${ev.venue_address ? " · " + escapeHtml(ev.venue_address) : ""}</div>
      ${ev.description ? `<div class="card-desc">${escapeHtml(ev.description)}</div>` : ""}
      <div class="card-foot">
        ${price ? `<span class="price ${price.free ? "free" : ""}${price.muted ? " muted" : ""}">${escapeHtml(price.label)}</span>` : "<span></span>"}
        ${links.tickets ? `<a class="tickets-link" href="${escapeHtml(links.tickets)}" target="_blank" rel="noopener">Tickets →</a>` : ""}
      </div>
    </div>`;
  return card;
}

function renderEvents(events, append) {
  if (!append) els.events.innerHTML = "";
  for (const ev of events) els.events.appendChild(renderCard(ev));
}

function renderMap() {
  if (!map) {
    map = L.map("map").setView([60.1699, 24.9384], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
  }
  markers.forEach((m) => m.remove());
  markers = [];
  const bounds = [];
  for (const ev of state.events) {
    if (ev.lat == null || ev.lng == null) continue;
    const links = eventLinks(ev);
    const marker = L.marker([ev.lat, ev.lng]).addTo(map);
    marker.bindPopup(
      `<div class="popup-title">${escapeHtml(ev.title)}</div>
       <div class="popup-meta">${escapeHtml(formatWhen(ev))}<br>${escapeHtml(ev.venue_name || "")}</div>
       ${links.main ? `<a href="${escapeHtml(links.main)}" target="_blank" rel="noopener">Details →</a>` : ""}`
    );
    markers.push(marker);
    bounds.push([ev.lat, ev.lng]);
  }
  if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
  setTimeout(() => map.invalidateSize(), 50);
}

function setStatus(msg) {
  els.status.hidden = !msg;
  els.status.textContent = msg || "";
}

// ---------- detail modal ----------

const modal = document.getElementById("modal");
const modalBody = document.getElementById("modal-body");

function openModal(ev) {
  const links = eventLinks(ev);
  const price = priceLabel(ev);
  const sourceLinks = (ev.sources || [])
    .filter((s) => s.url)
    .map((s) => {
      const label = { linkedevents: "Event page", espoo: "Event page (Espoo)",
                      ticketmaster: "Tickets on Ticketmaster", kide: "Tickets on Kide" }[s.source] || s.source;
      return `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(label)} →</a>`;
    })
    .join("");
  modalBody.innerHTML = `
    ${ev.image_url ? `<img class="modal-img" src="${escapeHtml(ev.image_url)}" alt="">` : ""}
    <div class="modal-content">
      <div class="card-date">${escapeHtml(formatWhen(ev))}</div>
      <h2>${escapeHtml(ev.title)}</h2>
      <div class="card-venue">📍 ${escapeHtml(ev.venue_name || "")}${ev.venue_address ? " · " + escapeHtml(ev.venue_address) : ""}</div>
      ${price ? `<span class="price ${price.free ? "free" : ""}${price.muted ? " muted" : ""}">${escapeHtml(price.label)}</span>` : ""}
      ${ev.description ? `<p class="modal-desc">${escapeHtml(ev.description)}</p>` : ""}
      <div class="modal-links">${sourceLinks}</div>
      <button class="chip" id="copy-link">🔗 Copy share link</button>
    </div>`;
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  if (ev.stable_key) history.replaceState(null, "", `#e=${encodeURIComponent(ev.stable_key)}`);
  document.getElementById("copy-link").addEventListener("click", (e) => {
    navigator.clipboard.writeText(location.href).then(() => { e.target.textContent = "✓ Copied"; });
  });
}

function closeModal() {
  modal.hidden = true;
  document.body.style.overflow = "";
  history.replaceState(null, "", location.pathname + location.search);
}

document.getElementById("modal-close").addEventListener("click", closeModal);
modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) closeModal(); });

async function openFromHash() {
  const m = /^#e=(.+)$/.exec(location.hash);
  if (!m) return;
  try {
    const res = await fetch(`${API_BASE}?keys=${encodeURIComponent(decodeURIComponent(m[1]))}`);
    const { data } = await res.json();
    if (data[0]) openModal(data[0]);
  } catch { /* stale link — ignore */ }
}

// ---------- data ----------

async function fetchEvents({ append = false } = {}) {
  if (!append) {
    state.page = 1;
    state.events = [];
    els.events.innerHTML = "";
    els.count.textContent = "";
  }
  if (state.view === "saved" && favs.size === 0) {
    setStatus("Nothing saved yet — tap the ★ on any event card.");
    els.loadMore.hidden = true;
    return;
  }
  setStatus(append ? "" : "Loading events…");
  els.loadMore.hidden = true;
  try {
    const res = await fetch(buildUrl());
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const { meta, data } = await res.json();
    state.hasMore = meta.has_more;
    state.events = state.events.concat(data);
    setStatus(meta.count === 0
      ? (state.view === "saved"
          ? "Your saved events are all in the past."
          : "No events found. If the server just started, ingestion may still be running — try again in a minute.")
      : "");
    els.count.textContent = meta.count ? `${meta.count.toLocaleString("en")} events` : "";
    renderEvents(data, append);
    if (state.view === "map") renderMap();
    els.loadMore.hidden = !state.hasMore || state.view !== "list";
  } catch (err) {
    setStatus(`Could not load events: ${err.message}`);
  }
}

// ---------- wiring ----------

document.getElementById("date-filters").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-range]");
  if (!btn) return;
  document.querySelectorAll("#date-filters .chip").forEach((c) => c.classList.remove("active"));
  btn.classList.add("active");
  state.range = btn.dataset.range;
  fetchEvents();
});

document.getElementById("category-filters").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-category]");
  if (!btn) return;
  document.querySelectorAll("#category-filters .chip").forEach((c) => c.classList.remove("active"));
  btn.classList.add("active");
  state.category = btn.dataset.category;
  fetchEvents();
});

document.getElementById("free-toggle").addEventListener("click", (e) => {
  state.freeOnly = !state.freeOnly;
  e.target.classList.toggle("active", state.freeOnly);
  fetchEvents();
});

document.getElementById("ongoing-toggle").addEventListener("click", (e) => {
  state.ongoing = !state.ongoing;
  e.target.classList.toggle("active", state.ongoing);
  fetchEvents();
});

let searchTimer = null;
els.search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.text = els.search.value.trim();
    fetchEvents();
  }, 350);
});

function setView(view) {
  state.view = view;
  for (const id of ["view-list", "view-map", "view-saved"]) {
    document.getElementById(id).classList.toggle("active", id === `view-${view}`);
  }
  els.map.hidden = view !== "map";
  els.events.hidden = view === "map";
  if (view === "map") {
    els.loadMore.hidden = true;
    renderMap();
  } else {
    fetchEvents();
  }
}
document.getElementById("view-list").addEventListener("click", () => setView("list"));
document.getElementById("view-map").addEventListener("click", () => setView("map"));
document.getElementById("view-saved").addEventListener("click", () => setView("saved"));

// stars toggle favorites; clicking anywhere else on a card opens the detail modal
els.events.addEventListener("click", (e) => {
  const star = e.target.closest(".star");
  if (star) {
    const key = star.dataset.key;
    if (!key) return;
    favs.has(key) ? favs.delete(key) : favs.add(key);
    saveFavs();
    star.classList.toggle("on", favs.has(key));
    if (state.view === "saved") fetchEvents();
    return;
  }
  if (e.target.closest("a")) return; // let links be links
  const card = e.target.closest(".card");
  if (!card) return;
  const ev = state.events.find((x) => x.stable_key === card.dataset.key);
  if (ev) openModal(ev);
});

els.loadMore.addEventListener("click", () => {
  state.page += 1;
  fetchEvents({ append: true });
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => { /* preview/http contexts */ });
}

fetchEvents();
openFromHash();

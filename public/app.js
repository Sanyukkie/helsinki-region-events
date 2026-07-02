const API_BASE = "/api/events";
const PAGE_SIZE = 24;

// ===== category system (colors from the NYT. design) =====

const CATS = [
  { key: "music", label: "Music", color: "#FF3D8B" },
  { key: "student", label: "Student & club", color: "#C9F24E" },
  { key: "kids", label: "Kids", color: "#58D6E8" },
  { key: "theatre", label: "Theatre", color: "#B98BFF" },
  { key: "dance", label: "Dance", color: "#FF8A3D" },
  { key: "visualarts", label: "Visual arts", color: "#F2C84E" },
  { key: "sports", label: "Sports", color: "#5CE0A0" },
  { key: "food", label: "Food", color: "#FF6B5C" },
  { key: "film", label: "Film", color: "#9FB0FF" },
];

const RISO = {
  music: "linear-gradient(125deg,#FF3D8B,#7A2BE2 60%,#C9F24E)",
  student: "linear-gradient(125deg,#C9F24E,#12B981 55%,#3B82F6)",
  kids: "linear-gradient(125deg,#58D6E8,#3B82F6 60%,#C9F24E)",
  theatre: "linear-gradient(125deg,#B98BFF,#FF3D8B 60%,#FF8A3D)",
  dance: "linear-gradient(125deg,#FF8A3D,#FF3D8B 60%,#B98BFF)",
  visualarts: "linear-gradient(125deg,#F2C84E,#FF8A3D 55%,#FF3D8B)",
  sports: "linear-gradient(125deg,#5CE0A0,#12B981 55%,#C9F24E)",
  food: "linear-gradient(125deg,#FF6B5C,#FF8A3D 55%,#F2C84E)",
  film: "linear-gradient(125deg,#9FB0FF,#7A2BE2 60%,#FF3D8B)",
  other: "linear-gradient(125deg,#8B8892,#5A5762 60%,#C9F24E)",
};

const WASH = {
  music: "rgba(255,61,139,.5)", student: "rgba(201,242,78,.4)", kids: "rgba(88,214,232,.45)",
  theatre: "rgba(185,139,255,.45)", dance: "rgba(255,138,61,.45)", visualarts: "rgba(242,200,78,.4)",
  sports: "rgba(92,224,160,.4)", food: "rgba(255,107,92,.45)", film: "rgba(159,176,255,.45)",
  other: "rgba(139,136,146,.4)",
};

function catOf(ev) {
  const key = (ev.categories || [])[0];
  return CATS.find((c) => c.key === key) || { key: "other", label: "Event", color: "#8B8892" };
}

// ===== state =====

const state = {
  view: "feed", // feed | map | saved
  range: "today",
  cats: {}, // key -> 'include' | 'exclude'
  freeOnly: false,
  ongoing: false,
  text: "",
  page: 1,
  hasMore: false,
  totalCount: 0,
  events: [],
};

const els = {};
for (const id of ["header", "search-row", "search", "pill-row", "open-filters", "filter-count",
  "date-pill", "free-pill", "ongoing-pill", "summary-row", "result-count", "summary-tags",
  "status", "events", "map-wrap", "map", "map-note", "map-sel", "load-more",
  "nav-feed", "nav-map", "nav-saved", "saved-badge",
  "sheet-backdrop", "filter-sheet", "sheet-dates", "sheet-cats", "hidden-box", "hidden-cats",
  "sheet-free", "sheet-ongoing", "reset-filters", "close-filters",
  "detail-backdrop", "detail-sheet", "toast", "search-toggle", "theme-toggle"]) {
  els[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = document.getElementById(id);
}

// ===== favorites =====

const favs = new Set(JSON.parse(localStorage.getItem("favs") || "[]"));
function saveFavs() {
  localStorage.setItem("favs", JSON.stringify([...favs]));
  els.savedBadge.hidden = favs.size === 0;
  els.savedBadge.textContent = favs.size;
}

// ===== theme =====

function applyTheme() {
  const saved = localStorage.getItem("theme");
  if (saved) document.documentElement.dataset.theme = saved;
  else delete document.documentElement.dataset.theme;
}
els.themeToggle.addEventListener("click", () => {
  const cur = document.documentElement.dataset.theme ||
    (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  localStorage.setItem("theme", cur === "dark" ? "light" : "dark");
  applyTheme();
});
applyTheme();

// ===== helpers =====

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s ?? "";
  return div.innerHTML;
}

function isoDate(d) { return d.toISOString().slice(0, 10); }

function dateRange(range) {
  const now = new Date();
  const today = isoDate(now);
  switch (range) {
    case "today": return { start: today, end: today };
    case "tomorrow": {
      const t = new Date(now); t.setDate(t.getDate() + 1);
      return { start: isoDate(t), end: isoDate(t) };
    }
    case "weekend": {
      const day = now.getDay();
      const sat = new Date(now);
      if (day === 0) sat.setDate(sat.getDate() - 1);
      else sat.setDate(sat.getDate() + ((6 - day) % 7));
      const sun = new Date(sat); sun.setDate(sat.getDate() + 1);
      return { start: day === 0 || day === 6 ? today : isoDate(sat), end: isoDate(sun) };
    }
    case "week": {
      const end = new Date(now); end.setDate(end.getDate() + 7);
      return { start: today, end: isoDate(end) };
    }
    default: return { start: today, end: null };
  }
}

const DATE_LABELS = { today: "Today", tomorrow: "Tomorrow", weekend: "This weekend", week: "Next 7 days", all: "All upcoming" };
const DATE_SHORT = { today: "Today", tomorrow: "Tomorrow", weekend: "Weekend", week: "Next 7d", all: "All" };

const fmtTime = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Helsinki" });
const fmtDay = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Helsinki" });
const fmtDayFull = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Helsinki" });
const fmtShortDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Europe/Helsinki" });

// all day math happens in Helsinki-local dates (YYYY-MM-DD), not UTC
const fmtKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Helsinki", year: "numeric", month: "2-digit", day: "2-digit" });
function hkiDate(d) { return fmtKey.format(d); }

function isOngoingNow(ev) {
  return ev.start_time && hkiDate(new Date(ev.start_time)) < hkiDate(new Date());
}

function timeShort(ev) {
  if (!ev.start_time) return "Time TBA";
  if (isOngoingNow(ev)) {
    return ev.end_time ? `Until ${fmtShortDate.format(new Date(ev.end_time))}` : "Ongoing";
  }
  return fmtTime.format(new Date(ev.start_time));
}

function priceKind(ev) {
  if (ev.is_free === 1) return { kind: "free", label: "FREE" };
  if (ev.price) return { kind: "paid", label: /€|eur/i.test(ev.price) ? ev.price : `${ev.price} €` };
  if (ev.is_free === 0) return { kind: "onsite", label: "Price on site" };
  return null;
}

function priceTag(ev, cls = "price") {
  const p = priceKind(ev);
  return p ? `<span class="${cls} ${p.kind}">${escapeHtml(p.label)}</span>` : "<span></span>";
}

function eventLinks(ev) {
  const tm = (ev.sources || []).find((s) => (s.source === "ticketmaster" || s.source === "kide") && s.url);
  const primary = (ev.sources || []).find((s) => s.url);
  return {
    main: (primary && primary.url) || null,
    tickets: tm && tm.url,
    ticketSrc: tm ? (tm.source === "kide" ? "Kide.app" : "Ticketmaster") : null,
  };
}

function starGlyph(key) { return favs.has(key) ? "★" : "☆"; }

// ===== fetch =====

function filterCount() {
  let n = 0;
  if (state.range !== "today") n++;
  n += Object.keys(state.cats).filter((k) => state.cats[k]).length;
  if (state.freeOnly) n++;
  if (state.ongoing) n++;
  return n;
}

function buildUrl(pageSize = PAGE_SIZE) {
  if (state.view === "saved") {
    return `${API_BASE}?${new URLSearchParams({ keys: [...favs].join(","), page_size: 100 })}`;
  }
  const { start, end } = dateRange(state.range);
  const params = new URLSearchParams({ start, page: state.page, page_size: pageSize });
  if (end) params.set("end", end);
  const inc = Object.keys(state.cats).filter((k) => state.cats[k] === "include");
  const exc = Object.keys(state.cats).filter((k) => state.cats[k] === "exclude");
  if (inc.length) params.set("categories", inc.join(","));
  if (exc.length) params.set("exclude", exc.join(","));
  if (state.text) params.set("text", state.text);
  if (state.freeOnly) params.set("free", "1");
  if (state.ongoing) params.set("ongoing", "1");
  return `${API_BASE}?${params.toString()}`;
}

function setStatus(msg) {
  els.status.hidden = !msg;
  els.status.textContent = msg || "";
}

async function fetchEvents({ append = false } = {}) {
  if (!append) { state.page = 1; state.events = []; }
  if (state.view === "saved" && favs.size === 0) {
    state.events = []; state.totalCount = 0;
    render();
    return;
  }
  if (!append) setStatus("Loading…");
  els.loadMore.hidden = true;
  try {
    const pageSize = state.view === "map" ? 100 : PAGE_SIZE;
    const res = await fetch(buildUrl(pageSize));
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const { meta, data } = await res.json();
    state.hasMore = meta.has_more;
    state.totalCount = meta.count;
    state.events = state.events.concat(data);
    setStatus("");
    render();
  } catch (err) {
    setStatus(`Could not load events: ${err.message}`);
  }
}

// ===== feed rendering =====

function dayKey(ev) {
  const today = hkiDate(new Date());
  const start = hkiDate(new Date(ev.start_time));
  return start < today ? today : start;
}

function dayLabel(key) {
  const now = new Date();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const base = fmtDay.format(new Date(key + "T12:00:00")).toUpperCase();
  if (key === hkiDate(now)) return `TODAY · ${base}`;
  if (key === hkiDate(tomorrow)) return `TOMORROW · ${base}`;
  return base;
}

function mediaHtml(ev, cat, cls) {
  if (ev.image_url) {
    return `<div class="${cls}" style="background-image:url('${escapeHtml(ev.image_url)}')"></div>`;
  }
  return `<div class="${cls} riso" style="background:${RISO[cat.key] || RISO.other}"><span>${escapeHtml(cat.key)}</span></div>`;
}

function heroHtml(ev, isToday) {
  const cat = catOf(ev);
  const media = ev.image_url
    ? `<div class="hero-media" style="background-image:url('${escapeHtml(ev.image_url)}')"></div>`
    : `<div class="hero-media" style="background:${RISO[cat.key] || RISO.other}"></div>`;
  return `
  <article class="hero" data-key="${escapeHtml(ev.stable_key)}">
    ${media}
    <div class="hero-overlay" style="--hero-wash:${WASH[cat.key] || WASH.other}"></div>
    <div class="hero-badge">● ${isToday ? "TONIGHT" : "FEATURED"}</div>
    <button class="star-btn ${favs.has(ev.stable_key) ? "on" : ""}" data-star="${escapeHtml(ev.stable_key)}" aria-label="Save">${starGlyph(ev.stable_key)}</button>
    <div class="hero-text">
      <div class="hero-cat mono">${escapeHtml(cat.label.toUpperCase())} · ${escapeHtml(ev.venue_name || "")}</div>
      <div class="hero-title">${escapeHtml(ev.title)}</div>
      <div class="hero-foot">
        <div class="hero-meta">${escapeHtml(timeShort(ev))}${ev.venue_name ? " · " + escapeHtml(ev.venue_name) : ""}</div>
        ${priceTag(ev)}
      </div>
    </div>
  </article>`;
}

function cardHtml(ev) {
  const cat = catOf(ev);
  return `
  <article class="card" data-key="${escapeHtml(ev.stable_key)}">
    ${mediaHtml(ev, cat, "card-media")}
    <div class="card-body">
      <div class="card-cat-row">
        <span class="cat-dot" style="background:${cat.color}"></span>
        <span class="card-cat mono">${escapeHtml(cat.label)}</span>
        ${isOngoingNow(ev) ? '<span class="ongoing-tag">ONGOING</span>' : ""}
      </div>
      <div class="card-title">${escapeHtml(ev.title)}</div>
      <div class="card-foot">
        <span class="card-meta">${escapeHtml(timeShort(ev))}${ev.venue_name ? " · " + escapeHtml(ev.venue_name) : ""}</span>
        ${priceTag(ev)}
      </div>
    </div>
    <button class="star-btn ${favs.has(ev.stable_key) ? "on" : ""}" data-star="${escapeHtml(ev.stable_key)}" aria-label="Save">${starGlyph(ev.stable_key)}</button>
  </article>`;
}

function compactHtml(ev) {
  const cat = catOf(ev);
  return `
  <article class="compact" data-key="${escapeHtml(ev.stable_key)}">
    <span class="cat-dot" style="background:${cat.color}"></span>
    <div class="compact-main">
      <div class="compact-title">${escapeHtml(ev.title)}</div>
      <div class="compact-meta">${escapeHtml(timeShort(ev))}${ev.venue_name ? " · " + escapeHtml(ev.venue_name) : ""}</div>
    </div>
    ${priceTag(ev)}
  </article>`;
}

function savedHtml(ev) {
  const cat = catOf(ev);
  return `
  <article class="saved-card" data-key="${escapeHtml(ev.stable_key)}">
    <div class="saved-bar" style="background:${cat.color}"></div>
    <div class="saved-body">
      <div class="card-cat mono" style="margin-bottom:4px">${escapeHtml(cat.label.toUpperCase())}</div>
      <div class="card-title">${escapeHtml(ev.title)}</div>
      <div class="card-foot">
        <span class="card-meta">${escapeHtml(timeShort(ev))}${ev.venue_name ? " · " + escapeHtml(ev.venue_name) : ""}</span>
        ${priceTag(ev)}
      </div>
    </div>
    <button class="saved-unstar" data-star="${escapeHtml(ev.stable_key)}" aria-label="Remove">★</button>
  </article>`;
}

function emptyHtml(title, sub, ctaLabel, ctaId) {
  return `
  <div class="empty">
    <div class="empty-glyph">${state.view === "saved" ? "★" : "◍"}</div>
    <div class="empty-title">${title}</div>
    <div class="empty-sub">${sub}</div>
    ${ctaLabel ? `<button class="cta" id="${ctaId}">${ctaLabel}</button>` : ""}
  </div>`;
}

function renderFeed() {
  const evs = state.events;
  if (evs.length === 0) {
    els.events.innerHTML = state.view === "saved"
      ? emptyHtml("Nothing saved yet", "Tap the star on any event and it lands here — your shortlist for the weekend, ready to share in the group chat.", "Browse what's on →", "empty-browse")
      : emptyHtml("Nothing matches", "Your filters are a little tight. Try clearing a category you're hiding, or widen the dates.", "Reset filters", "empty-reset");
    els.loadMore.hidden = true;
    return;
  }

  let html = "";
  if (state.view === "saved") {
    html += `<div class="day-head"><div class="day-label mono">★ SAVED EVENTS</div><div class="day-count mono">${evs.length}</div></div>`;
    html += evs.map(savedHtml).join("");
  } else if (state.ongoing) {
    html += `<div class="day-head"><div class="day-label mono">■ ONGOING — ENDING SOONEST</div><div class="day-count mono">${state.totalCount}</div></div>`;
    html += evs.map(cardHtml).join("");
  } else {
    const todayKey = hkiDate(new Date());
    let curDay = null;
    let heroUsed = false;
    const groups = {};
    for (const ev of evs) (groups[dayKey(ev)] = groups[dayKey(ev)] || []).push(ev);
    for (const key of Object.keys(groups).sort()) {
      const list = groups[key];
      html += `<div class="day-head"><div class="day-label mono">■ ${dayLabel(key)}</div><div class="day-count mono">${list.length} event${list.length === 1 ? "" : "s"}</div></div>`;
      for (const ev of list) {
        if (!heroUsed && ev.score >= 8) {
          html += heroHtml(ev, key === todayKey);
          heroUsed = true;
        } else if (ev.score >= 4 || ev.image_url || isOngoingNow(ev)) {
          html += cardHtml(ev);
        } else {
          html += compactHtml(ev);
        }
      }
    }
  }
  els.events.innerHTML = html;
  els.loadMore.hidden = !state.hasMore || state.view !== "feed";
  document.getElementById("empty-reset")?.addEventListener("click", resetFilters);
  document.getElementById("empty-browse")?.addEventListener("click", () => setView("feed"));
}

// ===== summary + pills =====

function renderPills() {
  const n = filterCount();
  els.openFilters.classList.toggle("on", n > 0);
  els.filterCount.hidden = n === 0;
  els.filterCount.textContent = n;
  els.datePill.textContent = `${DATE_SHORT[state.range]} ▾`;
  els.freePill.classList.toggle("on", state.freeOnly);
  els.ongoingPill.classList.toggle("on", state.ongoing);

  els.summaryRow.hidden = state.view === "saved";
  els.resultCount.textContent = state.view === "saved" ? "" : `${(state.totalCount || 0).toLocaleString("en")} events`;
  let tags = "";
  if (n > 0) {
    tags += `<span class="sum-tag">${DATE_LABELS[state.range]}</span>`;
    for (const c of CATS) {
      if (state.cats[c.key] === "include") tags += `<span class="sum-tag inc">＋ ${c.label}</span>`;
      if (state.cats[c.key] === "exclude") tags += `<span class="sum-tag exc">⦸ ${c.label}</span>`;
    }
    if (state.freeOnly) tags += `<span class="sum-tag inc">Free</span>`;
    if (state.ongoing) tags += `<span class="sum-tag">Ongoing</span>`;
  }
  els.summaryTags.innerHTML = tags;
}

// ===== filter sheet =====

function renderSheet() {
  els.sheetDates.innerHTML = Object.entries(DATE_LABELS).map(([k, l]) =>
    `<button class="chip ${state.range === k ? "date-on" : ""}" data-date="${k}">${l}</button>`).join("");

  els.sheetCats.innerHTML = CATS.map((c) => {
    const st = state.cats[c.key];
    const cls = st === "include" ? "inc" : st === "exclude" ? "exc" : "";
    const glyph = st === "include" ? "✓" : st === "exclude" ? "⦸" : "＋";
    const extra = st === "exclude" ? ' <span style="font-weight:600;opacity:.8">· hidden</span>' : "";
    return `<button class="chip ${cls}" data-cat="${c.key}">${glyph} ${c.label}${extra}</button>`;
  }).join("");

  const hidden = CATS.filter((c) => state.cats[c.key] === "exclude");
  els.hiddenBox.hidden = hidden.length === 0;
  els.hiddenCats.innerHTML = hidden.map((c) =>
    `<button class="chip exc" data-clear="${c.key}">${c.label} ✕</button>`).join("");

  els.sheetFree.querySelector(".switch").classList.toggle("on", state.freeOnly);
  els.sheetOngoing.querySelector(".switch").classList.toggle("on", state.ongoing);
  els.closeFilters.textContent = `Show ${(state.totalCount || 0).toLocaleString("en")} events`;
}

function openSheet() {
  els.sheetBackdrop.hidden = false;
  els.filterSheet.hidden = false;
  renderSheet();
}
function closeSheet() {
  els.sheetBackdrop.hidden = true;
  els.filterSheet.hidden = true;
}

function resetFilters() {
  state.range = "today";
  state.cats = {};
  state.freeOnly = false;
  state.ongoing = false;
  state.text = "";
  els.search.value = "";
  renderSheet();
  fetchEvents();
}

els.filterSheet.addEventListener("click", (e) => {
  const dateBtn = e.target.closest("[data-date]");
  if (dateBtn) { state.range = dateBtn.dataset.date; renderSheet(); fetchEvents(); return; }
  const catBtn = e.target.closest("[data-cat]");
  if (catBtn) {
    const k = catBtn.dataset.cat;
    const cur = state.cats[k];
    if (!cur) state.cats[k] = "include";
    else if (cur === "include") state.cats[k] = "exclude";
    else delete state.cats[k];
    renderSheet(); fetchEvents(); return;
  }
  const clearBtn = e.target.closest("[data-clear]");
  if (clearBtn) { delete state.cats[clearBtn.dataset.clear]; renderSheet(); fetchEvents(); }
});

els.openFilters.addEventListener("click", openSheet);
els.datePill.addEventListener("click", openSheet);
els.sheetBackdrop.addEventListener("click", closeSheet);
els.closeFilters.addEventListener("click", closeSheet);
els.resetFilters.addEventListener("click", resetFilters);

els.sheetFree.addEventListener("click", () => { state.freeOnly = !state.freeOnly; renderSheet(); fetchEvents(); });
els.sheetOngoing.addEventListener("click", () => { state.ongoing = !state.ongoing; renderSheet(); fetchEvents(); });
els.freePill.addEventListener("click", () => { state.freeOnly = !state.freeOnly; fetchEvents(); });
els.ongoingPill.addEventListener("click", () => { state.ongoing = !state.ongoing; fetchEvents(); });

// ===== detail sheet =====

let toastTimer = null;
function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 1600);
}

function openDetail(ev) {
  const cat = catOf(ev);
  const links = eventLinks(ev);
  const p = priceKind(ev);
  const ongoing = isOngoingNow(ev);
  const media = ev.image_url
    ? `<div class="detail-media" style="background-image:url('${escapeHtml(ev.image_url)}')">`
    : `<div class="detail-media" style="background:${RISO[cat.key] || RISO.other}">
         <div class="detail-riso-label">${escapeHtml(cat.label)}</div>`;
  const dateFull = ev.start_time
    ? (ongoing ? "Ongoing" : fmtDayFull.format(new Date(ev.start_time)))
    : "Date TBA";
  let timeFull = "";
  if (ongoing && ev.end_time) timeFull = `Until ${fmtShortDate.format(new Date(ev.end_time))}`;
  else if (ev.start_time) {
    timeFull = fmtTime.format(new Date(ev.start_time));
    if (ev.end_time && ev.end_time.slice(0, 10) === ev.start_time.slice(0, 10)) {
      timeFull += ` – ${fmtTime.format(new Date(ev.end_time))}`;
    }
  }

  els.detailSheet.innerHTML = `
    ${media}
      <div class="detail-media-fade"></div>
      <button class="detail-close" id="detail-close" aria-label="Close">✕</button>
      <button class="detail-star ${favs.has(ev.stable_key) ? "on" : ""}" data-star="${escapeHtml(ev.stable_key)}" aria-label="Save">${starGlyph(ev.stable_key)}</button>
    </div>
    <div class="detail-body">
      <div class="detail-tags">
        <span class="detail-cat" style="background:${cat.color}">${escapeHtml(cat.label)}</span>
        ${p ? `<span class="price ${p.kind}">${escapeHtml(p.label)}</span>` : ""}
      </div>
      <div class="detail-title">${escapeHtml(ev.title)}</div>
      <div class="detail-row"><span class="detail-ico">◷</span><div>
        <div class="detail-row-main">${escapeHtml(dateFull)}</div>
        <div class="detail-row-sub">${escapeHtml(timeFull)}</div>
      </div></div>
      <div class="detail-row"><span class="detail-ico">◈</span><div>
        <div class="detail-row-main">${escapeHtml(ev.venue_name || "Venue TBA")}</div>
        <div class="detail-row-sub">${escapeHtml(ev.venue_address || "")}</div>
      </div></div>
      ${ev.description ? `<div class="detail-desc">${escapeHtml(ev.description)}</div>` : ""}
      <div class="detail-actions">
        ${links.tickets ? `<a class="action-primary" href="${escapeHtml(links.tickets)}" target="_blank" rel="noopener">Get tickets · ${escapeHtml(links.ticketSrc)} ↗</a>` : ""}
        ${links.main ? `<a class="action-secondary" href="${escapeHtml(links.main)}" target="_blank" rel="noopener">Event page ↗</a>` : ""}
        <button class="action-ghost" id="copy-link">⧉ Copy share link</button>
      </div>
    </div>`;
  els.detailBackdrop.hidden = false;
  els.detailSheet.hidden = false;
  if (ev.stable_key) history.replaceState(null, "", `#e=${encodeURIComponent(ev.stable_key)}`);
  document.getElementById("detail-close").addEventListener("click", closeDetail);
  document.getElementById("copy-link").addEventListener("click", () => {
    navigator.clipboard?.writeText(location.href).then(() => showToast("Link copied to clipboard"));
  });
}

function closeDetail() {
  els.detailBackdrop.hidden = true;
  els.detailSheet.hidden = true;
  history.replaceState(null, "", location.pathname + location.search);
}
els.detailBackdrop.addEventListener("click", closeDetail);
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!els.detailSheet.hidden) closeDetail();
  else if (!els.filterSheet.hidden) closeSheet();
});

async function openFromHash() {
  const m = /^#e=(.+)$/.exec(location.hash);
  if (!m) return;
  try {
    const res = await fetch(`${API_BASE}?keys=${encodeURIComponent(decodeURIComponent(m[1]))}`);
    const { data } = await res.json();
    if (data[0]) openDetail(data[0]);
  } catch { /* stale link */ }
}

// ===== map =====

let map = null;
let markers = [];

function renderMap() {
  if (!map) {
    map = L.map("map", { zoomControl: false }).setView([60.1699, 24.9384], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
  }
  markers.forEach((m) => m.remove());
  markers = [];
  const bounds = [];
  let noCoord = 0;
  for (const ev of state.events) {
    if (ev.lat == null || ev.lng == null) { noCoord++; continue; }
    const cat = catOf(ev);
    const big = ev.score >= 8;
    const size = big ? 26 : 18;
    const icon = L.divIcon({
      className: "",
      html: `<span class="map-pin" style="width:${size}px;height:${size}px;background:${cat.color}"></span>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size],
    });
    const marker = L.marker([ev.lat, ev.lng], { icon, zIndexOffset: big ? 500 : 0 }).addTo(map);
    marker.on("click", () => showMapSel(ev));
    markers.push(marker);
    bounds.push([ev.lat, ev.lng]);
  }
  els.mapNote.hidden = noCoord === 0;
  els.mapNote.textContent = `◍ ${noCoord} event${noCoord === 1 ? " has" : "s have"} no location — see list`;
  els.mapSel.hidden = true;
  if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
  setTimeout(() => map.invalidateSize(), 60);
}

function showMapSel(ev) {
  const cat = catOf(ev);
  els.mapSel.innerHTML = `
    <span class="cat-dot" style="width:10px;height:10px;background:${cat.color}"></span>
    <div class="map-sel-main">
      <div class="map-sel-title">${escapeHtml(ev.title)}</div>
      <div class="map-sel-meta">${escapeHtml(timeShort(ev))}${ev.venue_name ? " · " + escapeHtml(ev.venue_name) : ""}</div>
    </div>
    ${priceTag(ev)}
    <span class="map-sel-arrow">→</span>`;
  els.mapSel.hidden = false;
  els.mapSel.onclick = () => openDetail(ev);
}

// ===== views =====

function setView(view) {
  state.view = view;
  els.navFeed.classList.toggle("active", view === "feed");
  els.navMap.classList.toggle("active", view === "map");
  els.navSaved.classList.toggle("active", view === "saved");
  els.mapWrap.hidden = view !== "map";
  els.events.hidden = view === "map";
  els.pillRow.hidden = view === "saved";
  fetchEvents();
}
els.navFeed.addEventListener("click", () => setView("feed"));
els.navMap.addEventListener("click", () => setView("map"));
els.navSaved.addEventListener("click", () => setView("saved"));

function render() {
  renderPills();
  if (state.view === "map") renderMap();
  else renderFeed();
  if (!els.filterSheet.hidden) renderSheet();
}

// ===== global interactions =====

els.events.addEventListener("click", (e) => {
  const star = e.target.closest("[data-star]");
  if (star) {
    const key = star.dataset.star;
    favs.has(key) ? favs.delete(key) : favs.add(key);
    saveFavs();
    if (state.view === "saved") fetchEvents();
    else render();
    return;
  }
  const card = e.target.closest("[data-key]");
  if (!card) return;
  const ev = state.events.find((x) => x.stable_key === card.dataset.key);
  if (ev) openDetail(ev);
});

els.detailSheet.addEventListener("click", (e) => {
  const star = e.target.closest("[data-star]");
  if (!star) return;
  const key = star.dataset.star;
  favs.has(key) ? favs.delete(key) : favs.add(key);
  saveFavs();
  star.classList.toggle("on", favs.has(key));
  star.textContent = starGlyph(key);
  render();
});

els.searchToggle.addEventListener("click", () => {
  els.searchRow.hidden = !els.searchRow.hidden;
  if (!els.searchRow.hidden) els.search.focus();
});

let searchTimer = null;
els.search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.text = els.search.value.trim();
    fetchEvents();
  }, 350);
});

els.loadMore.addEventListener("click", () => {
  state.page += 1;
  fetchEvents({ append: true });
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

saveFavs();
fetchEvents();
openFromHash();

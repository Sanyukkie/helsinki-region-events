# Design brief — Helsinki Region Events

## What this app is

A mobile-first web app (PWA) that answers one question better than anything else in the
Helsinki metro area: **"what's actually happening around me?"** It aggregates ~3,600
upcoming events from four sources (Helsinki & Espoo city open data — which includes
Vantaa and all metro libraries/museums — Ticketmaster, and Kide.app) into ONE
deduplicated, relevance-ranked feed. Its structural advantages over competitors
(tapahtumat.hel.fi, Facebook events): completeness across sources, one card per event
even when five ticket listings exist, ranking, and a families+youth focus.

## Audience (in priority order)

1. **Young adults (18–30)** — students, expats, young professionals. Looking for: gigs,
   club nights, student parties (sitsit/appro culture), festivals, open-air cinema,
   "what's on tonight". Mobile, spontaneous, share links in group chats.
2. **Parents with kids** — looking for: weekend planning, library/museum programs,
   playground events, free things to do. Often browsing a few days ahead.

The design should feel young and energetic without alienating parents — think "city
culture magazine", not "municipal service portal" (the current competition) and not
"corporate ticketing site".

## Screens & views

### 1. Main feed (default view)
- Vertical list/grid of event cards, chronological by day, **relevance-ranked within
  each day** (the backend scores events: big ticketed shows, events with images,
  music/kids/student events, and cross-source-verified events rank higher).
- Filters currently exposed (all functional, keep the capabilities, redesign the form):
  - Date: Today / Tomorrow / This weekend / Next 7 days / All upcoming
  - Categories (Music / Kids / Student & club / Theatre / Dance / Visual arts / Sports / Food)
    are **tri-state and multi-select**: a category can be *included* (show these — several
    combine as OR), *excluded* (hide these — e.g. a user without kids excludes Kids), or
    neutral. Current interaction is tap-to-cycle include → exclude → neutral; the
    include/exclude affordance needs a much clearer visual language than the current
    yellow-fill vs red-strikethrough chips.
  - Toggles: "Free only", "Exhibitions & ongoing" (switches feed to long-running things,
    sorted by ending-soonest)
  - Free-text search (title, description, venue)
- **Known problem: 15+ filter chips in three rows eat half a phone viewport.** A better
  pattern is wanted (horizontal scroll rows, a filter sheet, collapsed pills — designer's call).

### 2. Map view
- Same result set as pins on a city map (currently Leaflet + OpenStreetMap).
- Pin tap → mini info (title, time, venue) → link to detail.
- Some events (Kide club nights) have no coordinates and only appear in the list.

### 3. Saved (★ favorites)
- Star on any card saves it locally. Saved view lists upcoming saved events.
- Empty states exist: "nothing saved yet" and "your saved events are all in the past".

### 4. Event detail (currently a modal)
- Full image, title, date/time (or "Ongoing · until X"), venue + street address,
  description, price, category, links out: "Event page", "Tickets on Ticketmaster/Kide"
  (an event can have several sources — e.g. city page + ticket shop).
- "Copy share link" — every event has a shareable URL.
- Could stay a modal/bottom-sheet or become a page — designer's call.

## Event card — data available (design for all combinations)

| Field | Notes / edge cases |
|---|---|
| Title | Can be long, Finnish (ä/ö), may contain emoji ("⚽ FIFA WORLD CUP 2026 🔥") |
| Image | **Often missing** (~40%+ of city events) — placeholder treatment is a real design task, current 🎪 emoji is a placeholder-placeholder |
| Date/time | "Thu 3 Jul, 19:00", "19:00 – 23:00", or "Ongoing · until 23 Sept" |
| Venue + address | Venue name sometimes missing; "Internet" for online events |
| Description | 0–2 sentences, often Finnish, sometimes absent |
| Price | "Free" (highlight — matters to both audiences), "12 €", "59–89 €", "Paid · price on site", or unknown (show nothing) |
| Categories | 0–3 of: music, kids, student, theatre, dance, visualarts, sports, food, film |
| Tickets link | Present when Ticketmaster/Kide is a source |
| Star (saved state) | Toggleable on card |

## States to design

- Loading (initial + pagination "Load more")
- Empty results (filter too narrow), empty saved, search no-hits
- Image missing / image failed
- Event with no outbound link (title not clickable)
- First-run while the server is still ingesting ("try again in a minute")

## What's wrong with the current design (why we're here)

- Generic "dark dashboard" look — no brand, no personality, nothing Helsinki about it.
- Filter chip soup: three wrapping rows, 15+ chips, poor mobile ergonomics.
- Every card looks identical — a stadium concert and a knitting circle get equal visual
  weight even though the backend already knows which is "bigger" (score is available to the UI).
- Emoji used as icons and placeholders throughout (📍 🎵 👶 🎪 ★) — fine for a prototype, cheap-looking in a product.
- No typographic hierarchy or rhythm; everything is the same size and weight.
- Yellow accent (#ffd429) was borrowed from Helsinki city brand — keep or replace freely.

## Constraints for the design

- **Mobile-first** (it's an installable PWA; desktop is secondary but should not break).
- Light AND dark mode, or one deliberately chosen mode with rationale.
- Implementation is vanilla HTML/CSS/JS, no framework — favor systemic, token-based
  design (colors, type scale, spacing) over bespoke per-screen art. Avoid interactions
  that require heavy JS libraries.
- Map stays Leaflet/OpenStreetMap (pin + popup styling is customizable).
- Must handle Finnish text lengths (long compound words don't hyphenate nicely).
- Accessibility: real contrast ratios, touch targets ≥ 44px, focus states.

## Deliverables wanted

1. Visual direction: brand feel, color tokens, type scale (Google Fonts ok), spacing system.
2. Mobile mockups: feed (default + filters open), event detail, map, saved, plus an
   empty state and a no-image card.
3. Component sheet: event card variants (hero/big vs standard vs compact; free vs paid;
   with/without image), filter controls, star/save affordance.
4. Desktop adaptation sketch (grid behavior is enough).

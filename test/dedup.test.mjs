import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupe, titleSimilarity } from "../server/dedup.js";

function raw(overrides) {
  return {
    source: "linkedevents", source_id: "x",
    title: "Test event", description: null,
    start_time: "2026-07-10T19:00:00Z", end_time: null,
    venue_name: "Tavastia", venue_address: null,
    lat: 60.17, lng: 24.93,
    image_url: null, url: "https://example.com", is_free: 0, price: null,
    categories: "[]", popularity: 0,
    ...overrides,
  };
}

test("titleSimilarity: same gig, different phrasing", () => {
  const sim = titleSimilarity(
    "Nightwish – Yesterwynde World Tour",
    "Nightwish: Yesterwynde World Tour 2026"
  );
  assert.ok(sim >= 0.5, `expected >= 0.5, got ${sim}`);
});

test("titleSimilarity: unrelated titles", () => {
  assert.ok(titleSimilarity("Nightwish World Tour", "Helsinki City Marathon") < 0.5);
});

test("merges the same event across sources (geo + time + title)", () => {
  const le = raw({ title: "Nightwish – Yesterwynde World Tour", description: "Rich city description" });
  const tm = raw({
    source: "ticketmaster", source_id: "tm1",
    title: "Nightwish: Yesterwynde World Tour 2026",
    start_time: "2026-07-10T19:30:00Z",
    venue_name: "Helsinki Ice Hall", lat: 60.1702, lng: 24.9305,
    price: "59–89 €",
  });
  const result = dedupe([le, tm]);
  assert.equal(result.length, 1);
  const merged = result[0];
  assert.equal(merged.description, "Rich city description"); // Linked Events wins description
  assert.equal(merged.price, "59–89 €"); // Ticketmaster wins price
  assert.equal(JSON.parse(merged.sources).length, 2);
});

test("keeps different events at the same time nearby separate", () => {
  const a = raw({ title: "Nightwish World Tour" });
  const b = raw({
    source: "ticketmaster", source_id: "tm2",
    title: "Helsinki City Marathon", venue_name: "Olympic Stadium",
    lat: 60.1866, lng: 24.9271,
  });
  assert.equal(dedupe([a, b]).length, 2);
});

test("merges ticket-package variants via title containment, wider time window", () => {
  const base = raw({ title: "Lenny Kravitz" });
  const vip = raw({
    source: "ticketmaster", source_id: "tm3",
    title: "Lenny Kravitz – Live 2026 | Premium Suite Ticket",
    start_time: "2026-07-10T20:00:00Z", // 60 min later — inside containment window only
  });
  assert.equal(dedupe([base, vip]).length, 1);
});

test("never merges two records from the same source", () => {
  const a = raw({ source_id: "a", title: "Museum guided tour" });
  const b = raw({ source_id: "b", title: "Museum guided tour", start_time: "2026-07-10T19:30:00Z" });
  assert.equal(dedupe([a, b]).length, 2);
});

test("stable_key prefers the linkedevents record and base listing", () => {
  const tm = raw({ source: "ticketmaster", source_id: "tm4", title: "Artist Name | VIP package" });
  const le = raw({ source_id: "hel1", title: "Artist Name" });
  const [merged] = dedupe([tm, le]);
  assert.equal(merged.stable_key, "linkedevents:hel1");
});

test("flags long-running things as ongoing, keeps score signals", () => {
  const exhibition = raw({
    source_id: "ex1", title: "TechLand",
    start_time: "2017-10-01T08:00:00Z", end_time: "2027-12-31T15:00:00Z",
  });
  const gig = raw({ source_id: "gig1", end_time: "2026-07-10T22:00:00Z", image_url: "x.jpg", categories: '["music"]' });
  const result = dedupe([exhibition, gig]);
  const ex = result.find((e) => e.title === "TechLand");
  const g = result.find((e) => e.title !== "TechLand");
  assert.equal(ex.is_ongoing, 1);
  assert.equal(g.is_ongoing, 0);
  assert.ok(g.score > ex.score, "music event with image should outscore bare exhibition");
});
